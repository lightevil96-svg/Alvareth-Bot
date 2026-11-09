import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { constants as fsConstants } from 'node:fs'
import { downloadContentFromMessage } from 'baileys'
import { fileTypeFromBuffer } from 'file-type'
import { resolveQuotedMediaInfo } from '../../lib/simple.js'
import { createRenderSessionKey } from '../../lib/render-message.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import { isWhatsAppSocketOpen, sendWithWhatsAppReconnect } from '../../lib/whatsapp-connection.js'
import {
  persistRenderOutputSession,
  restorePendingRenderSessions
} from '../../lib/render-session-store.js'
import {
  extractRenderArchive,
  runRenderScript,
  createRenderProgressReporter
} from '../../lib/render-script.js'
import {
  buildRemotionRenderScript,
  findRemotionProject
} from '../../lib/remotion-project.js'

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 200
const MAX_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_UNPACKED_BYTES = 250 * 1024 * 1024
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024
const STALE_JOB_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ACTIVE_JOBS = 2
const HEARTBEAT_MS = 60_000
const pendingJobs = new Map()

function getRemotionRoot() {
  const configured = String(process.env.ALVARETH_REMOTION_TMPDIR || '').trim()
  const dataRoot = String(process.env.ALVARETH_DATA_DIR || path.join(homedir(), '.alvareth-bot-data'))
  return path.resolve(configured || path.join(dataRoot, 'remotion-jobs'))
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return value.toFixed(0) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  return (value / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes >= 60) return Math.floor(minutes / 60) + 'j ' + (minutes % 60) + 'm'
  if (minutes) return minutes + 'm ' + remainder + ' dtk'
  return remainder + ' dtk'
}

function toSafeNumber(value) {
  try {
    const number = typeof value?.toNumber === 'function' ? value.toNumber() : Number(value)
    return Number.isSafeInteger(number) && number >= 0 ? number : 0
  } catch {
    return 0
  }
}

function safeError(error) {
  return String(error?.message || error || 'Kesalahan tidak diketahui')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 700)
}

function getSocket(m) {
  const socket = typeof global.conn?.sendMessage === 'function' ? global.conn : m?.conn
  return socket && typeof socket.sendMessage === 'function' ? socket : null
}

async function safeReply(m, message) {
  try {
    const socket = getSocket(m)
    if (!socket || !m?.chat || !isWhatsAppSocketOpen(socket)) return null
    return await socket.sendMessage(m.chat, { text: message }, socket === m.conn && m?.key ? { quoted: m } : {})
  } catch (error) {
    console.warn('[REMOTION] Gagal mengirim balasan WhatsApp:', error?.message || error)
    return null
  }
}

async function safeReact(m, emoji) {
  try {
    const socket = getSocket(m)
    if (!socket || !m?.chat || !m?.key || !isWhatsAppSocketOpen(socket)) return null
    return await socket.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
  } catch (error) {
    console.warn('[REMOTION] Gagal mengirim reaksi WhatsApp:', error?.message || error)
    return null
  }
}

function acquireUpdateLock(session) {
  if (!session || session.updateLockHeld) return
  if (global.__alvarethUpdateRunning) {
    const error = new Error('Pembaruan bot sedang berlangsung. Coba lagi setelah update selesai.')
    error.code = 'REMOTION_UPDATE_RUNNING'
    throw error
  }
  session.updateLockHeld = true
  global.__alvarethRenderJobs = Math.max(0, Number(global.__alvarethRenderJobs) || 0) + 1
}

function releaseUpdateLock(session) {
  if (!session?.updateLockHeld) return false
  session.updateLockHeld = false
  global.__alvarethRenderJobs = Math.max(0, (Number(global.__alvarethRenderJobs) || 1) - 1)
  return true
}

async function ensureRemotionRoot() {
  const root = getRemotionRoot()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('ALVARETH_REMOTION_TMPDIR harus berupa direktori biasa, bukan symbolic link.')
  }
  return root
}

let recoveryPromise = null
function ensureRemotionRecovery() {
  if (!recoveryPromise) {
    recoveryPromise = (async () => {
      const root = await ensureRemotionRoot()
      const restored = await restorePendingRenderSessions({
        root,
        staleTtlMs: STALE_JOB_TTL_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES
      })
      for (const item of restored) {
        if (!pendingJobs.has(item.key)) pendingJobs.set(item.key, item.session)
      }
      if (restored.length) console.log('[REMOTION] Hasil render tertunda dipulihkan:', restored.length)
      return restored.length
    })().catch(error => {
      global.__alvarethRemotionRecoveryError = error
      console.error('[REMOTION] Pemulihan hasil render gagal:', error?.stack || error)
      throw error
    })
    global.__alvarethRemotionRecoveryReady = recoveryPromise
  }
  return recoveryPromise
}

void ensureRemotionRecovery().catch(() => {})

function throwIfCancelled(session) {
  if (!session?.cancelRequested && !session?.abortController?.signal?.aborted) return
  const error = new Error('Render Remotion dibatalkan atas permintaan pengguna.')
  error.code = 'RENDER_SCRIPT_CANCELLED'
  throw error
}

async function removeJob(session) {
  if (!session) return
  releaseUpdateLock(session)
  if (!session.directory) return
  try {
    const root = getRemotionRoot()
    const directory = path.resolve(session.directory)
    const relative = path.relative(root, directory)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Direktori job Remotion berada di luar root penyimpanan.')
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 })
  } catch (error) {
    console.warn('[REMOTION] Cleanup job gagal:', error?.message || error)
  }
}

function createTerminalProgress(session) {
  const progress = createRenderProgressReporter(session, message => console.log(message))
  let closed = false
  const heartbeat = setInterval(() => {
    if (closed || !session.processing) return
    const current = session.progress || {}
    console.log('[REMOTION] HEARTBEAT | elapsed=' +
      formatElapsed(Date.now() - Number(session.processingStartedAt || session.createdAt || Date.now())) +
      ' | stage=' + String(current.stage || 'Menyiapkan render') +
      ' | childPid=' + String(session.renderChildPid || 'not-started') +
      ' | childState=' + String(session.renderChildState || 'not-started'))
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  return {
    update: progress.update,
    close() {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
    }
  }
}

function hasZipSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false
  return (buffer[2] === 0x03 && buffer[3] === 0x04) ||
    (buffer[2] === 0x05 && buffer[3] === 0x06) ||
    (buffer[2] === 0x07 && buffer[3] === 0x08)
}

async function downloadQuotedZip(mediaInfo) {
  const declaredSize = toSafeNumber(mediaInfo?.media?.fileLength)
  if (declaredSize > MAX_ARCHIVE_BYTES) {
    throw new Error('Ukuran ZIP ' + formatBytes(declaredSize) + ' melebihi batas ' + formatBytes(MAX_ARCHIVE_BYTES) + '.')
  }

  const stream = await downloadContentFromMessage(mediaInfo.media, 'document')
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    const part = Buffer.from(chunk)
    total += part.length
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error('Ukuran ZIP melebihi batas ' + formatBytes(MAX_ARCHIVE_BYTES) + '.')
    }
    chunks.push(part)
  }

  const buffer = Buffer.concat(chunks)
  if (!buffer.length || !hasZipSignature(buffer)) {
    throw new Error('File yang direply bukan arsip ZIP yang valid.')
  }
  return buffer
}

async function findConfiguredBrowser() {
  const configured = String(process.env.ALVARETH_REMOTION_BROWSER_EXECUTABLE || '').trim()
  if (!configured) return ''
  if (!path.isAbsolute(configured)) {
    throw new Error('ALVARETH_REMOTION_BROWSER_EXECUTABLE harus berupa path absolut.')
  }
  await fs.access(configured, fsConstants.X_OK)
  const info = await fs.stat(configured)
  if (!info.isFile()) throw new Error('Browser executable Remotion bukan file biasa.')
  return configured
}

async function persistOutput(key, session) {
  return persistRenderOutputSession({
    root: getRemotionRoot(),
    directory: session.directory,
    key,
    outputPath: session.outputPath,
    outputFileName: 'render-result.mp4',
    createdAt: session.createdAt,
    progress: session.progress
  })
}

async function deliverRemotionOutput({ m, key, session, progress }) {
  const outputPath = session.outputPath
  const outputInfo = await fs.lstat(outputPath)
  if (!outputInfo.isFile() || outputInfo.isSymbolicLink() || outputInfo.size < 1 || outputInfo.size > MAX_OUTPUT_BYTES) {
    throw new Error('File hasil Remotion tidak valid atau melebihi batas ' + formatBytes(MAX_OUTPUT_BYTES) + '.')
  }

  await persistOutput(key, session)
  releaseUpdateLock(session)

  session.deliveryWaiting = true
  session.deliveryStarted = false
  try {
    const result = await sendWithWhatsAppReconnect({
      getSocket: () => global.conn || m?.conn || null,
      signal: session.abortController?.signal,
      onWait: details => {
        if (details?.reason === 'waiting-for-connection' ||
            details?.reason === 'connection-still-unavailable' ||
            details?.reason === 'retry-after-disconnect') {
          try {
            global.requestWhatsAppReconnect?.('Hasil Remotion selesai, tetapi koneksi WhatsApp belum siap.')
          } catch (error) {
            console.warn('[REMOTION] Permintaan reconnect gagal:', error?.message || error)
          }
        }
      },
      onReconnectRequired: details => {
        try {
          global.requestWhatsAppReconnect?.('Pengiriman hasil Remotion terputus: ' + safeError(details?.error))
        } catch (error) {
          console.warn('[REMOTION] Permintaan reconnect gagal:', error?.message || error)
        }
      },
      send: socket => {
        if (session.abortController?.signal.aborted) {
          const error = new Error('Pengiriman Remotion dibatalkan.')
          error.code = 'RENDER_SCRIPT_CANCELLED'
          throw error
        }
        if (global.__alvarethUpdateRunning) {
          const error = new Error('Pembaruan bot sedang berlangsung. Hasil tetap tersimpan untuk dikirim setelah update.')
          error.code = 'REMOTION_DELIVERY_DEFERRED'
          throw error
        }
        acquireUpdateLock(session)
        if (global.__alvarethUpdateRunning) {
          releaseUpdateLock(session)
          const error = new Error('Pembaruan bot dimulai sebelum upload. Hasil tetap tersimpan untuk dikirim setelah update.')
          error.code = 'REMOTION_DELIVERY_DEFERRED'
          throw error
        }
        session.deliveryWaiting = false
        session.deliveryStarted = true
        progress.update(96, 'Mengirim MP4 ke WhatsApp', formatBytes(outputInfo.size), true)
        return sendLocalFile(socket, m.chat, outputPath, {
          quoted: socket === m.conn ? m : undefined,
          caption: '✅ Render Remotion selesai. Berikut hasil videonya.'
        })
      }
    })

    await safeReact(m, '✅')
    progress.update(100, 'Selesai', 'MP4 berhasil dikirim ke WhatsApp.', true)
    if (pendingJobs.get(key) === session) pendingJobs.delete(key)
    session.processing = false
    session.deliveryWaiting = false
    session.deliveryStarted = false
    session.abortController = null
    await removeJob(session)
    console.log('[REMOTION] Hasil terkirim:', {
      fileName: 'render-result.mp4',
      size: formatBytes(result?.size || outputInfo.size),
      messageId: result?.messageId
    })
    return true
  } catch (error) {
    session.processing = false
    session.deliveryWaiting = false
    session.deliveryStarted = false
    session.abortController = null
    releaseUpdateLock(session)
    if (session.outputPath) {
      progress.update(95, 'Hasil render tersimpan - pengiriman tertunda', safeError(error), true)
      try { await persistOutput(key, session) } catch (persistError) {
        console.error('[REMOTION] Manifest hasil render gagal disimpan:', persistError?.stack || persistError)
      }
      await safeReact(m, '⚠️')
      await safeReply(m,
        '⚠️ Video sudah selesai dirender dan tetap tersimpan di server, tetapi belum terkirim: ' +
        safeError(error) + '\n\nKetik *.remotion send* untuk mencoba mengirim file yang sama tanpa render ulang.')
    }
    return false
  }
}

async function processRemotionJob({ m, conn, mediaInfo, key, session }) {
  const progress = createTerminalProgress(session)
  let packageDirectory = null
  try {
    if (Number(String(process.versions.node).split('.')[0]) < 20) {
      throw new Error('Remotion membutuhkan Node.js 20 atau lebih baru pada server bot.')
    }

    acquireUpdateLock(session)
    progress.update(1, 'Mengunduh ZIP proyek', '', true)
    const archiveBuffer = await downloadQuotedZip(mediaInfo)
    throwIfCancelled(session)

    const root = await ensureRemotionRoot()
    session.directory = await fs.mkdtemp(path.join(root, 'alvareth-render-'))
    await fs.chmod(session.directory, 0o700).catch(() => {})
    packageDirectory = path.join(session.directory, 'package')
    await fs.mkdir(packageDirectory, { recursive: true, mode: 0o700 })

    progress.update(5, 'Memeriksa dan mengekstrak ZIP', formatBytes(archiveBuffer.length), true)
    const extracted = await extractRenderArchive(archiveBuffer, packageDirectory, {
      maxArchiveBytes: MAX_ARCHIVE_BYTES,
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxFileBytes: MAX_ARCHIVE_FILE_BYTES,
      maxTotalBytes: MAX_ARCHIVE_UNPACKED_BYTES
    })
    throwIfCancelled(session)

    const project = await findRemotionProject(packageDirectory)
    const outputRelativePath = 'out/render-result.mp4'
    const outputPath = path.join(project.projectRoot, outputRelativePath)
    const scriptPath = path.join(project.projectRoot, '__alvareth_remotion_run.sh')

    try {
      await fs.lstat(scriptPath)
      throw new Error('ZIP memakai nama file sementara yang dicadangkan: __alvareth_remotion_run.sh.')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    const browserExecutable = await findConfiguredBrowser()
    const script = buildRemotionRenderScript({
      entryPoint: project.entryPoint,
      compositionId: project.compositionId,
      outputPath: outputRelativePath,
      browserExecutable,
      concurrency: 2
    })
    await fs.writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o600, flag: 'wx' })

    progress.update(12, 'Menyiapkan proyek Remotion',
      project.packageName + ' · ' + project.entryPoint + ' · ' + project.compositionId, true)
    progress.update(15, 'Menginstal dependency dari npm', 'Lifecycle scripts dinonaktifkan untuk keamanan.', true)

    const processResult = await runRenderScript({
      scriptPath,
      workingDirectory: project.projectRoot,
      inputPath: project.packageJsonPath,
      signal: session.abortController?.signal,
      onStage: value => {
        const command = String(value.command || '').toLowerCase()
        if (command === 'npm') {
          progress.update(15, 'Menginstal dependency dari npm', 'Menggunakan --ignore-scripts.', true)
        } else if (command === 'remotion') {
          progress.update(35, 'Merender komposisi Remotion', project.compositionId, true)
        } else {
          progress.update(20, 'Menjalankan pipeline Remotion', command, true)
        }
      },
      onProcess: value => {
        session.renderChildPid = value.pid || null
        session.renderChildState = value.running ? 'running' : String(value.state || 'unknown')
        if (value.state === 'started') {
          progress.update(20, 'Proses render aktif', 'PID ' + String(value.pid || 'tidak diketahui'), true)
        } else if (value.state === 'closed') {
          progress.update(88, 'Proses Remotion selesai', 'Exit code: ' + String(value.code), true)
        }
      },
      onProgress: value => {
        const raw = Number(value.percent)
        const percent = Number.isFinite(raw) ? 35 + Math.round(Math.max(0, Math.min(100, raw)) * 0.5) : 35
        const detail = [
          Number.isFinite(value.frame) ? 'Frame ' + value.frame : '',
          Number.isFinite(value.fps) ? value.fps + ' FPS' : '',
          Number.isFinite(value.currentTimeSeconds) ? value.currentTimeSeconds.toFixed(1) + ' detik' : ''
        ].filter(Boolean).join(' · ')
        progress.update(percent, 'Merender komposisi Remotion', detail)
      }
    })
    throwIfCancelled(session)

    console.log('[REMOTION] Render CLI selesai:', {
      package: project.packageName,
      composition: project.compositionId,
      entryPoint: project.entryPoint,
      extractedFiles: extracted.files.length,
      extractedBytes: formatBytes(extracted.totalBytes),
      duration: formatElapsed(processResult.durationMs),
      exitCode: processResult.code
    })

    progress.update(91, 'Memvalidasi MP4 hasil render', '', true)
    const outputInfo = await fs.lstat(outputPath)
    if (!outputInfo.isFile() || outputInfo.isSymbolicLink() || outputInfo.size < 1) {
      throw new Error('Remotion selesai, tetapi MP4 hasil render tidak ditemukan atau kosong.')
    }
    if (outputInfo.size > MAX_OUTPUT_BYTES) {
      throw new Error('Ukuran MP4 ' + formatBytes(outputInfo.size) + ' melebihi batas ' + formatBytes(MAX_OUTPUT_BYTES) + '.')
    }

    const handle = await fs.open(outputPath, 'r')
    const header = Buffer.alloc(4100)
    try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
    const detected = await fileTypeFromBuffer(header)
    if (detected && !['mp4', 'mov'].includes(String(detected.ext || '').toLowerCase())) {
      throw new Error('File keluaran tidak dikenali sebagai video MP4.')
    }

    session.outputPath = path.join(session.directory, 'render-result.mp4')
    session.outputFileName = 'render-result.mp4'
    session.outputSize = outputInfo.size
    await fs.rename(outputPath, session.outputPath)
    await fs.chmod(session.outputPath, 0o600).catch(() => {})
    await fs.rm(packageDirectory, { recursive: true, force: true })
    packageDirectory = null

    progress.update(94, 'Menyimpan hasil render', formatBytes(session.outputSize), true)
    await persistOutput(key, session)
    releaseUpdateLock(session)
    await deliverRemotionOutput({ m, key, session, progress })
  } catch (error) {
    console.error('[REMOTION] Proses ZIP Remotion gagal:', error?.stack || error)
    if (packageDirectory) await fs.rm(packageDirectory, { recursive: true, force: true }).catch(() => {})

    const cancelled = error?.code === 'RENDER_SCRIPT_CANCELLED' ||
      session.cancelRequested || session.abortController?.signal.aborted
    session.processing = false
    session.abortController = null
    session.deliveryWaiting = false
    session.deliveryStarted = false

    if (session.outputPath) {
      releaseUpdateLock(session)
      try { await persistOutput(key, session) } catch (persistError) {
        console.error('[REMOTION] Manifest pemulihan gagal:', persistError?.stack || persistError)
      }
      await safeReact(m, '⚠️')
      await safeReply(m,
        '⚠️ Hasil MP4 sudah tersimpan, tetapi tahap pengiriman belum selesai. Ketik *.remotion send* untuk mengirim file yang sama.')
    } else {
      if (pendingJobs.get(key) === session) pendingJobs.delete(key)
      await removeJob(session)
      await safeReact(m, cancelled ? '🛑' : '❌')
      await safeReply(m, cancelled
        ? '🛑 Render Remotion dibatalkan dan proses turunannya dihentikan.'
        : '❌ Render Remotion gagal: ' + safeError(error) +
          '\n\nPastikan ZIP berisi satu proyek Remotion, package.json, entry point, dan dependency yang valid.')
    }
  } finally {
    progress.close()
  }
}

async function handleSend(m, key, session) {
  if (!session?.outputPath) return safeReply(m, 'Belum ada MP4 hasil render yang menunggu dikirim.')
  if (session.processing) return safeReply(m, 'Job Remotion masih berjalan atau sedang mengirim hasil.')
  session.processing = true
  session.processingStartedAt = Date.now()
  session.abortController = new AbortController()
  session.cancelRequested = false
  const progress = createTerminalProgress(session)
  await safeReply(m, '📤 Mengirim ulang MP4 yang sudah tersimpan. Bot tidak akan merender ulang.')
  void deliverRemotionOutput({ m, key, session, progress })
    .catch(async error => {
      session.processing = false
      session.abortController = null
      releaseUpdateLock(session)
      if (session.outputPath) {
        progress.update(95, 'Hasil render tersimpan - pengiriman tertunda', safeError(error), true)
        try { await persistOutput(key, session) } catch (persistError) {
          console.error('[REMOTION] Manifest hasil render gagal disimpan:', persistError?.stack || persistError)
        }
        await safeReply(m,
          '⚠️ MP4 tetap tersimpan, tetapi belum terkirim: ' + safeError(error) +
          '\\n\\nKetik *.remotion send* untuk mencoba kembali tanpa render ulang.')
      } else {
        if (pendingJobs.get(key) === session) pendingJobs.delete(key)
        await removeJob(session)
        await safeReply(m, '❌ Hasil Remotion tidak dapat disiapkan untuk dikirim: ' + safeError(error))
      }
    })
    .finally(() => progress.close())
}

async function handler(m, { conn, text = '' } = {}) {
  if (!m?.chat) return
  try {
    await ensureRemotionRecovery()
  } catch (error) {
    return safeReply(m, '⏳ Penyimpanan hasil Remotion belum siap: ' + safeError(error))
  }

  const key = createRenderSessionKey(m)
  if (!key) return safeReply(m, 'Identitas chat/pengirim tidak terbaca. Coba ulangi perintah di chat pribadi bot.')

  const action = String(text || '').trim().toLowerCase()
  const session = pendingJobs.get(key)

  if (action === 'status') {
    if (!session) return safeReply(m, 'Tidak ada job Remotion aktif atau hasil yang menunggu dikirim.')
    if (session.processing) {
      const elapsed = formatElapsed(Date.now() - Number(session.processingStartedAt || session.createdAt || Date.now()))
      return safeReply(m, '🎬 Job Remotion sedang berjalan.\nTahap: ' +
        String(session.progress?.stage || 'Menyiapkan render') + '\nWaktu: ' + elapsed +
        (session.progress?.detail ? '\nDetail: ' + String(session.progress.detail).slice(0, 240) : ''))
    }
    if (session.outputPath) {
      return safeReply(m, '✅ MP4 sudah selesai dan tersimpan (' + formatBytes(session.outputSize) +
        '), tetapi belum terkirim. Ketik *.remotion send* untuk mengirim tanpa render ulang.')
    }
    return safeReply(m, 'Tidak ada job Remotion aktif.')
  }

  if (action === 'send') return handleSend(m, key, session)

  if (action === 'cancel') {
    if (!session) return safeReply(m, 'Tidak ada job Remotion yang bisa dibatalkan.')
    if (session.processing) {
      if (session.deliveryStarted) {
        return safeReply(m, 'Upload MP4 sudah dimulai dan tidak dapat dibatalkan dengan aman.')
      }
      session.cancelRequested = true
      session.abortController?.abort()
      return safeReply(m, session.outputPath
        ? '🛑 Penantian/pengiriman dihentikan. MP4 tetap tersimpan; gunakan *.remotion send* untuk mencoba lagi.'
        : '🛑 Permintaan pembatalan diterima. Proses render dan proses turunannya sedang dihentikan.')
    }
    pendingJobs.delete(key)
    await removeJob(session)
    return safeReply(m, '🛑 Job Remotion dibatalkan dan file sementara dibersihkan.')
  }

  if (action) {
    return safeReply(m, 'Format: reply file proyek *.zip* dengan *.remotion*. Perintah tambahan: *.remotion status*, *.remotion send*, dan *.remotion cancel*.')
  }

  if (global.__alvarethUpdateRunning) {
    return safeReply(m, '⏳ Remotion ditunda karena pembaruan bot sedang berlangsung. Coba lagi setelah update selesai.')
  }

  if (session?.processing) return safeReply(m, 'Job Remotion sebelumnya masih berjalan. Gunakan *.remotion status* atau *.remotion cancel*.')
  if (session?.outputPath) return safeReply(m, 'Hasil sebelumnya masih tersimpan. Gunakan *.remotion send* atau *.remotion cancel* sebelum memulai job baru.')
  if (session) {
    pendingJobs.delete(key)
    await removeJob(session)
  }

  const mediaInfo = await resolveQuotedMediaInfo(m, conn || m.conn)
  if (!mediaInfo || mediaInfo.type !== 'documentMessage') {
    return safeReply(m,
      'Kirim file proyek Remotion sebagai dokumen ZIP, lalu reply file tersebut dengan *.remotion*.\n\nContoh: kirim hujan-mendadak-remotion.zip → reply ZIP → *.remotion*.')
  }

  const filename = path.basename(String(
    mediaInfo.media?.fileName || mediaInfo.media?.file_name || mediaInfo.media?.filename || ''
  ).trim())
  const mimetype = String(mediaInfo.mime || mediaInfo.media?.mimetype || '').toLowerCase()
  const isZip = /\.zip$/i.test(filename) ||
    ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(mimetype)
  if (!isZip) {
    return safeReply(m, 'Dokumen yang direply harus berupa file *.zip* proyek Remotion.')
  }

  const declaredSize = toSafeNumber(mediaInfo.media?.fileLength)
  if (declaredSize > MAX_ARCHIVE_BYTES) {
    return safeReply(m, 'Ukuran ZIP ' + formatBytes(declaredSize) + ' melebihi batas ' + formatBytes(MAX_ARCHIVE_BYTES) + '.')
  }

  const activeJobs = [...pendingJobs.values()].filter(item => item.processing).length
  if (activeJobs >= MAX_ACTIVE_JOBS) {
    return safeReply(m, 'Antrean Remotion penuh (' + MAX_ACTIVE_JOBS + ' job aktif). Tunggu job yang berjalan selesai.')
  }

  const nextSession = {
    directory: null,
    createdAt: Date.now(),
    processingStartedAt: Date.now(),
    processing: true,
    progress: { percent: 0, stage: 'Menunggu worker Remotion', detail: '', updatedAt: Date.now() },
    updateLockHeld: false,
    abortController: new AbortController(),
    cancelRequested: false,
    deliveryWaiting: false,
    deliveryStarted: false,
    outputPath: null,
    outputFileName: null,
    outputSize: 0
  }
  pendingJobs.set(key, nextSession)

  await safeReact(m, '🎬')
  await safeReply(m,
    '📦 ZIP proyek Remotion diterima. Bot akan memeriksa struktur proyek, memasang dependency tanpa menjalankan lifecycle scripts, lalu merender MP4 di background.\n\nProgress teknis dicatat di terminal server. Gunakan *.remotion status* untuk status, *.remotion cancel* untuk membatalkan, dan *.remotion send* jika hasil sudah selesai tetapi belum terkirim.')
  void processRemotionJob({ m, conn: conn || m.conn, mediaInfo, key, session: nextSession })
}

handler.help = ['remotion', 'remotion status', 'remotion send', 'remotion cancel']
handler.tags = ['owner']
handler.command = /^remotion$/i
handler.rowner = true

export default handler
