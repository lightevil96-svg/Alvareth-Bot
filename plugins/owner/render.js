import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileTypeFromBuffer } from 'file-type'
import { downloadContentFromMessage } from 'baileys'
import { getQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'
import { createRenderSessionKey as sessionKey, getCurrentRenderDocument as getCurrentDocument, isRenderDocumentEvent } from '../../lib/render-message.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import { isWhatsAppConnectionClosedError, sendWithWhatsAppReconnect } from '../../lib/whatsapp-connection.js'
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
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024

// Session dipisahkan berdasarkan chat dan pengirim agar paket ZIP pengguna lain
// tidak pernah dipasangkan dengan video milik owner.
const pendingSessions = new Map()

function getRenderRoot() {
  const configured = String(process.env.ALVARETH_RENDER_TMPDIR || '').trim()
  const dataRoot = String(process.env.ALVARETH_DATA_DIR || path.join(homedir(), '.alvareth-bot-data'))
  return path.resolve(configured || path.join(dataRoot, 'render-jobs'))
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

  const readyState = socket.ws?.readyState
  if (typeof readyState === 'number' && readyState !== 1) return null
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

function throwIfRenderCancelled(session) {
  if (!session?.cancelRequested && !session?.abortController?.signal?.aborted) return
  const error = new Error('Render dibatalkan atas permintaan pengguna.')
  error.code = 'RENDER_SCRIPT_CANCELLED'
  throw error
}

async function removeSession(session) {
  if (!session) return
  if (session.updateLockHeld) {
    session.updateLockHeld = false
    global.__alvarethRenderJobs = Math.max(0, (Number(global.__alvarethRenderJobs) || 1) - 1)
  }
  if (!session.directory) return
  try {
    await fs.rm(session.directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 })
  } catch (error) {
    console.warn('[RENDER] Cleanup direktori job gagal:', error?.message || error)
  }
}

async function ensureRenderRoot() {
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

async function deliverRenderedOutput({ m, key, session }) {
  const progress = createRenderProgressReporter(session)
  const outputPath = session.outputPath

  try {
    throwIfRenderCancelled(session)
    const outputInfo = await fs.stat(outputPath)
    if (!outputInfo.isFile() || outputInfo.size < 1) {
      throw new Error('File hasil render tidak lagi tersedia di penyimpanan sesi.')
    }

    progress.update(95, 'Mengirim hasil ke WhatsApp', formatBytes(outputInfo.size), true)
    const result = await sendWithWhatsAppReconnect({
      getSocket: () => global.conn || m?.conn || null,
      signal: session.abortController?.signal,
      onWait: details => {
        if (details?.reason === 'waiting-for-connection' ||
            details?.reason === 'retry-after-disconnect') {
          progress.update(
            95,
            'Menunggu koneksi WhatsApp',
            'Hasil render tetap tersimpan. Menunggu socket WhatsApp aktif untuk melanjutkan pengiriman.',
            true
          )
          console.warn('[RENDER] Menunggu koneksi WhatsApp pulih sebelum mengirim hasil render.')
          if (details?.reason === 'waiting-for-connection') {
            try {
              global.requestWhatsAppReconnect?.('Render selesai, tetapi socket WhatsApp belum aktif.')
            } catch (error) {
              console.error('[RENDER] Tidak dapat meminta reconnect WhatsApp:', error?.message || error)
            }
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

    if (!cancelled && isWhatsAppConnectionClosedError(error)) {
      try {
        global.requestWhatsAppReconnect?.(
          'Pengiriman hasil render terputus: ' + safeError(error)
        )
      } catch (reconnectError) {
        console.error('[RENDER] Tidak dapat meminta reconnect setelah upload gagal:', reconnectError?.message || reconnectError)
      }
    }

    session.processing = false
    session.abortController = null

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
  const key = sessionKey(m)
  if (!key) return safeReply(m, 'Identitas chat tidak terbaca. Coba kirim ulang perintah.')

  const action = String(text || '').trim().toLowerCase()

  if (action === 'status') {
    const session = pendingSessions.get(key)
    if (!session) return safeReply(m, 'Tidak ada sesi render aktif.')
    if (session.processing) {
      return safeReply(m, '⏳ Render berjalan di background. Tahap saat ini: ' + String(session.progress?.stage || 'Menyiapkan render') + '. Detail progres hanya tampil di terminal server.')
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
    const session = pendingSessions.get(key)
    if (!session) return safeReply(m, 'Tidak ada sesi render aktif.')
    if (session.processing) return safeReply(m, '⏳ Sesi render masih berjalan atau sedang menunggu koneksi WhatsApp.')
    if (!session.outputPath) return safeReply(m, 'Belum ada hasil render yang siap dikirim. Selesaikan proses render terlebih dahulu.')

    try {
      const outputInfo = await fs.stat(session.outputPath)
      if (!outputInfo.isFile() || outputInfo.size < 1) throw new Error('File hasil render kosong atau tidak tersedia.')
    } catch (error) {
      return safeReply(m, '❌ File hasil render tidak dapat ditemukan: ' + safeError(error) + '. Jalankan render ulang dengan mengirim video dan ZIP.')
    }

    session.processing = true
    session.cancelRequested = false
    session.abortController = new AbortController()
    await safeReply(m, '📤 Hasil render ditemukan. Bot akan mengirim file yang tersimpan tanpa menjalankan render ulang.')
    void deliverRenderedOutput({ m, key, session }).catch(error => {
      console.error('[RENDER] Retry pengiriman hasil gagal:', error?.stack || error)
    })
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

  if (action) {
    return safeReply(m, 'Format: reply video dengan *.render*. Untuk mengirim ulang hasil gunakan *.render send*, melihat status *.render status*, atau membatalkan *.render cancel*.')
  }

  if (global.__alvarethUpdateRunning) {
    return safeReply(m, '⏳ Render ditunda karena pembaruan bot sedang berlangsung. Coba lagi setelah bot selesai diperbarui.')
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

  const mediaInfo = getQuotedMediaInfo(m)
  const mediaType = String(mediaInfo?.type || '').toLowerCase()
  const mime = String(mediaInfo?.mime || '').toLowerCase()
  const isVideo = /^(?:video|ptv)message$/.test(mediaType) || mime.startsWith('video/')

  if (!mediaInfo || !isVideo) {
    return safeReply(m, 'Kirim video ke chat ini, lalu reply video tersebut dengan *.render*. Setelah itu bot akan meminta paket render *.zip*.')
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

    while (pendingSessions.size >= MAX_PENDING_SESSIONS) {
      const oldest = [...pendingSessions.entries()]
        .filter(([, item]) => !item.processing)
        .sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
      if (!oldest) throw new Error('Antrean render penuh. Selesaikan atau batalkan sesi sebelumnya terlebih dahulu.')
      pendingSessions.delete(oldest[0])
      await removeSession(oldest[1])
    }

    pendingSessions.set(key, {
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
  if (!isRenderDocumentEvent(m)) return

  const document = getCurrentDocument(m)
  const filename = path.basename(String(
    document?.fileName || document?.file_name || document?.filename || ''
  ).trim())
  const mimetype = String(
    document?.mimetype || document?.mimeType || document?.mime || ''
  ).toLowerCase()
  const isZip = isZipDocument(filename, mimetype)
  const key = sessionKey(m)

  if (!key) {
    if (isZip) {
      console.warn('[RENDER] ZIP masuk tetapi identitas chat/pengirim tidak terbaca:', {
        mtype: String(m?.mtype || ''),
        filename,
        mimetype
      })
      await safeReply(m, '📦 File ZIP terdeteksi, tetapi identitas chat/pengirim tidak terbaca. Coba kirim ulang video dan ZIP di chat yang sama.')
    }
    return
  }

  const session = pendingSessions.get(key)
  if (!session) {
    if (isZip) {
      console.warn('[RENDER] ZIP masuk tanpa sesi aktif:', {
        mtype: String(m?.mtype || ''),
        filename,
        mimetype,
        activeSessions: pendingSessions.size
      })
      await safeReply(m, '📦 ZIP terdeteksi, tetapi sesi render tidak ditemukan. Kirim ulang video, reply dengan *.render*, kemudian kirim ZIP di chat yang sama.')
    }
    return
  }

  if (!document) {
    return safeReply(m, 'Dokumen terdeteksi, tetapi metadata file tidak dapat dibaca. Kirim ulang pack.zip sebagai dokumen WhatsApp.')
  }

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
    const progress = createRenderProgressReporter(session)
    progress.update(session.progress?.percent || 0, 'Render gagal', safeError(error), true)
    await safeReact(m, '❌')
    await safeReply(
      m,
      '❌ Render berhenti karena kesalahan internal: ' + safeError(error) +
      '\n\nVideo masih tersimpan. Kirim ulang ZIP atau gunakan *.render cancel*.'
    )
  })
  return
}

async function processRenderJob({ conn, m, document, key, session }) {
  const progress = createRenderProgressReporter(session)
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
    await deliverRenderedOutput({ m, key, session })
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
  }
}


handler.help = ['render', 'render status', 'render send', 'render cancel']
handler.tags = ['owner']
handler.command = /^render$/i
handler.rowner = true

export default handler
