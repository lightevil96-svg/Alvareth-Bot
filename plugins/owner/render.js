import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileTypeFromBuffer } from 'file-type'
import { downloadContentFromMessage } from 'baileys'
import { downloadQuotedMedia, getMediaInfoFromMessageContent, resolveQuotedMediaInfo } from '../../lib/simple.js'
import { wasBotSentMessage } from '../../lib/auto-download.js'
import {
  findHtmlTemplate,
  ensureRenderBrowser,
  renderHtmlTemplate,
  MAX_TEMPLATE_PHOTO_BYTES
} from '../../lib/html-template-render.js'
import { createRenderSessionKey as sessionKey, getCurrentRenderDocument as getCurrentDocument, isRenderDocumentEvent } from '../../lib/render-message.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import { isWhatsAppConnectionClosedError, isWhatsAppSocketOpen, sendWithWhatsAppReconnect } from '../../lib/whatsapp-connection.js'
import {
  findOrphanedRenderOutputs,
  persistRenderOutputSession,
  restorePendingRenderSessions
} from '../../lib/render-session-store.js'
import {
  extractRenderArchive,
  findRenderScript,
  runRenderScript,
  findRenderOutput,
  parseRenderDurationSeconds,
  createRenderProgressReporter
} from '../../lib/render-script.js'

const VIDEO_EXTENSIONS = new Set([
  '3gp', 'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv'
])
const STALE_JOB_TTL_MS = 24 * 60 * 60 * 1000
const MAX_PENDING_SESSIONS = 3
const MAX_VIDEO_BYTES = 300 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 200
const MAX_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_UNPACKED_BYTES = 250 * 1024 * 1024
const MAX_TEMPLATE_ARCHIVE_BYTES = 100 * 1024 * 1024
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024

// Session dipisahkan berdasarkan chat dan pengirim agar paket ZIP pengguna lain
// tidak pernah dipasangkan dengan video milik owner.
const pendingSessions = new Map()
let orphanedRenderOutputs = []

function getRenderRoot() {
  const configured = String(process.env.ALVARETH_RENDER_TMPDIR || '').trim()
  const dataRoot = String(process.env.ALVARETH_DATA_DIR || path.join(homedir(), '.alvareth-bot-data'))
  return path.resolve(configured || path.join(dataRoot, 'render-jobs'))
}

function releaseRenderUpdateLock(session) {
  if (!session?.updateLockHeld) return false
  session.updateLockHeld = false
  global.__alvarethRenderJobs = Math.max(0, (Number(global.__alvarethRenderJobs) || 1) - 1)
  return true
}

function acquireRenderUpdateLock(session) {
  if (!session || session.updateLockHeld) return false
  session.updateLockHeld = true
  global.__alvarethRenderJobs = Math.max(0, Number(global.__alvarethRenderJobs) || 0) + 1
  return true
}

async function evictOldestIdleRenderSession() {
  while (pendingSessions.size >= MAX_PENDING_SESSIONS) {
    const oldest = [...pendingSessions.entries()]
      // Never evict a completed output that is waiting for the owner to send it.
      .filter(([, item]) => !item.processing && !item.outputPath)
      .sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
    if (!oldest) throw new Error('Antrean render penuh. Selesaikan atau batalkan sesi sebelumnya terlebih dahulu.')
    pendingSessions.delete(oldest[0])
    await removeSession(oldest[1])
  }
}

function formatTemplatePhotoRequest(manifest) {
  const lines = [
    '🎬 Template diterima: ' + manifest.title,
    'Ukuran: ' + manifest.width + 'x' + manifest.height + ' · ' + manifest.fps + ' fps · durasi ' + manifest.duration + ' detik',
    '',
    'Bot membutuhkan ' + manifest.requiredPhotos + ' foto:'
  ]
  manifest.photoDescriptions.forEach((description, index) => {
    lines.push((index + 1) + '. ' + description)
  })
  lines.push(
    '',
    'Kirim semua foto sekaligus sebagai foto (bukan dokumen) di chat ini. Bot langsung merender MP4 kualitas tertinggi begitu foto terakhir diterima.',
    'Gunakan *.render status* untuk melihat foto yang sudah diterima, atau *.render cancel* untuk membatalkan.'
  )
  return lines.join('\n')
}

function isTemplatePhotoEvent(m) {
  if (!m || wasBotSentMessage(m)) return false
  const mtype = String(m?.mtype || '').toLowerCase()
  const mediaType = String(m?.mediaType || '').toLowerCase()
  return mtype === 'imagemessage' || mediaType === 'imagemessage'
}

export async function downloadIncomingImage(m, conn) {
  // Resolve the media payload from the raw inbound message, never from the
  // smsg getters (m.msg / m.download). This Baileys fork's protobuf conversion
  // can drop the serializer getters — handler.js itself warns not to rely on
  // them — so m.msg can be undefined for a real photo and the old code threw
  // "Cannot destructure property 'mediaKey' of 'undefined'" from
  // downloadContentFromMessage on all four live photos. The same resolver
  // downloadQuotedMedia relies on (getMediaInfoFromMessageContent) reads the
  // payload straight from rawMessage.message / message instead.
  const candidates = []
  const seen = new Set()
  const addCandidate = media => {
    if (media && typeof media === 'object' && !seen.has(media)) {
      seen.add(media)
      candidates.push(media)
    }
  }
  for (const source of [m?.rawMessage, m]) {
    try {
      const info = source ? getMediaInfoFromMessageContent(source) : null
      if (info?.type === 'imageMessage') addCandidate(info.media)
    } catch {}
  }

  // Fallback: the stored original message (same pattern downloadQuotedMedia
  // uses for quoted previews that only carry a thumbnail). A payload that
  // exists but has no URL or directPath is just as unusable as no payload.
  const hasUsableCandidate = candidates.some(media => media?.url || media?.directPath)
  if (!hasUsableCandidate && m?.key?.id && typeof conn?.loadMessage === 'function') {
    try {
      const cached = await Promise.resolve(conn.loadMessage(m.key.id))
      const info = cached?.key?.id === m.key.id ? getMediaInfoFromMessageContent(cached) : null
      if (info?.type === 'imageMessage') addCandidate(info.media)
    } catch (error) {
      console.warn('[RENDER] Cache pesan foto tidak dapat dibaca:', error?.message || error)
    }
  }

  let lastError
  for (const media of candidates) {
    if (typeof conn?.downloadM === 'function') {
      try {
        const buffer = await conn.downloadM(media, 'image')
        if ((Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) && buffer.length) {
          return Buffer.from(buffer)
        }
      } catch (error) { lastError = error }
    }
    // downloadContentFromMessage destructures its first argument, so never
    // call it without a payload that carries a URL or directPath.
    if (media.url || media.directPath) {
      try {
        const stream = await downloadContentFromMessage(media, 'image')
        const chunks = []
        for await (const chunk of stream) chunks.push(Buffer.from(chunk))
        const buffer = Buffer.concat(chunks)
        if (buffer.length) return buffer
      } catch (error) { lastError = error }
    }
  }

  // Last resort: the serializer's own download method when it exists. It can
  // resolve the small thumbnail instead of the original in self-chat, so it
  // stays behind the raw-payload candidates above.
  if (typeof m?.download === 'function') {
    try {
      const buffer = await m.download()
      if ((Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) && buffer.length) {
        return Buffer.from(buffer)
      }
    } catch (error) { lastError = error }
  }

  console.error('[RENDER] Foto template gagal diunduh:', JSON.stringify({
    mtype: typeof m?.mtype === 'string' ? m.mtype : null,
    hasRawMessage: Boolean(m?.rawMessage?.message),
    candidates: candidates.length,
    candidateHasUrl: candidates.some(media => Boolean(media?.url || media?.directPath)),
    hasDownloadMethod: typeof m?.download === 'function',
    lastError: lastError?.message || String(lastError || '')
  }))
  throw new Error('Foto tidak dapat diunduh dari WhatsApp' +
    (lastError?.message ? ': ' + String(lastError.message).slice(0, 250) : '.'))
}

function toSafeNumber(value) {
  try {
    const number = typeof value?.toNumber === 'function' ? value.toNumber() : Number(value)
    return Number.isSafeInteger(number) && number >= 0 ? number : 0
  } catch {
    return 0
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'ukuran tidak diketahui'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function safeError(error) {
  return String(error?.message || error || 'Kesalahan tidak diketahui')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 700)
}

function getReadyRenderSocket(m) {
  const socket = typeof global.conn?.sendMessage === 'function'
    ? global.conn
    : m?.conn
  if (!socket || typeof socket.sendMessage !== 'function') return null

  if (!isWhatsAppSocketOpen(socket)) return null
  return socket
}

async function safeReply(m, message) {
  try {
    const socket = getReadyRenderSocket(m)
    if (!socket || !m?.chat) {
      console.warn('[RENDER] Balasan ditunda: belum ada socket WhatsApp aktif.')
      return null
    }
    const options = socket === m.conn && m?.key ? { quoted: m } : {}
    return await socket.sendMessage(m.chat, { text: message }, options)
  } catch (error) {
    console.warn('[RENDER] Gagal mengirim balasan WhatsApp:', error?.message || error)
  }
  return null
}

async function safeReact(m, emoji) {
  try {
    const socket = getReadyRenderSocket(m)
    if (!socket || !m?.chat || !m?.key) return null
    return await socket.sendMessage(m.chat, {
      react: { text: emoji, key: m.key }
    })
  } catch (error) {
    console.warn('[RENDER] Gagal memperbarui reaksi WhatsApp:', error?.message || error)
  }
  return null
}

const RENDER_STATUS_HEARTBEAT_MS = 60_000

function formatRenderElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return hours + 'j ' + minutes + 'm ' + seconds + ' dtk'
  if (minutes) return minutes + 'm ' + seconds + ' dtk'
  return seconds + ' dtk'
}

// Render progress belongs in the Pterodactyl/terminal log, not WhatsApp.
// WhatsApp is reserved for the initial acknowledgement, final result and errors.
function createRenderTerminalProgressReporter(session) {
  let closed = false
  const progress = createRenderProgressReporter(session, message => console.log(message))

  const heartbeatTimer = setInterval(() => {
    if (closed || !session.processing) return
    const current = session.progress || {
      percent: 0,
      stage: 'Menyiapkan render',
      detail: '',
      updatedAt: session.processingStartedAt || Date.now()
    }
    const quietMs = Math.max(0, Date.now() - (Number(current.updatedAt) || Date.now()))
    console.log('[RENDER] HEARTBEAT | pid=' + process.pid +
      ' | elapsed=' + formatRenderElapsed(Date.now() - (Number(session.processingStartedAt || session.createdAt) || Date.now())) +
      ' | stage=' + String(current.stage || 'Menyiapkan render') +
      ' | childPid=' + String(session.renderChildPid || 'not-started') +
      ' | childState=' + String(session.renderChildState || 'not-started') +
      ' | childOutputIdle=' + (session.renderChildLastOutputAt
        ? formatRenderElapsed(Date.now() - session.renderChildLastOutputAt)
        : 'no-output-yet') +
      ' | noProgressFor=' + formatRenderElapsed(quietMs))
  }, RENDER_STATUS_HEARTBEAT_MS)
  heartbeatTimer.unref?.()

  return {
    update: progress.update,
    async close() {
      if (closed) return
      closed = true
      clearInterval(heartbeatTimer)
    }
  }
}

function throwIfRenderCancelled(session) {
  if (!session?.cancelRequested && !session?.abortController?.signal?.aborted) return
  const error = new Error('Render dibatalkan atas permintaan pengguna.')
  error.code = 'RENDER_SCRIPT_CANCELLED'
  throw error
}

async function removeSession(session) {
  if (!session) return
  releaseRenderUpdateLock(session)
  if (!session.directory) return
  try {
    await fs.rm(session.directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 })
  } catch (error) {
    console.warn('[RENDER] Cleanup direktori job gagal:', error?.message || error)
  }
}

async function restoreCompletedRenderSessions() {
  const root = getRenderRoot()
  const restored = await restorePendingRenderSessions({
    root,
    staleTtlMs: STALE_JOB_TTL_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES
  })

  for (const { key, session } of restored) {
    if (pendingSessions.has(key)) continue
    pendingSessions.set(key, session)
  }

  orphanedRenderOutputs = await findOrphanedRenderOutputs({
    root,
    staleTtlMs: STALE_JOB_TTL_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES
  })

  if (restored.length) {
    console.log('[RENDER] Sesi hasil render yang belum terkirim dipulihkan:', restored.length)
  }
  if (orphanedRenderOutputs.length) {
    console.warn('[RENDER] Menemukan hasil render tanpa manifest sesi; file dipertahankan untuk pemulihan manual:', orphanedRenderOutputs.length)
  }
  return restored.length
}

async function attachOrphanedRenderOutput(key, index = 0) {
  const orphan = orphanedRenderOutputs[index]
  if (!orphan) throw new Error('Hasil render orphan yang dipilih tidak ditemukan.')
  if (pendingSessions.has(key)) throw new Error('Chat ini sudah memiliki sesi render aktif.')

  const session = {
    directory: orphan.directory,
    createdAt: orphan.createdAt,
    processing: false,
    progress: {
      percent: 95,
      stage: 'Hasil render tersimpan - pengiriman tertunda',
      detail: 'Hasil render dipulihkan dari file yang tersisa setelah proses bot terhenti. Tidak perlu merender ulang.',
      updatedAt: Date.now()
    },
    updateLockHeld: false,
    abortController: null,
    cancelRequested: false,
    deliveryWaiting: false,
    deliveryStartedAt: null,
    outputPath: orphan.outputPath,
    outputFileName: orphan.outputFileName,
    outputSize: orphan.outputSize,
    restored: true
  }

  await persistRenderOutputSession({
    root: getRenderRoot(),
    directory: session.directory,
    key,
    outputPath: session.outputPath,
    outputFileName: session.outputFileName,
    createdAt: session.createdAt,
    progress: session.progress
  })

  pendingSessions.set(key, session)
  orphanedRenderOutputs.splice(index, 1)
  console.log('[RENDER] Hasil render orphan berhasil dipulihkan:', {
    fileName: session.outputFileName,
    size: formatBytes(session.outputSize)
  })
  return session
}

let renderRecoveryPromise = null
function ensureRenderRecovery() {
  if (!renderRecoveryPromise) {
    renderRecoveryPromise = restoreCompletedRenderSessions().catch(error => {
      global.__alvarethRenderRecoveryError = error
      console.error('[RENDER] Pemulihan hasil render tertunda gagal:', error?.stack || error)
      throw error
    })
    global.__alvarethRenderRecoveryReady = renderRecoveryPromise
  }
  return renderRecoveryPromise
}

// Restore saved outputs before owner commands or updater can run.
void ensureRenderRecovery().catch(() => {})

async function ensureRenderRoot() {
  await ensureRenderRecovery()
  const root = getRenderRoot()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('ALVARETH_RENDER_TMPDIR harus menunjuk ke direktori biasa, bukan symlink.')
  }

  const activeDirectories = new Set([...pendingSessions.values()].map(item => path.resolve(item.directory)))
  let entries = []
  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch {}

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('alvareth-render-')) continue
    const candidate = path.join(root, entry.name)
    if (activeDirectories.has(path.resolve(candidate))) continue
    try {
      const stat = await fs.lstat(candidate)
      if (stat.isDirectory() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > STALE_JOB_TTL_MS) {
        await fs.rm(candidate, { recursive: true, force: true })
      }
    } catch {}
  }
  return root
}

async function downloadDocument(conn, media, options = {}) {
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 0
  const label = String(options.label || 'ZIP')
  let lastError

  if (typeof conn?.downloadM === 'function') {
    try {
      const result = await conn.downloadM(media, 'document')
      if (Buffer.isBuffer(result) || result instanceof Uint8Array) {
        const buffer = Buffer.from(result)
        if (maxBytes > 0 && buffer.length > maxBytes) {
          const error = new Error('File ' + label + ' melebihi batas ' + formatBytes(maxBytes) + '.')
          error.code = 'RENDER_ARCHIVE_TOO_LARGE'
          throw error
        }
        if (buffer.length) return buffer
      }
    } catch (error) {
      if (error?.code === 'RENDER_ARCHIVE_TOO_LARGE') throw error
      lastError = error
    }
  }

  try {
    const stream = await downloadContentFromMessage(media, 'document')
    const chunks = []
    let total = 0
    for await (const chunk of stream) {
      const part = Buffer.from(chunk)
      total += part.length
      if (maxBytes > 0 && total > maxBytes) {
        const error = new Error('File ' + label + ' melebihi batas ' + formatBytes(maxBytes) + '.')
        error.code = 'RENDER_ARCHIVE_TOO_LARGE'
        throw error
      }
      chunks.push(part)
    }
    const buffer = Buffer.concat(chunks)
    if (buffer.length) return buffer
  } catch (error) {
    if (error?.code === 'RENDER_ARCHIVE_TOO_LARGE') throw error
    lastError = error
  }

  throw new Error('File ' + label + ' tidak dapat diunduh dari WhatsApp' +
    (lastError?.message ? ': ' + String(lastError.message).slice(0, 250) : '.'))
}

async function deliverRenderedOutput({ m, key, session, progressReporter = null }) {
  const ownsProgressReporter = !progressReporter
  const progress = progressReporter || createRenderTerminalProgressReporter(session)
  const outputPath = session.outputPath

  try {
    throwIfRenderCancelled(session)
    const outputInfo = await fs.stat(outputPath)
    if (!outputInfo.isFile() || outputInfo.size < 1) {
      throw new Error('File hasil render tidak lagi tersedia di penyimpanan sesi.')
    }

    const socketReady = isWhatsAppSocketOpen(global.conn || m?.conn || null)
    session.deliveryWaiting = !socketReady
    session.deliveryWaitingSince = socketReady ? null : Date.now()
    session.deliveryStartedAt = socketReady ? Date.now() : null
    progress.update(
      95,
      socketReady ? 'Menyiapkan pengiriman WhatsApp' : 'Menunggu koneksi WhatsApp',
      socketReady
        ? 'Render selesai dan hasil video sudah tersimpan. Menyiapkan upload WhatsApp.'
        : 'Render selesai dan hasil video sudah tersimpan. Menunggu socket WhatsApp aktif untuk melanjutkan pengiriman.',
      true
    )
    await persistRenderOutputSession({
      root: getRenderRoot(),
      directory: session.directory,
      key,
      outputPath,
      outputFileName: path.basename(outputPath),
      createdAt: session.createdAt,
      progress: session.progress
    })
    // The output and recovery manifest are durable before an indefinite socket wait.
    // An updater/restart can now safely restore the completed video.
    releaseRenderUpdateLock(session)

    const result = await sendWithWhatsAppReconnect({
      getSocket: () => global.conn || m?.conn || null,
      signal: session.abortController?.signal,
      onWait: details => {
        if (details?.reason === 'waiting-for-connection' ||
            details?.reason === 'retry-after-disconnect') {
          session.deliveryWaiting = true
          session.deliveryWaitingSince ||= Date.now()
          progress.update(
            95,
            'Menunggu koneksi WhatsApp',
            'Render selesai dan hasil video sudah tersimpan. Menunggu socket WhatsApp aktif untuk melanjutkan pengiriman.',
            true
          )
          console.warn('[RENDER] Menunggu koneksi WhatsApp pulih sebelum mengirim hasil render.')
        }

        if (details?.reason === 'waiting-for-connection' ||
            details?.reason === 'connection-still-unavailable') {
          try {
            global.requestWhatsAppReconnect?.('Render selesai, tetapi socket WhatsApp belum aktif.')
          } catch (error) {
            console.error('[RENDER] Tidak dapat meminta reconnect WhatsApp:', error?.message || error)
          }
        }
      },
      onReconnectRequired: details => {
        const reason = 'Pengiriman hasil render terputus: ' +
          safeError(details?.error || 'Connection Closed')
        try {
          global.requestWhatsAppReconnect?.(reason)
        } catch (error) {
          console.error('[RENDER] Tidak dapat meminta reconnect WhatsApp:', error?.message || error)
        }
      },
      send: socket => {
        if (session.retryRequested || session.abortController?.signal.aborted) {
          const error = new Error('Pengiriman lama dihentikan agar percobaan kirim ulang dapat dimulai.')
          error.code = 'RENDER_SCRIPT_CANCELLED'
          throw error
        }
        if (global.__alvarethUpdateRunning) {
          const error = new Error('Pembaruan bot sedang berlangsung; hasil render tetap disimpan untuk dikirim setelah update.')
          error.code = 'RENDER_DELIVERY_DEFERRED'
          throw error
        }
        acquireRenderUpdateLock(session)
        if (global.__alvarethUpdateRunning) {
          releaseRenderUpdateLock(session)
          const error = new Error('Pembaruan bot dimulai sebelum upload; hasil render tetap disimpan untuk dikirim setelah update.')
          error.code = 'RENDER_DELIVERY_DEFERRED'
          throw error
        }
        session.deliveryWaiting = false
        session.deliveryWaitingSince = null
        session.deliveryStartedAt = Date.now()
        progress.update(95, 'Mengirim hasil ke WhatsApp', formatBytes(outputInfo.size), true)
        return sendLocalFile(socket, m.chat, outputPath, {
          quoted: socket === m.conn ? m : undefined,
          caption: '✅ Render berhasil. Berikut hasil videonya.'
        })
      }
    })

    await safeReact(m, '✅')
    progress.update(100, 'Selesai', 'Video berhasil dikirim ke WhatsApp.', true)
    if (pendingSessions.get(key) === session) pendingSessions.delete(key)
    session.processing = false
    session.deliveryWaiting = false
    session.deliveryWaitingSince = null
    session.deliveryStartedAt = null
    session.abortController = null
    await removeSession(session)
    console.log('[RENDER] Hasil dikirim:', {
      fileName: session.outputFileName || path.basename(outputPath),
      size: formatBytes(result.size || outputInfo.size),
      messageId: result.messageId
    })
    return true
  } catch (error) {
    const cancelled = error?.code === 'RENDER_SCRIPT_CANCELLED' ||
      session.cancelRequested || session.abortController?.signal.aborted

    if (cancelled && session.retryRequested && !session.cancelRequested) {
      session.processing = false
      session.deliveryWaiting = false
      session.deliveryWaitingSince = null
      session.deliveryStartedAt = null
      session.abortController = null
      releaseRenderUpdateLock(session)
      progress.update(
        95,
        'Hasil render siap dikirim ulang',
        'Penantian koneksi sebelumnya dihentikan. File yang sama tetap tersimpan.',
        true
      )
      return false
    }

    session.deliveryWaiting = false
    session.deliveryWaitingSince = null
    session.deliveryStartedAt = null

    if (!cancelled && isWhatsAppConnectionClosedError(error)) {
      try {
        global.requestWhatsAppReconnect?.(
          'Pengiriman hasil render terputus: ' + safeError(error)
        )
      } catch (reconnectError) {
        console.error('[RENDER] Tidak dapat meminta reconnect setelah upload gagal:', reconnectError?.message || reconnectError)
      }
    }

    let outputRecoveryPersisted = false
    if (!cancelled && session.outputPath) {
      try {
        await persistRenderOutputSession({
          root: getRenderRoot(),
          directory: session.directory,
          key,
          outputPath: session.outputPath,
          outputFileName: path.basename(session.outputPath),
          createdAt: session.createdAt,
          progress: session.progress
        })
        outputRecoveryPersisted = true
        console.log('[RENDER] Hasil render tersimpan untuk pemulihan lintas-restart:', session.outputPath)
      } catch (persistError) {
        console.error('[RENDER] Gagal menyimpan metadata pemulihan; update tetap ditahan:', persistError?.stack || persistError)
      }
    }

    // Keep processing=true until the manifest is durable so .render send
    // cannot race the manifest write and release the update lock prematurely.
    session.processing = false
    session.abortController = null
    if (outputRecoveryPersisted) {
      // A completed result is durable outside the replaceable project tree.
      releaseRenderUpdateLock(session)
    }

    if (cancelled) {
      progress.update(
        session.progress?.percent || 95,
        'Dibatalkan',
        'Pengiriman hasil render dibatalkan atas permintaan pengguna.',
        true
      )
      if (pendingSessions.get(key) === session) pendingSessions.delete(key)
      await safeReact(m, '🛑')
      await safeReply(m, '🛑 Pengiriman hasil render dibatalkan. File sementara dibersihkan.')
      await removeSession(session)
      return false
    }

    progress.update(
      95,
      'Hasil render tersimpan - pengiriman tertunda',
      safeError(error),
      true
    )
    console.error('[RENDER] Hasil render dipertahankan karena pengiriman tertunda:', {
      outputPath,
      error: error?.stack || error
    })
    await safeReact(m, '⚠️')
    await safeReply(
      m,
      '⚠️ Render sudah selesai dan file hasilnya tetap tersimpan di server, tetapi pengiriman WhatsApp belum berhasil: ' +
      safeError(error) +
      '\n\nKetik *.render send* untuk mencoba mengirim ulang hasil yang sama tanpa merender dari awal. Gunakan *.render cancel* jika ingin menghapus sesi dan file hasil.'
    )
    return false
  } finally {
    if (ownsProgressReporter) await progress.close()
  }
}

async function runTrackedRenderDelivery(options) {
  const session = options.session
  const promise = deliverRenderedOutput(options)
  session.deliveryPromise = promise
  try {
    return await promise
  } finally {
    if (session.deliveryPromise === promise) session.deliveryPromise = null
  }
}

function isZipDocument(filename, mimetype) {
  return /\.zip$/i.test(String(filename || '')) ||
    /application\/(?:zip|x-zip-compressed)|application\/x-zip/i.test(String(mimetype || ''))
}

function hasZipSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false
  const signature = buffer.subarray(0, 4).toString('hex')
  return signature === '504b0304' || signature === '504b0506' || signature === '504b0708'
}

const handler = async (m, { conn, text }) => {
  try {
    await ensureRenderRecovery()
  } catch (error) {
    return safeReply(m, '⏳ Status pemulihan hasil render belum dapat dipastikan. Update dan render baru ditahan demi menjaga file hasil. Detail: ' + safeError(error))
  }

  const key = sessionKey(m)
  if (!key) return safeReply(m, 'Identitas chat tidak terbaca. Coba kirim ulang perintah.')

  const action = String(text || '').trim().toLowerCase()

  const recoverMatch = action.match(/^recover(?:\s+(\d+))?$/)
  if (recoverMatch) {
    if (pendingSessions.has(key)) {
      return safeReply(m, 'Chat ini sudah memiliki sesi render. Gunakan *.render status* atau *.render send*.')
    }
    if (!orphanedRenderOutputs.length) {
      return safeReply(m, 'Tidak ada file hasil render orphan yang perlu dipulihkan.')
    }
    const requested = recoverMatch[1] ? Number(recoverMatch[1]) : 1
    if (!recoverMatch[1] && orphanedRenderOutputs.length > 1) {
      const list = orphanedRenderOutputs.map((item, index) =>
        (index + 1) + '. ' + item.outputFileName + ' — ' + formatBytes(item.outputSize) +
        ' — ' + new Date(item.createdAt).toLocaleString('id-ID')
      )
      return safeReply(m, 'Ditemukan beberapa hasil render tanpa metadata sesi:\n' +
        list.join('\n') + '\nPilih file dengan *.render recover 1*, *.render recover 2*, dan seterusnya.')
    }
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > orphanedRenderOutputs.length) {
      return safeReply(m, 'Nomor hasil render tidak valid. Gunakan *.render recover* untuk melihat daftar.')
    }
    try {
      const recovered = await attachOrphanedRenderOutput(key, requested - 1)
      return safeReply(m, '♻️ Hasil render berhasil dipulihkan: ' + recovered.outputFileName +
        ' (' + formatBytes(recovered.outputSize) + '). Gunakan *.render send* untuk mengirim video tanpa merender ulang.')
    } catch (error) {
      return safeReply(m, '❌ Hasil render belum dapat dipulihkan: ' + safeError(error))
    }
  }

  if (action === 'status') {
    const session = pendingSessions.get(key)
    if (!session && orphanedRenderOutputs.length) {
      return safeReply(m, '⚠️ Ada ' + orphanedRenderOutputs.length +
        ' file hasil render yang masih tersimpan tetapi metadata sesinya hilang. Gunakan *.render recover* agar dapat dikirim tanpa render ulang.')
    }
    if (!session) return safeReply(m, 'Tidak ada sesi render aktif.')
    if (session.kind === 'html-template' && !session.processing && !session.outputPath) {
      const manifest = session.manifest || {}
      const received = Array.isArray(session.photos) ? session.photos.length : 0
      const needed = Number(manifest.requiredPhotos || 0)
      if (received < needed) {
        const missing = (manifest.photoDescriptions || []).slice(received)
          .map((description, index) => (received + index + 1) + '. ' + description)
        return safeReply(m, [
          '📸 Menunggu foto untuk template ' + String(manifest.title || 'HTML') + '.',
          'Foto diterima: ' + received + '/' + needed,
          missing.length ? 'Masih kurang:\n' + missing.join('\n') : '',
          'Kirim foto sebagai foto (bukan dokumen) di chat ini.'
        ].filter(Boolean).join('\n'))
      }
      return safeReply(m, '❌ Render template terakhir gagal: ' + safeError(session.progress?.detail || 'Kesalahan tidak diketahui.') +
        '\n\nFoto dan paket template masih tersimpan. Ketik *.render retry* untuk mencoba lagi, atau *.render cancel* untuk membatalkan.')
    }
    if (session.processing && session.deliveryWaiting) {
      const now = Date.now()
      const waitingSince = Number(session.deliveryWaitingSince) || now
      const lines = [
        '📦 Render sudah selesai. Video hasil render sudah tersimpan di server.',
        'Status: menunggu koneksi WhatsApp untuk pengiriman.',
        'Waktu menunggu: ' + formatRenderElapsed(now - waitingSince),
        'Ukuran hasil: ' + formatBytes(session.outputSize || 0),
        'Ketik *.render send* untuk menghentikan penantian dan mencoba kirim ulang.',
        'Ketik *.render cancel* hanya jika ingin menghapus hasil render.'
      ]
      return safeReply(m, lines.join('\n'))
    }
    if (session.processing && session.outputPath) {
      const now = Date.now()
      const startedAt = Number(session.deliveryStartedAt) || now
      const lines = [
        '📤 Render sudah selesai. Video sedang dikirim ke WhatsApp.',
        'Status: upload media berjalan.',
        'Waktu pengiriman: ' + formatRenderElapsed(now - startedAt),
        'Ukuran hasil: ' + formatBytes(session.outputSize || 0),
        'Ketik *.render status* untuk memeriksa kembali.'
      ]
      return safeReply(m, lines.join('\n'))
    }
    if (session.processing) {
      const progress = session.progress || {}
      const now = Date.now()
      const startedAt = Number(session.processingStartedAt || session.createdAt) || now
      const lastProgressAt = Number(progress.updatedAt) || startedAt
      const quietMs = Math.max(0, now - lastProgressAt)
      const childIdleMs = session.renderChildLastOutputAt
        ? Math.max(0, now - session.renderChildLastOutputAt)
        : null
      const lines = [
        '⏳ Render berjalan di background.',
        'Waktu proses: ' + formatRenderElapsed(now - startedAt),
        'Persentase dan detail FFmpeg ditampilkan langsung di terminal/Pterodactyl.'
      ]
      if (session.renderChildPid) {
        lines.push('Proses shell: PID ' + session.renderChildPid + ' (' + String(session.renderChildState || 'running') + ').')
      }
      if (childIdleMs !== null) {
        lines.push('Output proses terakhir: ' + formatRenderElapsed(childIdleMs) + ' yang lalu.')
      }
      if (quietMs >= RENDER_STATUS_HEARTBEAT_MS) {
        if (session.renderChildPid && session.renderChildState === 'running' &&
            childIdleMs !== null && childIdleMs < RENDER_STATUS_HEARTBEAT_MS) {
          lines.push('ℹ️ Script masih mengeluarkan output, tetapi belum ada perubahan angka progres FFmpeg.')
        } else if (session.renderChildPid && session.renderChildState === 'running') {
          lines.push('⚠️ Shell PID ' + session.renderChildPid + ' masih tercatat berjalan, tetapi tidak mengeluarkan output selama ' +
            formatRenderElapsed(childIdleMs ?? quietMs) + '. Proses tidak dihentikan otomatis.')
        } else if (session.renderChildPid && session.renderChildState === 'exited') {
          lines.push('⚠️ Shell PID ' + session.renderChildPid + ' sudah keluar, tetapi worker masih menunggu stream/proses turunannya ditutup.')
        } else {
          lines.push('⚠️ Belum ada perubahan progres selama ' + formatRenderElapsed(quietMs) + '. Worker masih menunggu/menjalankan tahap ini.')
        }
      }
      return safeReply(m, lines.join('\n'))
    }
    if (session.outputPath) {
      return safeReply(m, '✅ Hasil render sudah selesai dan tersimpan di server. Pengiriman belum terkonfirmasi. Gunakan *.render send* untuk mengirim file yang sama tanpa mengulang render.')
    }
    if (/gagal/i.test(String(session.progress?.stage || ''))) {
      return safeReply(m, '❌ Render terakhir gagal: ' + safeError(session.progress?.detail || 'Kesalahan tidak diketahui.'))
    }
    return safeReply(m, '⏳ Sesi render aktif dan sedang menunggu paket ZIP. Kirim ZIP sebagai dokumen di chat yang sama.')
  }

  if (action === 'send') {
    if (global.__alvarethUpdateRunning) {
      return safeReply(m, '⏳ Update sedang berlangsung. Pengiriman hasil render akan dilanjutkan setelah bot selesai diperbarui.')
    }
    let session = pendingSessions.get(key)
    if (!session) {
      if (orphanedRenderOutputs.length === 1) {
        try {
          session = await attachOrphanedRenderOutput(key, 0)
        } catch (error) {
          return safeReply(m, '❌ Hasil render lama ditemukan, tetapi belum dapat dipulihkan: ' + safeError(error))
        }
      } else if (orphanedRenderOutputs.length > 1) {
        return safeReply(m, 'Ada ' + orphanedRenderOutputs.length + ' hasil render tanpa metadata sesi. Gunakan *.render recover* untuk melihat daftar dan memilih file yang benar.')
      }
    }
    if (!session) return safeReply(m, 'Tidak ada sesi render aktif atau hasil render yang dapat dipulihkan.')

    if (session.processing && session.deliveryWaiting && session.deliveryPromise) {
      if (session.retryRequested) {
        return safeReply(m, '⏳ Percobaan ulang pengiriman sebelumnya sedang diproses.')
      }
      session.retryRequested = true
      session.abortController?.abort()
      try {
        await session.deliveryPromise
      } catch (error) {
        console.error('[RENDER] Penantian pengiriman lama gagal dihentikan:', error?.stack || error)
      } finally {
        session.retryRequested = false
      }
    }

    if (session.processing) return safeReply(m, '⏳ Render atau upload WhatsApp masih berjalan. Periksa kembali dengan *.render status*.')
    if (!session.outputPath) return safeReply(m, 'Belum ada hasil render yang siap dikirim. Selesaikan proses render terlebih dahulu.')
    if (global.__alvarethUpdateRunning) {
      return safeReply(m, '⏳ Update sedang berlangsung. Hasil render tetap tersimpan; coba *.render send* setelah update selesai.')
    }

    acquireRenderUpdateLock(session)
    if (global.__alvarethUpdateRunning) {
      releaseRenderUpdateLock(session)
      return safeReply(m, '⏳ Update baru saja dimulai. Hasil render tetap tersimpan; coba *.render send* setelah update selesai.')
    }

    try {
      const outputInfo = await fs.stat(session.outputPath)
      if (!outputInfo.isFile() || outputInfo.size < 1) throw new Error('File hasil render kosong atau tidak tersedia.')
    } catch (error) {
      releaseRenderUpdateLock(session)
      return safeReply(m, '❌ File hasil render tidak dapat ditemukan: ' + safeError(error) + '. Jalankan render ulang dengan mengirim video dan ZIP.')
    }

    session.processing = true
    session.processingStartedAt = Date.now()
    session.cancelRequested = false
    session.abortController = new AbortController()
    await safeReply(m, '📤 Hasil render ditemukan. Bot akan mengirim file yang tersimpan tanpa menjalankan render ulang.')
    const progress = createRenderTerminalProgressReporter(session)
    void runTrackedRenderDelivery({ m, key, session, progressReporter: progress }).catch(async error => {
      console.error('[RENDER] Retry pengiriman hasil gagal:', error?.stack || error)
      session.processing = false
      session.abortController = null
      progress.update(95, 'Hasil render tersimpan - pengiriman tertunda', safeError(error), true)
      await safeReply(m, '⚠️ Hasil render tetap tersimpan. Pengiriman ulang belum berhasil: ' + safeError(error) + '. Coba *.render send* kembali setelah koneksi pulih.')
    }).finally(() => progress.close())
    return
  }

  if (action === 'cancel') {
    const session = pendingSessions.get(key)
    if (!session) return safeReply(m, 'Tidak ada sesi render aktif.')
    if (session.processing) {
      if (session.progress?.stage === 'Mengirim hasil ke WhatsApp') {
        return safeReply(m, '📤 Hasil sudah masuk tahap pengiriman dan tidak dapat dibatalkan lagi.')
      }
      if (session.cancelRequested) {
        return safeReply(m, '🛑 Permintaan pembatalan render sudah dikirim.')
      }
      session.cancelRequested = true
      session.abortController?.abort()
      return safeReply(m, '🛑 Permintaan pembatalan diterima. Bot sedang menghentikan render dan proses turunannya; konfirmasi akan dikirim setelah proses berhenti.')
    }
    pendingSessions.delete(key)
    await removeSession(session)
    return safeReply(m, '🛑 Sesi render dibatalkan dan file sementara dibersihkan.')
  }

  if (action === 'retry') {
    const session = pendingSessions.get(key)
    if (!session || session.kind !== 'html-template') {
      return safeReply(m, 'Tidak ada render template yang bisa diulang. Reply paket template *.zip* dengan *.render* untuk memulai sesi baru.')
    }
    if (session.processing) return safeReply(m, '⏳ Render template masih berjalan. Periksa kembali dengan *.render status*.')
    if (session.outputPath) {
      return safeReply(m, 'Hasil render sebelumnya masih tersimpan. Gunakan *.render send* untuk mengirimnya atau *.render cancel* untuk menghapusnya.')
    }
    const received = Array.isArray(session.photos) ? session.photos.length : 0
    if (received !== Number(session.manifest?.requiredPhotos || 0) || !session.packageDirectory) {
      return safeReply(m, 'Foto template belum lengkap. Kirim foto yang kurang sesuai *.render status*, atau mulai ulang dengan reply ZIP template.')
    }
    if (global.__alvarethUpdateRunning) {
      return safeReply(m, '⏳ Update sedang berlangsung. Paket dan foto template tetap tersimpan; coba *.render retry* setelah update selesai.')
    }
    acquireRenderUpdateLock(session)
    if (global.__alvarethUpdateRunning) {
      releaseRenderUpdateLock(session)
      return safeReply(m, '⏳ Update baru saja dimulai. Paket dan foto template tetap tersimpan; coba *.render retry* setelah update selesai.')
    }
    session.processing = true
    session.processingStartedAt = Date.now()
    session.cancelRequested = false
    session.abortController = new AbortController()
    await safeReact(m, '🎬')
    await safeReply(m, '🔁 Mengulang render template dari foto yang sudah diterima. Tidak perlu mengirim foto lagi.')
    void processTemplateRenderJob({ conn, m, key, session }).catch(async error => {
      console.error('[RENDER] Retry render template gagal:', error?.stack || error)
      session.processing = false
      session.abortController = null
      await safeReply(m, '❌ Render template gagal: ' + safeError(error) +
        '\n\nFoto dan paket template masih tersimpan. Ketik *.render retry* untuk mencoba lagi.')
    })
    return
  }

  if (action) {
    return safeReply(m, 'Format: reply video dengan *.render* (paket render.sh), atau reply paket template *.zip* dengan *.render* (manifest.json + render.html). Perintah lain: *.render status*, *.render send*, *.render recover*, *.render retry*, dan *.render cancel*.')
  }

  if (global.__alvarethUpdateRunning) {
    return safeReply(m, '⏳ Render ditunda karena pembaruan bot sedang berlangsung. Coba lagi setelah bot selesai diperbarui.')
  }

  if (orphanedRenderOutputs.length) {
    return safeReply(m, '⚠️ Ada hasil render lama yang belum dipulihkan. Gunakan *.render recover* lalu *.render send* sebelum memulai render baru.')
  }

  const previous = pendingSessions.get(key)
  if (previous?.processing) {
    return safeReply(m, 'Render sebelumnya masih berjalan. Tunggu sampai selesai.')
  }
  if (previous?.outputPath) {
    return safeReply(m, 'Hasil render sebelumnya masih tersimpan dan belum terkirim. Gunakan *.render send* untuk mengirimnya atau *.render cancel* untuk menghapusnya sebelum memulai render baru.')
  }
  if (previous) {
    pendingSessions.delete(key)
    await removeSession(previous)
  }

  const mediaInfo = await resolveQuotedMediaInfo(m, conn)
  const mediaType = String(mediaInfo?.type || '').toLowerCase()
  const mime = String(mediaInfo?.mime || '').toLowerCase()
  const isVideo = /^(?:video|ptv)message$/.test(mediaType) || mime.startsWith('video/')

  const quotedFileName = String(mediaInfo?.media?.fileName || mediaInfo?.media?.file_name || mediaInfo?.media?.filename || '')
  const isQuotedZip = mediaType === 'documentmessage' &&
    (/\.zip$/i.test(quotedFileName) ||
      /application\/(?:zip|x-zip-compressed)|application\/x-zip/i.test(mime))

  if (isQuotedZip) {
    return startTemplateRenderSession({ m, conn, key, mediaInfo, quotedFileName })
  }

  if (!mediaInfo || !isVideo) {
    return safeReply(m, 'Kirim video ke chat ini, lalu reply video tersebut dengan *.render*. Setelah itu bot akan meminta paket render *.zip*.\n\nAtau kirim paket template *.zip* (manifest.json + render.html), lalu reply ZIP tersebut dengan *.render* — bot akan meminta foto yang dibutuhkan, lalu merender MP4 setelah semua foto diterima.')
  }

  const declaredSize = toSafeNumber(mediaInfo.media?.fileLength)
  if (declaredSize > MAX_VIDEO_BYTES) {
    return safeReply(m, 'Ukuran video ' + formatBytes(declaredSize) + ' melebihi batas render ' + formatBytes(MAX_VIDEO_BYTES) + '.')
  }

  let sessionDirectory
  try {
    const videoBuffer = await downloadQuotedMedia(m, conn)
    if (!Buffer.isBuffer(videoBuffer) || !videoBuffer.length) {
      throw new Error('Video yang direply terdeteksi, tetapi gagal diunduh dari WhatsApp.')
    }
    if (videoBuffer.length > MAX_VIDEO_BYTES) {
      throw new Error('Ukuran video ' + formatBytes(videoBuffer.length) + ' melebihi batas render ' + formatBytes(MAX_VIDEO_BYTES) + '.')
    }

    const detected = await fileTypeFromBuffer(videoBuffer.subarray(0, Math.min(videoBuffer.length, 4100)))
    if (detected && !VIDEO_EXTENSIONS.has(String(detected.ext || '').toLowerCase())) {
      throw new Error('Isi file yang diterima tidak dikenali sebagai format video.')
    }

    const root = await ensureRenderRoot()
    sessionDirectory = await fs.mkdtemp(path.join(root, 'alvareth-render-'))
    await fs.chmod(sessionDirectory, 0o700).catch(() => {})

    const extension = VIDEO_EXTENSIONS.has(String(detected?.ext || '').toLowerCase())
      ? String(detected.ext).toLowerCase()
      : 'mp4'
    const videoPath = path.join(sessionDirectory, 'source-video.' + extension)
    await fs.writeFile(videoPath, videoBuffer, { mode: 0o600, flag: 'wx' })

    await evictOldestIdleRenderSession()

    pendingSessions.set(key, {
      kind: 'video',
      directory: sessionDirectory,
      videoPath,
      originalName: String(mediaInfo.media?.fileName || 'video.' + extension).slice(0, 120),
      createdAt: Date.now(),
      processing: false,
      progress: {
        percent: 0,
        stage: 'Menunggu paket ZIP',
        detail: 'Kirim paket ZIP sebagai dokumen di chat yang sama.',
        updatedAt: Date.now()
      },
      updateLockHeld: true,
      abortController: null,
      cancelRequested: false,
      deliveryWaiting: false,
      deliveryWaitingSince: null,
      deliveryStartedAt: null,
      outputPath: null,
      outputFileName: null,
      outputSize: 0
    })
    global.__alvarethRenderJobs = Math.max(0, Number(global.__alvarethRenderJobs) || 0) + 1

    return safeReply(
      m,
      '🎬 Video diterima (' + formatBytes(videoBuffer.length) + ').\n\nSekarang kirim paket render *.zip* sebagai dokumen di chat yang sama. Bot akan mengekstrak aset dan menjalankan render.sh dari dalam paket tersebut.\n\nSesi tetap aktif sampai ZIP diterima atau kamu membatalkannya. Tidak ada batas waktu otomatis; gunakan *.render cancel* untuk membatalkan.'
    )
  } catch (error) {
    if (sessionDirectory) await fs.rm(sessionDirectory, { recursive: true, force: true }).catch(() => {})
    console.error('[RENDER] Gagal menyiapkan video:', error?.stack || error)
    return safeReply(m, '❌ Video gagal disiapkan: ' + safeError(error))
  }
}

handler.all = async function (m) {
  // A document can belong to another ZIP workflow such as .motion.
  if (m?.__alvarethMotionZipHandled || m?.__alvarethRenderZipHandled) return

  // Photos for an HTML template session arrive as ordinary image messages,
  // often as one album sent at once. Collect them here; documents below
  // belong to the video + render.sh flow.
  if (isTemplatePhotoEvent(m)) {
    const key = sessionKey(m)
    const session = key ? pendingSessions.get(key) : null
    if (session?.kind === 'html-template' && !session.outputPath) {
      await collectTemplatePhoto.call(this, m, key, session)
      return
    }
  }

  if (!isRenderDocumentEvent(m)) return

  try {
    await ensureRenderRecovery()
  } catch (error) {
    // This global listener also sees ZIPs owned by other workflows. Keep it
    // silent when .render recovery is unavailable so unrelated jobs continue.
    console.error('[RENDER] Pemulihan sesi belum siap; dokumen diabaikan:', safeError(error))
    return
  }

  const document = getCurrentDocument(m)
  const filename = path.basename(String(
    document?.fileName || document?.file_name || document?.filename || ''
  ).trim())
  const mimetype = String(
    document?.mimetype || document?.mimeType || document?.mime || ''
  ).toLowerCase()
  const isZip = isZipDocument(filename, mimetype)
  const key = sessionKey(m)

  if (!key) return

  // This hook sees every document in every chat. Do not claim or warn about a
  // ZIP unless this chat actually started a .render session.
  const session = pendingSessions.get(key)
  if (!session) return

  if (!document) {
    return safeReply(m, 'Dokumen terdeteksi, tetapi metadata file tidak dapat dibaca. Kirim ulang pack.zip sebagai dokumen WhatsApp.')
  }

  if (isZip) m.__alvarethRenderZipHandled = true

  if (session.processing) {
    return safeReply(m, 'Paket render untuk sesi ini sedang diproses. Tunggu sampai selesai.')
  }

  if (global.__alvarethUpdateRunning) {
    return safeReply(m, '⏳ Paket ZIP diterima, tetapi pembaruan bot sedang berlangsung. Coba kirim ulang ZIP setelah update selesai.')
  }

  if (!isZip) {
    return safeReply(m, 'File yang diminta harus berupa paket *.zip* dan dikirim sebagai dokumen. Video masih tersimpan; kirim file ZIP dari Claude.')
  }

  session.processing = true
  session.processingStartedAt = Date.now()
  session.cancelRequested = false
  session.abortController = new AbortController()
  const conn = m.conn || this
  void safeReact(m, '⚙️')
  void safeReply(
    m,
    '📦 Paket ZIP diterima. ⚙️ Render mulai diproses di background. Fitur bot lain tetap dapat digunakan; tidak ada batas waktu otomatis. Gunakan *.render cancel* untuk menghentikan.'
  )
  void processRenderJob({ conn, m, document, key, session }).catch(async error => {
    console.error('[RENDER] Background worker gagal:', error?.stack || error)
    session.processing = false
    session.abortController = null
    if (session.cancelRequested) {
      if (pendingSessions.get(key) === session) pendingSessions.delete(key)
      await safeReact(m, '🛑')
      await safeReply(m, '🛑 Render dibatalkan. Proses render dihentikan.')
      await removeSession(session)
      return
    }
    const progress = createRenderTerminalProgressReporter(session)
    progress.update(session.progress?.percent || 0, 'Render gagal', safeError(error), true)
    await safeReact(m, '❌')
    const recoveryMessage = session.outputPath
      ? '\n\nHasil render tetap tersimpan. Gunakan *.render send* untuk mengirimnya tanpa mengulang proses.'
      : '\n\nVideo masih tersimpan. Kirim ulang ZIP atau gunakan *.render cancel*.'
    await safeReply(
      m,
      '❌ Render berhenti karena kesalahan internal: ' + safeError(error) + recoveryMessage
    )
    await progress.close()
  })
  return
}

async function processRenderJob({ conn, m, document, key, session }) {
  const progress = createRenderTerminalProgressReporter(session)
  let workDirectory
  try {
    progress.update(1, 'Mengunduh paket ZIP', '', true)
    throwIfRenderCancelled(session)
    const archiveBuffer = await downloadDocument(conn, document, {
      label: 'ZIP'
    })
    throwIfRenderCancelled(session)
    if (!hasZipSignature(archiveBuffer)) {
      throw new Error('File yang dikirim tidak memiliki signature ZIP yang valid. Kirim ulang arsip .zip dari Claude.')
    }

    progress.update(4, 'Memeriksa paket ZIP', formatBytes(archiveBuffer.length), true)

    workDirectory = await fs.mkdtemp(path.join(session.directory, 'run-'))
    await fs.chmod(workDirectory, 0o700).catch(() => {})
    const packageDirectory = path.join(workDirectory, 'package')
    await fs.mkdir(packageDirectory, { recursive: true, mode: 0o700 })

    progress.update(7, 'Mengekstrak aset ZIP', '', true)
    const extracted = await extractRenderArchive(archiveBuffer, packageDirectory, {
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxFileBytes: MAX_ARCHIVE_FILE_BYTES,
      maxTotalBytes: MAX_ARCHIVE_UNPACKED_BYTES
    })
    throwIfRenderCancelled(session)
    const scriptPath = await findRenderScript(packageDirectory)
    const scriptDirectory = path.dirname(scriptPath)

    const inputPath = path.join(scriptDirectory, '378541.mp4')
    for (const reservedName of ['378541.mp4', 'input.mp4', 'video.mp4']) {
      const reservedPath = path.join(scriptDirectory, reservedName)
      try {
        await fs.lstat(reservedPath)
        throw new Error('ZIP memakai nama file input yang dicadangkan: ' + reservedName + '. Hapus file tersebut dari paket.')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }

    progress.update(9, 'Menyiapkan video input', '', true)
    await fs.copyFile(session.videoPath, inputPath)
    for (const alias of ['input.mp4', 'video.mp4']) {
      await fs.symlink('378541.mp4', path.join(scriptDirectory, alias))
    }

    const scriptSource = await fs.readFile(scriptPath, 'utf8')
    const progressDurationSeconds = parseRenderDurationSeconds(scriptSource)
    progress.update(
      10,
      'Menjalankan render.sh',
      progressDurationSeconds
        ? 'Target durasi: ' + progressDurationSeconds.toFixed(1) + ' detik; tahap perintah dan progres FFmpeg dipantau langsung.'
        : 'Durasi target tidak terdeteksi; tahap perintah dan aktivitas FFmpeg tetap dipantau.',
      true
    )

    const startedAt = Date.now()
    const processResult = await runRenderScript({
      scriptPath,
      workingDirectory: scriptDirectory,
      inputPath,
      signal: session.abortController?.signal,
      progressDurationSeconds,
      onStage: value => {
        progress.update(10, String(value.stage || 'Menjalankan render.sh'),
          value.command ? 'Perintah: ' + value.command : '')
      },
      onProcess: value => {
        session.renderChildState = value.running ? 'running' : String(value.state || 'unknown')
        session.renderChildPid = value.pid || null
        session.renderChildLastOutputAt = Number(value.lastOutputAt) || session.renderChildLastOutputAt || null
        session.renderChildStdoutBytes = Number(value.stdoutBytes) || 0
        session.renderChildStderrBytes = Number(value.stderrBytes) || 0

        if (value.state === 'started') {
          progress.update(10, 'Menjalankan render.sh',
            'Shell process aktif dengan PID ' + String(value.pid || 'tidak diketahui') + '.', true)
        } else if (value.state === 'exited') {
          session.renderChildExitCode = value.code
          session.renderChildSignal = value.signal || null
          progress.update(10, 'Shell process telah keluar',
            'Exit code: ' + String(value.code) +
            (value.signal ? ' | Signal: ' + value.signal : '') +
            '. Menunggu seluruh output dan proses turunan selesai.', true)
        } else if (value.state === 'closed') {
          progress.update(90, 'Script render selesai',
            'Exit code: ' + String(value.code) + (value.signal ? ' | Signal: ' + value.signal : '') +
            ' | Durasi: ' + formatRenderElapsed(value.durationMs), true)
        } else if (value.state === 'error') {
          progress.update(session.progress?.percent || 10, 'Gagal menjalankan shell',
            String(value.error || 'Proses shell gagal dibuat.'), true)
        }
      },
      onProgress: value => {
        const rawPercent = Number.isFinite(value.percent) ? value.percent : null
        const percent = rawPercent === null ? 10 : 10 + Math.round(rawPercent * 0.8)
        const detail = [
          Number.isFinite(value.currentTimeSeconds) && Number.isFinite(value.durationSeconds)
            ? 'Waktu FFmpeg: ' + value.currentTimeSeconds.toFixed(1) + ' / ' + value.durationSeconds.toFixed(1) + ' detik.'
            : '',
          Number.isFinite(value.frame) ? 'Frame: ' + value.frame : '',
          Number.isFinite(value.fps) ? 'FPS: ' + value.fps : '',
          value.speed ? 'Kecepatan: ' + value.speed : ''
        ].filter(Boolean).join(' | ')
        progress.update(percent, 'Render FFmpeg', detail)
      }
    })
    throwIfRenderCancelled(session)
    console.log('[RENDER] Paket ZIP selesai dijalankan:', {
      archiveFiles: extracted.files.length,
      extractedBytes: formatBytes(extracted.totalBytes),
      durationSeconds: Number((processResult.durationMs / 1000).toFixed(1)),
      exitCode: processResult.code
    })

    progress.update(92, 'Memvalidasi hasil render', '', true)
    const output = await findRenderOutput(scriptDirectory, {
      excludePaths: [scriptPath, inputPath],
      startedAt
    })
    throwIfRenderCancelled(session)
    if (!output) {
      throw new Error('Script selesai, tetapi file video hasil render tidak ditemukan. Simpan hasil sebagai file MP4 di folder yang sama dengan render.sh.')
    }
    if (output.size > MAX_OUTPUT_BYTES) {
      throw new Error('Ukuran hasil render ' + formatBytes(output.size) + ' melebihi batas pengiriman ' + formatBytes(MAX_OUTPUT_BYTES) + '.')
    }

    const outputExtension = path.extname(output.path).toLowerCase()
    const safeOutputExtension = VIDEO_EXTENSIONS.has(outputExtension.replace(/^\./, ''))
      ? outputExtension
      : '.mp4'
    const storedOutputPath = path.join(session.directory, 'render-result' + safeOutputExtension)
    await fs.rename(output.path, storedOutputPath)
    await fs.chmod(storedOutputPath, 0o600).catch(() => {})
    session.outputPath = storedOutputPath
    session.outputFileName = path.basename(output.path)
    session.outputSize = output.size

    // The final video now lives outside the extracted ZIP work directory.
    // Removing scripts/assets cannot delete the recoverable rendered output.
    if (workDirectory) {
      await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => {})
      workDirectory = undefined
    }

    throwIfRenderCancelled(session)
    await runTrackedRenderDelivery({ m, key, session, progressReporter: progress })
  } catch (error) {
    console.error('[RENDER] Proses render ZIP gagal:', error?.stack || error)
    if (workDirectory) {
      await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => {})
    }

    const cancelled = error?.code === 'RENDER_SCRIPT_CANCELLED' ||
      session.cancelRequested || session.abortController?.signal.aborted
    if (cancelled) {
      progress.update(
        session.progress?.percent || 0,
        'Dibatalkan',
        'Render dihentikan atas permintaan pengguna.',
        true
      )
      session.processing = false
      session.abortController = null
      if (pendingSessions.get(key) === session) pendingSessions.delete(key)
      await safeReact(m, '🛑')
      await safeReply(m, '🛑 Render dibatalkan. Proses render dan proses turunannya telah dihentikan.')
      await removeSession(session)
      return
    }

    progress.update(
      session.progress?.percent || 0,
      'Render gagal',
      safeError(error),
      true
    )
    session.processing = false
    session.abortController = null
    await safeReact(m, '❌')
    const exitDetails = error?.exitCode !== undefined && error?.exitCode !== null
      ? '\nKode keluar: ' + error.exitCode
      : error?.signal ? '\nSinyal: ' + error.signal : ''
    await safeReply(
      m,
      '❌ Render gagal: ' + safeError(error) + exitDetails +
      '\n\nVideo masih tersimpan. Kirim ulang ZIP yang sudah diperbaiki atau gunakan *.render cancel*.'
    )
  } finally {
    await progress.close()
  }
}


async function collectTemplatePhoto(m, key, session) {
  if (!session || session.kind !== 'html-template') return
  const messageId = String(m?.key?.id || '')
  if (messageId && Array.isArray(session.receivedMessageIds) && session.receivedMessageIds.includes(messageId)) return

  if (session.processing) {
    return safeReply(m, '⏳ Render template sedang berjalan. Tunggu sampai selesai.')
  }

  const manifest = session.manifest || {}
  const needed = Number(manifest.requiredPhotos || 0)
  const received = Array.isArray(session.photos) ? session.photos.length : 0
  if (received >= needed) return

  const conn = m.conn || this
  let imageBuffer
  try {
    imageBuffer = await downloadIncomingImage(m, conn)
  } catch (error) {
    return safeReply(m, '❌ Foto gagal diunduh: ' + safeError(error) + '. Kirim ulang foto tersebut.')
  }
  if (imageBuffer.length > MAX_TEMPLATE_PHOTO_BYTES) {
    return safeReply(m, '❌ Foto melebihi batas ' + formatBytes(MAX_TEMPLATE_PHOTO_BYTES) + '. Kirim foto yang lebih kecil.')
  }

  let detected = null
  try {
    detected = await fileTypeFromBuffer(imageBuffer.subarray(0, Math.min(imageBuffer.length, 4100)))
  } catch {}
  const extension = String(detected?.ext || '').toLowerCase()
  if (!detected || !PHOTO_EXTENSIONS.has(extension)) {
    return safeReply(m, '❌ File yang dikirim bukan foto JPG/PNG/WebP. Kirim ulang sebagai foto biasa.')
  }

  const photoIndex = received + 1
  const photoPath = path.join(session.photoDirectory, 'photo-' + photoIndex + '.' + extension)
  try {
    await fs.writeFile(photoPath, imageBuffer, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    console.error('[RENDER] Gagal menyimpan foto template:', error?.message || error)
    return safeReply(m, '❌ Foto gagal disimpan di server. Kirim ulang foto tersebut.')
  }
  if (messageId) session.receivedMessageIds.push(messageId)
  session.photos.push({ index: photoIndex, path: photoPath, size: imageBuffer.length })
  session.progress = {
    percent: Math.round((photoIndex / needed) * 100),
    stage: 'Menunggu foto',
    detail: 'Foto diterima: ' + photoIndex + '/' + needed,
    updatedAt: Date.now()
  }

  if (photoIndex < needed) {
    await safeReact(m, '✅')
    return
  }

  session.processing = true
  session.processingStartedAt = Date.now()
  session.cancelRequested = false
  session.abortController = new AbortController()
  await safeReact(m, '⚙️')
  await safeReply(
    m,
    '📸 Semua ' + needed + ' foto diterima. ⚙️ Render template mulai diproses di background. Fitur bot lain tetap dapat digunakan; tidak ada batas waktu otomatis. Gunakan *.render cancel* untuk menghentikan.'
  )
  void processTemplateRenderJob({ conn, m, key, session }).catch(async error => {
    console.error('[RENDER] Background worker template gagal:', error?.stack || error)
    session.processing = false
    session.abortController = null
    if (session.cancelRequested) {
      if (pendingSessions.get(key) === session) pendingSessions.delete(key)
      await safeReact(m, '🛑')
      await safeReply(m, '🛑 Render dibatalkan. Proses render dihentikan.')
      await removeSession(session)
      return
    }
    const progress = createRenderTerminalProgressReporter(session)
    progress.update(session.progress?.percent || 0, 'Render gagal', safeError(error), true)
    await safeReact(m, '❌')
    await safeReply(
      m,
      '❌ Render template gagal: ' + safeError(error) +
      '\n\nFoto dan paket template masih tersimpan. Ketik *.render retry* untuk mencoba lagi tanpa mengirim foto ulang, atau *.render cancel* untuk membatalkan.'
    )
    await progress.close()
  })
}

async function startTemplateRenderSession({ m, conn, key, mediaInfo, quotedFileName }) {
  const declaredSize = toSafeNumber(mediaInfo?.media?.fileLength)
  if (declaredSize > MAX_TEMPLATE_ARCHIVE_BYTES) {
    return safeReply(m, 'Ukuran ZIP template ' + formatBytes(declaredSize) + ' melebihi batas ' + formatBytes(MAX_TEMPLATE_ARCHIVE_BYTES) + '.')
  }

  let sessionDirectory
  try {
    const archiveBuffer = await downloadDocument(conn, mediaInfo.media, {
      label: 'ZIP',
      maxBytes: MAX_TEMPLATE_ARCHIVE_BYTES
    })
    if (!Buffer.isBuffer(archiveBuffer) || !archiveBuffer.length) {
      throw new Error('File ZIP template gagal diunduh dari WhatsApp.')
    }
    if (!hasZipSignature(archiveBuffer)) {
      throw new Error('File yang direply bukan arsip ZIP yang valid.')
    }

    const root = await ensureRenderRoot()
    sessionDirectory = await fs.mkdtemp(path.join(root, 'alvareth-render-'))
    await fs.chmod(sessionDirectory, 0o700).catch(() => {})
    const packageDirectory = path.join(sessionDirectory, 'package')
    await fs.mkdir(packageDirectory, { recursive: true, mode: 0o700 })

    const extracted = await extractRenderArchive(archiveBuffer, packageDirectory, {
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxFileBytes: MAX_ARCHIVE_FILE_BYTES,
      maxTotalBytes: MAX_ARCHIVE_UNPACKED_BYTES
    })

    // A render.sh package belongs to the video-first flow, not the template
    // flow. Tell the owner instead of failing on a missing manifest.
    let scriptPath = null
    try {
      scriptPath = await findRenderScript(packageDirectory)
    } catch (error) {
      if (!/tidak memiliki file render\.sh/.test(String(error?.message || ''))) throw error
    }
    if (scriptPath) {
      throw new Error('ZIP ini berisi render.sh, jadi alurnya berbeda: kirim video dulu, reply video dengan *.render*, lalu kirim ZIP ini. Paket template HTML harus berisi manifest.json + render.html, bukan render.sh.')
    }

    const template = await findHtmlTemplate(packageDirectory)
    const photoDirectory = path.join(sessionDirectory, 'photos')
    await fs.mkdir(photoDirectory, { recursive: true, mode: 0o700 })

    await evictOldestIdleRenderSession()
    const manifest = template.manifest
    pendingSessions.set(key, {
      kind: 'html-template',
      directory: sessionDirectory,
      packageDirectory,
      entryPath: template.entryPath,
      audioPath: template.audioPath,
      manifest,
      photoDirectory,
      photos: [],
      receivedMessageIds: [],
      createdAt: Date.now(),
      processing: false,
      progress: {
        percent: 0,
        stage: 'Menunggu foto',
        detail: 'Template ' + manifest.title + ' membutuhkan ' + manifest.requiredPhotos + ' foto.',
        updatedAt: Date.now()
      },
      updateLockHeld: true,
      abortController: null,
      cancelRequested: false,
      deliveryWaiting: false,
      deliveryWaitingSince: null,
      deliveryStartedAt: null,
      outputPath: null,
      outputFileName: null,
      outputSize: 0
    })
    global.__alvarethRenderJobs = Math.max(0, Number(global.__alvarethRenderJobs) || 0) + 1
    console.log('[RENDER] Sesi template dibuat:', {
      fileName: quotedFileName,
      template: manifest.id,
      extractedFiles: extracted.files.length,
      extractedBytes: formatBytes(extracted.totalBytes),
      requiredPhotos: manifest.requiredPhotos
    })
    return safeReply(m, formatTemplatePhotoRequest(manifest))
  } catch (error) {
    if (sessionDirectory) await fs.rm(sessionDirectory, { recursive: true, force: true }).catch(() => {})
    console.error('[RENDER] Gagal menyiapkan template:', error?.stack || error)
    return safeReply(m, '❌ Paket template gagal disiapkan: ' + safeError(error))
  }
}

async function processTemplateRenderJob({ conn, m, key, session }) {
  const progress = createRenderTerminalProgressReporter(session)
  try {
    progress.update(1, 'Menyiapkan browser render', '', true)
    throwIfRenderCancelled(session)
    const browserExecutable = await ensureRenderBrowser({
      signal: session.abortController?.signal,
      onLog: message => console.log(String(message).replace(/\n$/, ''))
    })
    throwIfRenderCancelled(session)

    const manifest = session.manifest
    progress.update(
      5,
      'Merender template HTML',
      manifest.title + ' · ' + manifest.width + 'x' + manifest.height + ' · ' + manifest.fps + ' fps · ' + manifest.totalFrames + ' frame',
      true
    )
    const outputPath = path.join(session.directory, 'render-result.mp4')
    const photoPaths = session.photos.map(photo => photo.path)
    const result = await renderHtmlTemplate({
      browserExecutable,
      packageDir: session.packageDirectory,
      entryPath: session.entryPath,
      manifest,
      photoPaths,
      audioPath: session.audioPath,
      outputPath,
      signal: session.abortController?.signal,
      onLog: message => console.log(String(message).replace(/\n$/, '')),
      onProgress: value => {
        const percent = 5 + Math.round(Number(value.percent || 0) * 0.85)
        progress.update(percent, 'Merender template HTML',
          'Frame ' + Number(value.frame || 0) + '/' + Number(value.totalFrames || 0) +
          ' · ' + Number(value.percent || 0) + '%')
      }
    })
    throwIfRenderCancelled(session)
    console.log('[RENDER] Template selesai dirender:', {
      template: manifest.id,
      frames: result.frames,
      size: formatBytes(result.bytes)
    })

    progress.update(92, 'Memvalidasi hasil render', '', true)
    if (result.bytes > MAX_OUTPUT_BYTES) {
      throw new Error('Ukuran hasil render ' + formatBytes(result.bytes) + ' melebihi batas pengiriman ' + formatBytes(MAX_OUTPUT_BYTES) + '.')
    }
    session.outputPath = outputPath
    session.outputFileName = 'render-result.mp4'
    session.outputSize = result.bytes
    await fs.chmod(outputPath, 0o600).catch(() => {})

    // Photos and the extracted package are no longer needed once the final
    // video lives directly in the session directory.
    await fs.rm(session.packageDirectory, { recursive: true, force: true }).catch(() => {})
    await fs.rm(session.photoDirectory, { recursive: true, force: true }).catch(() => {})
    session.packageDirectory = null
    session.photoDirectory = null

    throwIfRenderCancelled(session)
    await runTrackedRenderDelivery({ m, key, session, progressReporter: progress })
  } catch (error) {
    console.error('[RENDER] Proses render template gagal:', error?.stack || error)
    const cancelled = error?.code === 'RENDER_SCRIPT_CANCELLED' ||
      session.cancelRequested || session.abortController?.signal.aborted
    if (cancelled) {
      progress.update(
        session.progress?.percent || 0,
        'Dibatalkan',
        'Render dihentikan atas permintaan pengguna.',
        true
      )
      session.processing = false
      session.abortController = null
      if (pendingSessions.get(key) === session) pendingSessions.delete(key)
      await safeReact(m, '🛑')
      await safeReply(m, '🛑 Render dibatalkan. Proses render dan proses turunannya telah dihentikan.')
      await removeSession(session)
      return
    }

    progress.update(
      session.progress?.percent || 0,
      'Render gagal',
      safeError(error),
      true
    )
    session.processing = false
    session.abortController = null
    await safeReact(m, '❌')
    await safeReply(
      m,
      '❌ Render template gagal: ' + safeError(error) +
      '\n\nFoto dan paket template masih tersimpan. Ketik *.render retry* untuk mencoba lagi tanpa mengirim foto ulang, atau *.render cancel* untuk membatalkan.'
    )
  } finally {
    await progress.close()
  }
}


handler.help = ['render', 'render status', 'render send', 'render recover', 'render retry', 'render cancel']
handler.tags = ['owner']
handler.command = /^render$/i
handler.rowner = true

export default handler
