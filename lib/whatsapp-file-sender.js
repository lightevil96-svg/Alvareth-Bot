import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

const queues = new WeakMap()
const MIB = 1024 * 1024
const MIME_BY_EXTENSION = {
  '.7z': 'application/x-7z-compressed',
  '.apk': 'application/vnd.android.package-archive',
  '.avi': 'video/x-msvideo',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rar': 'application/vnd.rar',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip'
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'tidak diketahui'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return value.toFixed(unit ? 1 : 0) + ' ' + units[unit]
}

function makeError(message, code, stage = 'preflight', cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  error.stage = stage
  return error
}

async function inspectLocalFile(filePath, options) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw makeError('Path file tidak diberikan.', 'WA_FILE_PATH_INVALID')
  }

  let linkInfo
  try {
    linkInfo = await fs.lstat(filePath)
  } catch (error) {
    throw makeError('File tidak dapat ditemukan: ' + filePath, error.code || 'WA_FILE_NOT_FOUND', 'filesystem', error)
  }
  if (linkInfo.isSymbolicLink()) {
    throw makeError('Pengiriman file melalui symbolic link ditolak demi keamanan.', 'WA_FILE_SYMLINK')
  }

  let absolutePath
  try {
    absolutePath = await fs.realpath(filePath)
  } catch (error) {
    throw makeError('Lokasi file tidak dapat dibaca: ' + filePath, error.code || 'WA_FILE_NOT_FOUND', 'filesystem', error)
  }

  const stats = await fs.stat(absolutePath)
  if (!stats.isFile()) throw makeError('Item yang dipilih bukan file biasa.', 'WA_FILE_NOT_REGULAR')
  if (!Number.isSafeInteger(stats.size) || stats.size < 1) {
    throw makeError('File kosong atau ukuran file tidak valid.', 'WA_FILE_EMPTY')
  }

  const maxBytes = positiveInteger(
    options.maxBytes ?? process.env.ALVARETH_DOWNLOAD_MAX_BYTES,
    2 * 1024 ** 3 - 10 * MIB
  )
  if (stats.size > maxBytes) {
    throw makeError(
      'Ukuran file ' + formatBytes(stats.size) + ' melebihi batas konfigurasi ' + formatBytes(maxBytes) + '.',
      'WA_FILE_TOO_LARGE'
    )
  }

  try {
    const handle = await fs.open(absolutePath, 'r')
    await handle.close()
  } catch (error) {
    throw makeError('File tidak dapat dibaca oleh proses bot: ' + absolutePath, error.code || 'WA_FILE_UNREADABLE', 'filesystem', error)
  }

  const extension = path.extname(absolutePath).toLowerCase()
  const suppliedMime = String(options.mimetype || '')
  const mimetype = suppliedMime && suppliedMime !== 'application/octet-stream'
    ? suppliedMime
    : (MIME_BY_EXTENSION[extension] || suppliedMime || 'application/octet-stream')
  const inlineVideoMaxBytes = positiveInteger(
    options.inlineVideoMaxBytes ?? process.env.ALVARETH_WA_INLINE_VIDEO_MAX_BYTES,
    64 * MIB
  )
  const isVideo = mimetype.startsWith('video/') || /\.(mp4|m4v|mov|mkv|webm|avi)$/i.test(extension)
  const inlineVideoSupported = ['.mp4', '.m4v'].includes(extension)
  // By default, keep large videos and non-MP4 containers as documents.
  // Callers may force .mp4 files to use the video message payload.
  const forceMp4Video = options.forceVideo === true && extension === '.mp4'
  const mediaType = isVideo && inlineVideoSupported && (forceMp4Video || stats.size <= inlineVideoMaxBytes)
    ? 'video'
    : 'document'

  return {
    path: absolutePath,
    size: stats.size,
    mimetype,
    fileName: path.basename(absolutePath),
    mediaType,
    maxBytes,
    inlineVideoMaxBytes
  }
}

async function assertTemporarySpace(size, mediaType, enabled = true) {
  if (!enabled || typeof fs.statfs !== 'function') return null

  let available
  try {
    const stats = await fs.statfs(tmpdir())
    available = Number(stats.bavail) * Number(stats.bsize)
  } catch (error) {
    console.warn('[WA-FILE] Tidak dapat memeriksa kapasitas temp:', error?.message || error)
    return null
  }

  if (!Number.isFinite(available)) return null

  // Baileys 0.3.18-final encrypts outgoing media into os.tmpdir() before
  // uploading. Video messages may also keep an original temp copy for a
  // thumbnail; document messages need the encrypted copy only.
  const multiplier = mediaType === 'video' ? 2.2 : 1.2
  const required = Math.ceil(size * multiplier + 16 * MIB)
  if (available < required) {
    throw makeError(
      'Ruang sementara server tidak cukup untuk upload. Tersedia ' +
      formatBytes(available) + ', perkiraan kebutuhan ' + formatBytes(required) +
      '. File asli tetap disimpan; kosongkan ruang temp atau gunakan penyimpanan server yang lebih besar.',
      'WA_TEMP_SPACE_LOW'
    )
  }
  return { available, required }
}

export function describeWhatsAppUploadError(error) {
  const message = String(error?.message || error || 'Kesalahan tidak diketahui')
  const code = String(error?.code || '')
  const status = Number(error?.output?.statusCode || error?.statusCode || error?.status || 0)

  if (code === 'ENOSPC' || /no space left on device/i.test(message)) {
    return 'Ruang penyimpanan sementara server habis saat Baileys menyiapkan file terenkripsi (ENOSPC). File asli tidak dihapus; kosongkan ruang pada direktori temp lalu coba .download lagi.'
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'Server tidak memiliki izin membaca file atau menulis file sementara Baileys (' + code + '). Periksa izin folder downloads dan temp.'
  }
  if (code === 'ENOENT') {
    return 'File sumber atau file sementara Baileys tidak ditemukan saat upload (ENOENT). File sumber tetap dipertahankan jika masih tersedia.'
  }
  if (status === 413 || /payload too large|file too large|maximum content length|content length exceeded/i.test(message)) {
    return 'Server media WhatsApp menolak ukuran file (HTTP 413/size limit). File tetap tersimpan; gunakan file lebih kecil atau kompresi.'
  }
  if (status === 428 || /precondition required|connection closed|socket.*closed/i.test(message)) {
    return 'Koneksi atau sesi WhatsApp tertutup (HTTP 428/Connection Closed). Sambungkan ulang WhatsApp, lalu kirim ulang secara manual.'
  }
  if (code === 'ETIMEDOUT' || /upload timeout|timed out/i.test(message)) {
    return 'Upload ke server WhatsApp melewati batas waktu. Periksa koneksi server dan ukuran file; file asli tetap disimpan.'
  }
  if (code === 'ECONNRESET' || /connection reset|ECONNRESET/i.test(message)) {
    return 'Koneksi upload ke server WhatsApp terputus (ECONNRESET). File asli tetap disimpan; periksa jaringan sebelum mencoba lagi.'
  }
  if (/media upload failed on all hosts/i.test(message)) {
    return 'Semua host media WhatsApp gagal menerima file. Penyebab dapat berupa batas ukuran, jaringan, atau sesi media. File asli tetap disimpan. Detail: ' + message.slice(0, 350)
  }
  return message.slice(0, 700)
}

function getQueue(conn) {
  let queue = queues.get(conn)
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0 }
    queues.set(conn, queue)
  }
  return queue
}

/**
 * Send a local file through the installed Baileys socket without loading it
 * into RAM. By default, large videos are sent as documents to avoid
 * inline-video upload constraints. Callers can force .mp4 video messages
 * with the forceVideo option when that delivery format is required.
 *
 * No automatic retry is performed: an upload can fail after WhatsApp has
 * accepted the message but before the acknowledgement reaches this process.
 * The caller retains the original file on every failure.
 */
export async function sendLocalFile(conn, jid, filePath, options = {}) {
  if (!conn || typeof conn.sendMessage !== 'function') {
    throw makeError('Socket Baileys tidak menyediakan sendMessage.', 'WA_SOCKET_UNAVAILABLE')
  }
  if (typeof jid !== 'string' || !jid.trim()) {
    throw makeError('JID tujuan pengiriman tidak valid.', 'WA_CHAT_INVALID')
  }

  const queue = getQueue(conn)
  const maxPending = positiveInteger(process.env.ALVARETH_WA_MAX_PENDING_UPLOADS, 3)
  if (queue.pending >= maxPending) {
    throw makeError(
      'Antrean upload WhatsApp sedang penuh (' + queue.pending + '). Tunggu pengiriman sebelumnya selesai.',
      'WA_UPLOAD_QUEUE_FULL'
    )
  }

  queue.pending++
  const task = async () => {
    const jobId = String(options.jobId || 'file').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'file'
    let file
    let stage = 'preflight'
    try {
      const readyState = conn.ws?.readyState
      if (typeof readyState === 'number' && readyState !== 1) {
        throw makeError(
          'Koneksi WhatsApp belum terbuka (WebSocket readyState=' + readyState + ').',
          'WA_SOCKET_NOT_OPEN'
        )
      }

      file = await inspectLocalFile(filePath, options)
      const tempSpace = await assertTemporarySpace(file.size, file.mediaType, options.checkTempSpace !== false)
      console.log('[WA-FILE:' + jobId + '] File tervalidasi:', {
        fileName: file.fileName,
        size: formatBytes(file.size),
        mimetype: file.mimetype,
        mediaType: file.mediaType,
        tempSpace: tempSpace ? formatBytes(tempSpace.available) : 'tidak diperiksa',
        tempDir: tmpdir()
      })

      const timeoutMs = positiveInteger(
        options.mediaUploadTimeoutMs ?? process.env.ALVARETH_WA_UPLOAD_TIMEOUT_MS,
        30 * 60 * 1000
      )
      const caption = String(options.caption || '')
      const content = file.mediaType === 'video'
        ? {
            video: { url: file.path },
            mimetype: file.mimetype,
            caption,
            ...(Number.isFinite(Number(options.seconds)) && Number(options.seconds) > 0
              ? { seconds: Math.round(Number(options.seconds)) }
              : {})
          }
        : {
            document: { url: file.path },
            mimetype: file.mimetype,
            fileName: file.fileName,
            caption
          }
      const sendOptions = { mediaUploadTimeoutMs: timeoutMs }
      if (options.quoted) sendOptions.quoted = options.quoted

      stage = 'whatsapp-upload'
      console.log('[WA-FILE:' + jobId + '] Upload WhatsApp dimulai:', {
        mediaType: file.mediaType,
        size: formatBytes(file.size),
        timeoutMs
      })
      const sent = await conn.sendMessage(jid, content, sendOptions)
      if (!sent?.key?.id) {
        throw makeError(
          'Baileys tidak mengembalikan ID pesan setelah proses pengiriman. Status pengiriman belum dapat dipastikan; file dipertahankan dan tidak dilakukan retry otomatis.',
          'WA_SEND_UNCONFIRMED',
          stage
        )
      }

      console.log('[WA-FILE:' + jobId + '] WhatsApp menerima permintaan pengiriman:', sent.key.id)
      return {
        message: sent,
        messageId: sent.key.id,
        path: file.path,
        fileName: file.fileName,
        size: file.size,
        mimetype: file.mimetype,
        mediaType: file.mediaType,
        timeoutMs
      }
    } catch (error) {
      const cause = error
      if (!cause.stage) cause.stage = stage
      console.error('[WA-FILE:' + jobId + '] Gagal pada tahap ' + stage + ':', cause?.stack || cause)
      if (stage === 'whatsapp-upload' && cause.code !== 'WA_TEMP_SPACE_LOW') {
        const wrapped = makeError(
          describeWhatsAppUploadError(cause),
          cause.code || 'WA_MEDIA_SEND_FAILED',
          stage,
          cause
        )
        wrapped.statusCode = cause?.output?.statusCode || cause?.statusCode || cause?.status
        throw wrapped
      }
      throw cause
    }
  }

  const pendingTask = queue.tail.then(task, task)
  queue.tail = pendingTask.catch(() => {})
  try {
    return await pendingTask
  } finally {
    queue.pending = Math.max(0, queue.pending - 1)
  }
}

export { formatBytes as formatMediaBytes }
