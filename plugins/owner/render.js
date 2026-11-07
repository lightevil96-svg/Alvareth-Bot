import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileTypeFromBuffer } from 'file-type'
import { downloadContentFromMessage } from 'baileys'
import { getQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import {
  normalizeShellScript,
  runRenderScript,
  findRenderOutput
} from '../../lib/render-script.js'

const VIDEO_EXTENSIONS = new Set([
  '3gp', 'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv'
])
const SESSION_TTL_MS = 15 * 60 * 1000
const STALE_JOB_TTL_MS = 24 * 60 * 60 * 1000
const MAX_PENDING_SESSIONS = 3
const MAX_VIDEO_BYTES = 300 * 1024 * 1024
const MAX_SCRIPT_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024
const SCRIPT_TIMEOUT_MS = 30 * 60 * 1000

// Session dipisahkan berdasarkan chat dan pengirim agar file .sh pengguna lain
// tidak pernah dipasangkan dengan video milik owner.
const pendingSessions = new Map()

function sessionKey(m) {
  const chat = String(m?.chat || '')
  const sender = String(m?.senderPN || m?.sender || '')
  return chat && sender ? chat + '|' + sender : ''
}

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

async function safeReply(m, message) {
  try {
    if (typeof m?.reply === 'function') return await m.reply(message)
    if (m?.chat && typeof m?.conn?.sendMessage === 'function') {
      return await m.conn.sendMessage(m.chat, { text: message })
    }
  } catch (error) {
    console.warn('[RENDER] Gagal mengirim balasan WhatsApp:', error?.message || error)
  }
  return null
}

async function removeSession(session) {
  if (!session?.directory) return
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

async function pruneExpiredSessions() {
  const now = Date.now()
  const expired = []
  for (const [key, session] of pendingSessions) {
    if (session.processing || now - session.createdAt <= SESSION_TTL_MS) continue
    pendingSessions.delete(key)
    expired.push(key)
    await removeSession(session)
  }
  return expired
}

function getCurrentDocument(m) {
  const type = String(m?.mtype || '').toLowerCase()
  if (type !== 'documentmessage') return null
  const media = m?.msg
  return media && typeof media === 'object' ? media : null
}

async function downloadDocument(conn, media) {
  let lastError
  if (typeof conn?.downloadM === 'function') {
    try {
      const result = await conn.downloadM(media, 'document')
      if (Buffer.isBuffer(result) || result instanceof Uint8Array) {
        const buffer = Buffer.from(result)
        if (buffer.length > MAX_SCRIPT_BYTES) {
          const error = new Error('File .sh melebihi batas ' + formatBytes(MAX_SCRIPT_BYTES) + '.')
          error.code = 'RENDER_SCRIPT_TOO_LARGE'
          throw error
        }
        if (buffer.length) return buffer
      }
    } catch (error) {
      if (error?.code === 'RENDER_SCRIPT_TOO_LARGE') throw error
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
      if (total > MAX_SCRIPT_BYTES) {
        const error = new Error('File .sh melebihi batas ' + formatBytes(MAX_SCRIPT_BYTES) + '.')
        error.code = 'RENDER_SCRIPT_TOO_LARGE'
        throw error
      }
      chunks.push(part)
    }
    const buffer = Buffer.concat(chunks)
    if (buffer.length) return buffer
  } catch (error) {
    if (error?.code === 'RENDER_SCRIPT_TOO_LARGE') throw error
    lastError = error
  }

  throw new Error('File script tidak dapat diunduh dari WhatsApp' +
    (lastError?.message ? ': ' + String(lastError.message).slice(0, 250) : '.') )
}

const handler = async (m, { conn, text }) => {
  const key = sessionKey(m)
  if (!key) return safeReply(m, 'Identitas chat tidak terbaca. Coba kirim ulang perintah.')

  const action = String(text || '').trim().toLowerCase()
  await pruneExpiredSessions()

  if (action === 'cancel') {
    const session = pendingSessions.get(key)
    if (!session) return safeReply(m, 'Tidak ada sesi render yang menunggu file .sh.')
    if (session.processing) return safeReply(m, 'Render sedang berjalan. Tunggu sampai proses selesai.')
    pendingSessions.delete(key)
    await removeSession(session)
    return safeReply(m, 'Sesi render dibatalkan dan file sementara dibersihkan.')
  }

  if (action) {
    return safeReply(m, 'Format: reply video dengan *.render*. Untuk membatalkan sesi, gunakan *.render cancel*.')
  }

  const previous = pendingSessions.get(key)
  if (previous?.processing) {
    return safeReply(m, 'Render sebelumnya masih berjalan. Tunggu sampai selesai.')
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
    return safeReply(m, 'Kirim video ke chat ini, lalu reply video tersebut dengan *.render*. Setelah itu bot akan meminta file script *.sh*.')
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
      processing: false
    })

    return safeReply(
      m,
      '🎬 Video diterima (' + formatBytes(videoBuffer.length) + ').\n\nSekarang kirim file script *.sh* sebagai dokumen di chat yang sama. Bot akan menjalankan script itu dengan video ini dan mengirim hasil render-nya.\n\nSesi berlaku 15 menit. Gunakan *.render cancel* jika ingin membatalkan.'
    )
  } catch (error) {
    if (sessionDirectory) await fs.rm(sessionDirectory, { recursive: true, force: true }).catch(() => {})
    console.error('[RENDER] Gagal menyiapkan video:', error?.stack || error)
    return safeReply(m, '❌ Video gagal disiapkan: ' + safeError(error))
  }
}

handler.all = async function (m) {
  const key = sessionKey(m)
  if (!key) return

  const expired = await pruneExpiredSessions()
  if (expired.includes(key)) {
    await safeReply(m, 'Sesi render sudah kedaluwarsa. Kirim ulang video, lalu reply dengan *.render*.')
    return
  }

  const session = pendingSessions.get(key)
  if (!session) return

  const document = getCurrentDocument(m)
  if (!document) return

  const filename = path.basename(String(document.fileName || '').trim())
  const mimetype = String(document.mimetype || '').toLowerCase()
  const isShellScript = /\.sh$/i.test(filename) || /shellscript|x-sh$/i.test(mimetype)
  if (!isShellScript) {
    return safeReply(m, 'File yang diminta harus berupa script *.sh*. Video masih tersimpan; kirim file .sh sebagai dokumen.')
  }
  if (session.processing) {
    return safeReply(m, 'Script untuk sesi ini sedang diproses. Tunggu sampai selesai.')
  }

  const declaredSize = toSafeNumber(document.fileLength)
  if (declaredSize > MAX_SCRIPT_BYTES) {
    return safeReply(m, 'Ukuran script melebihi batas ' + formatBytes(MAX_SCRIPT_BYTES) + '.')
  }

  session.processing = true
  let workDirectory
  try {
    const scriptBuffer = await downloadDocument(this, document)
    const scriptSource = normalizeShellScript(scriptBuffer, MAX_SCRIPT_BYTES)

    await safeReply(m, '🛠️ Script diterima. Render dimulai; proses dapat memerlukan beberapa menit.')

    workDirectory = await fs.mkdtemp(path.join(session.directory, 'run-'))
    await fs.chmod(workDirectory, 0o700).catch(() => {})
    await fs.mkdir(path.join(workDirectory, '.render-home'), { recursive: true, mode: 0o700 })
    await fs.mkdir(path.join(workDirectory, '.render-tmp'), { recursive: true, mode: 0o700 })

    // Claude's earlier script used 378541.mp4. Keep that name available, plus
    // generic aliases and the input path argument for scripts that accept $1.
    const inputPath = path.join(workDirectory, '378541.mp4')
    await fs.copyFile(session.videoPath, inputPath)
    for (const alias of ['input.mp4', 'video.mp4']) {
      await fs.symlink('378541.mp4', path.join(workDirectory, alias))
    }

    const scriptPath = path.join(workDirectory, 'render.sh')
    await fs.writeFile(scriptPath, scriptSource, { encoding: 'utf8', mode: 0o700, flag: 'wx' })

    const startedAt = Date.now()
    const processResult = await runRenderScript({
      scriptPath,
      workingDirectory: workDirectory,
      inputPath,
      timeoutMs: SCRIPT_TIMEOUT_MS
    })
    console.log('[RENDER] Script selesai:', {
      durationSeconds: Number((processResult.durationMs / 1000).toFixed(1)),
      exitCode: processResult.code
    })

    const output = await findRenderOutput(workDirectory, {
      excludePaths: [scriptPath, inputPath],
      startedAt
    })
    if (!output) {
      throw new Error('Script selesai, tetapi file video hasil render tidak ditemukan. Simpan hasil sebagai MP4 di folder yang sama dengan render.sh.')
    }
    if (output.size > MAX_OUTPUT_BYTES) {
      throw new Error('Ukuran hasil render ' + formatBytes(output.size) + ' melebihi batas pengiriman ' + formatBytes(MAX_OUTPUT_BYTES) + '.')
    }

    await sendLocalFile(this, m.chat, output.path, {
      quoted: m,
      caption: '✅ Render berhasil. Berikut hasil videonya.'
    })

    pendingSessions.delete(key)
    await removeSession(session)
    console.log('[RENDER] Hasil dikirim:', {
      fileName: path.basename(output.path),
      size: formatBytes(output.size)
    })
  } catch (error) {
    console.error('[RENDER] Proses render gagal:', error?.stack || error)
    if (workDirectory) {
      await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => {})
    }
    session.processing = false
    await safeReply(
      m,
      '❌ Render gagal: ' + safeError(error) +
      '\n\nVideo masih tersimpan selama sesi aktif. Kamu bisa kirim ulang file .sh yang sudah diperbaiki, atau gunakan *.render cancel*.'
    )
  }
}

handler.help = ['render', 'render cancel']
handler.tags = ['owner']
handler.command = /^render$/i
handler.rowner = true

export default handler
