import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileTypeFromBuffer } from 'file-type'
import { getQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import { downloadYoutubeVideoBest, cleanupDownload } from '../../lib/scrape/youtube.js'
import { buildLirikSrt, buildLirikText, normalizeLirikResult } from '../../lib/lirik-output.js'

const execFileAsync = promisify(execFile)
const MAX_INPUT_BYTES = Math.max(5 * 1024 * 1024,
  Number(process.env.ALVARETH_LIRIK_MAX_BYTES) || 200 * 1024 * 1024)
const MAX_OUTPUT_BYTES = Math.max(1024 * 1024,
  Number(process.env.ALVARETH_LIRIK_MAX_OUTPUT_BYTES) || 8 * 1024 * 1024)
const MAX_DURATION_SECONDS = Math.max(60,
  Number(process.env.ALVARETH_LIRIK_MAX_DURATION_SECONDS) || 1800)
const MAX_PROCESS_MS = Math.max(10 * 60 * 1000,
  Number(process.env.ALVARETH_LIRIK_TIMEOUT_MS) || 3 * 60 * 60 * 1000)
const jobs = global.__alvarethLirikJobs ||
  (global.__alvarethLirikJobs = new Map())

function sessionKey(m) {
  if (!m?.chat || !m?.sender) return ''
  return String(m.chat) + ':' + String(m.sender)
}

function safeError(error) {
  return String(error?.message || error || 'Kesalahan tidak diketahui')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[tautan]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 900)
}

async function safeReply(m, conn, message) {
  try {
    if (typeof m?.reply === 'function') return await m.reply(message)
    const socket = conn || m?.conn || global.conn
    if (socket?.sendMessage && m?.chat) {
      return await socket.sendMessage(m.chat, { text: message }, m.key ? { quoted: m } : {})
    }
  } catch (error) {
    console.warn('[LIRIK] Gagal mengirim pesan status:', error?.message || error)
  }
  return null
}

function getRoot() {
  const configured = String(process.env.ALVARETH_LIRIK_TMPDIR || '').trim()
  const dataRoot = String(process.env.ALVARETH_DATA_DIR || path.join(homedir(), '.alvareth-bot-data'))
  return path.resolve(configured || path.join(dataRoot, 'lirik'))
}

async function createPrivateJobDirectory() {
  const root = getRoot()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  await fs.chmod(root, 0o700).catch(() => {})
  const stat = await fs.lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Folder sementara lirik harus berupa direktori biasa, bukan symbolic link.')
  }
  const directory = await fs.mkdtemp(path.join(root, 'job-'))
  await fs.chmod(directory, 0o700).catch(() => {})
  return directory
}

function extractYoutubeUrl(value) {
  const match = String(value || '').match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return ''
  const raw = match[0].replace(/[),\].!?;:]+$/g, '')
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return ''
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return ''
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com' &&
      host !== 'youtu.be' && !host.endsWith('.youtube.com')) return ''
  return parsed.toString()
}

function extensionFromMime(mime, fileName, fallback) {
  const supplied = path.extname(String(fileName || '')).replace(/^\./, '').toLowerCase()
  if (/^[a-z0-9]{2,5}$/.test(supplied)) return supplied
  const value = String(mime || '').toLowerCase().split(';')[0].trim()
  const known = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/3gpp': '3gp'
  }
  return known[value] || fallback
}

async function prepareInput(m, conn, jobDirectory, url) {
  if (url) {
    const downloadRoot = path.join(jobDirectory, 'download')
    await fs.mkdir(downloadRoot, { recursive: true, mode: 0o700 })
    const downloaded = await downloadYoutubeVideoBest(url, (percent, detail) => {
      if (detail) console.log('[LIRIK] [download] ' + String(detail).slice(0, 240))
    }, {
      outputRoot: downloadRoot,
      maxFileBytes: MAX_INPUT_BYTES
    })
    try {
      const stat = await fs.stat(downloaded.path)
      if (!stat.isFile() || stat.size < 1) throw new Error('Downloader tidak menghasilkan file video yang valid.')
      if (stat.size > MAX_INPUT_BYTES) {
        throw new Error('Ukuran video ' + Math.ceil(stat.size / 1024 / 1024) +
          ' MB melebihi batas ' + Math.ceil(MAX_INPUT_BYTES / 1024 / 1024) + ' MB.')
      }
      return {
        filePath: downloaded.path,
        kind: 'video',
        title: downloaded.title || 'youtube-video',
        cleanupDir: downloaded.outputDir
      }
    } catch (error) {
      if (downloaded.outputDir) await cleanupDownload(downloaded.outputDir).catch(() => {})
      throw error
    }
  }

  const mediaInfo = getQuotedMediaInfo(m)
  if (!mediaInfo) {
    throw new Error('Reply/kutip video atau audio, atau kirim .lirik dengan URL YouTube.')
  }
  const mediaType = String(mediaInfo.type || '').toLowerCase()
  const mime = String(mediaInfo.mime || mediaInfo.media?.mimetype || '').toLowerCase()
  const fileName = mediaInfo.media?.fileName || mediaInfo.media?.file_name || ''
  const fileExtension = path.extname(String(fileName)).toLowerCase()
  const isVideo = mime.startsWith('video/') || /(?:video|ptv)message/.test(mediaType) ||
    /\.(?:mp4|m4v|mov|mkv|webm|avi|3gp|mpeg|mpg)$/i.test(fileExtension)
  const isAudio = mime.startsWith('audio/') || /audio/.test(mediaType) ||
    /\.(?:mp3|m4a|aac|ogg|opus|wav|flac|amr)$/i.test(fileExtension)
  if (!isVideo && !isAudio) {
    throw new Error('Media yang dikutip harus berupa video atau audio. Dokumen lain tidak diproses.')
  }

  const declaredSize = Number(mediaInfo.media?.fileLength)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_INPUT_BYTES) {
    throw new Error('Ukuran media melebihi batas ' + Math.ceil(MAX_INPUT_BYTES / 1024 / 1024) + ' MB.')
  }

  const buffer = await downloadQuotedMedia(m, conn)
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Media WhatsApp gagal diunduh. Coba kirim ulang file asli, bukan preview.')
  }
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error('Ukuran media ' + Math.ceil(buffer.length / 1024 / 1024) +
      ' MB melebihi batas ' + Math.ceil(MAX_INPUT_BYTES / 1024 / 1024) + ' MB.')
  }

  const detected = await fileTypeFromBuffer(buffer.subarray(0, Math.min(buffer.length, 8192))).catch(() => null)
  const resolvedMime = String(detected?.mime || mime).toLowerCase()
  if (!resolvedMime.startsWith('audio/') && !resolvedMime.startsWith('video/') &&
      !isAudio && !isVideo) {
    throw new Error('Isi file tidak dikenali sebagai audio/video yang valid.')
  }

  const kind = isVideo || resolvedMime.startsWith('video/') ? 'video' : 'audio'
  const extension = extensionFromMime(resolvedMime, fileName, kind === 'video' ? 'mp4' : 'ogg')
  const filePath = path.join(jobDirectory, 'source.' + extension)
  await fs.writeFile(filePath, buffer, { mode: 0o600, flag: 'wx' })
  return {
    filePath,
    kind,
    title: path.basename(String(fileName || 'media'), path.extname(String(fileName || 'media'))) || 'media',
    cleanupDir: null
  }
}

function safeBaseName(value) {
  const normalized = String(value || 'hasil-lirik').replace(/\\/g, '/')
  const base = path.basename(normalized)
    .replace(/[\r\n\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 70)
  return base || 'hasil-lirik'
}

async function runTranscription(source, jobDirectory) {
  const scriptPath = path.resolve('scripts/lirik_transcribe.py')
  await fs.access(scriptPath)
  const python = String(process.env.ALVARETH_LIRIK_PYTHON || 'python3').trim() || 'python3'
  const outputPath = path.join(jobDirectory, 'transcript.json')
  const model = String(process.env.ALVARETH_LIRIK_WHISPER_MODEL || 'small').trim() || 'small'
  const device = String(process.env.ALVARETH_LIRIK_WHISPER_DEVICE || 'auto').trim() || 'auto'
  const computeType = String(process.env.ALVARETH_LIRIK_COMPUTE_TYPE || 'int8').trim() || 'int8'
  const language = String(process.env.ALVARETH_LIRIK_LANGUAGE || '').trim()
  const ocrFps = Math.max(0.1, Math.min(5, Number(process.env.ALVARETH_LIRIK_OCR_FPS) || 1))
  const maxDuration = MAX_DURATION_SECONDS

  const args = [
    scriptPath,
    '--input', source.filePath,
    '--kind', source.kind,
    '--output', outputPath,
    '--model', model,
    '--device', device,
    '--compute-type', computeType,
    '--ocr-fps', String(ocrFps),
    '--max-duration', String(maxDuration)
  ]
  if (language) args.push('--language', language)

  try {
    await execFileAsync(python, args, {
      timeout: MAX_PROCESS_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    })
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error || '')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[tautan]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 900)
    throw new Error(detail || 'Worker Whisper/RapidOCR gagal dijalankan.')
  }

  const raw = JSON.parse(await fs.readFile(outputPath, 'utf8'))
  return normalizeLirikResult(raw)
}

async function sendArtifact(m, conn, filePath, fileName, caption, mimetype) {
  const socket = conn || m.conn || global.conn
  const delivery = await sendLocalFile(socket, m.chat, filePath, {
    jobId: 'lirik',
    mimetype,
    fileName,
    maxBytes: MAX_OUTPUT_BYTES,
    quoted: m,
    caption
  })
  console.log('[LIRIK] Berkas terkirim:', {
    fileName: delivery.fileName,
    size: delivery.size,
    messageId: delivery.messageId
  })
  return delivery
}

async function runLirikJob(m, conn, job, url) {
  let source = null
  try {
    job.status = 'Menyiapkan media'
    await safeReply(m, conn, '⬇️ Menyiapkan video/audio untuk transkripsi lirik...')
    source = await prepareInput(m, conn, job.directory, url)

    job.status = 'Menjalankan Whisper dan OCR'
    await safeReply(m, conn,
      '🎧 Media siap. Whisper lokal sedang mengenali vokal' +
      (source.kind === 'video' ? ' dan RapidOCR membaca teks pada layar' : '') +
      '. Penggunaan pertama dapat lebih lama karena model perlu diunduh.')

    const result = await runTranscription(source, job.directory)
    if (!result.segments.length) {
      throw new Error('Tidak ada lirik/teks yang berhasil dikenali. Pastikan audio jelas atau teks memang terlihat pada video.' +
        (result.audioError ? ' Audio: ' + result.audioError : '') +
        (result.ocrError ? ' OCR: ' + result.ocrError : ''))
    }

    const baseName = safeBaseName(source.title)
    const txtPath = path.join(job.directory, baseName + '-lirik.txt')
    const srtPath = path.join(job.directory, baseName + '-lirik.srt')
    await fs.writeFile(txtPath, buildLirikText(result), { mode: 0o600 })
    await fs.writeFile(srtPath, buildLirikSrt(result), { mode: 0o600 })

    job.status = 'Mengirim hasil TXT dan SRT'
    const audioCount = result.segments.filter(item => item.source === 'AUDIO').length
    const screenCount = result.segments.filter(item => item.source === 'ON_SCREEN').length
    const note = [
      '✅ *Transkripsi lirik selesai.*',
      'Bahasa: ' + result.language,
      'Segmen audio: ' + audioCount,
      'Segmen teks layar: ' + screenCount,
      'Model: ' + result.model,
      result.ocrError ? 'Catatan OCR: ' + result.ocrError : '',
      result.audioError ? 'Catatan audio: ' + result.audioError : '',
      '',
      'Label AUDIO berasal dari pengenalan suara; label LAYAR berasal dari OCR video. Periksa kembali hasil terhadap media asli.'
    ].filter(Boolean).join('\n')

    await sendArtifact(m, conn, txtPath, baseName + '-lirik.txt',
      '📝 Transkrip lirik TXT bertimestamp.', 'text/plain; charset=utf-8')
    await sendArtifact(m, conn, srtPath, baseName + '-lirik.srt',
      '🎬 Subtitle SRT dengan timestamp.', 'application/x-subrip')
    job.status = 'Selesai'
    await safeReply(m, conn, note)
    try { await m.react('✅') } catch {}
  } catch (error) {
    job.status = 'Gagal: ' + safeError(error)
    console.error('[LIRIK] Job gagal:', error?.stack || error)
    const rawError = String(error?.message || error || '')
    const authRequired = error?.code === 'YOUTUBE_AUTH_REQUIRED' ||
      /sign in to confirm you.{0,3}re not a bot|confirm you.{0,3}re not a bot/i.test(rawError)
    const failureMessage = authRequired
      ? [
          '❌ *YouTube meminta verifikasi akun.*',
          'yt-dlp dan provider cadangan tidak berhasil mengakses video ini.',
          '',
          'Pasang cookies YouTube milik sendiri di server TokoPanel:',
          '1. Ekspor cookies dari browser desktop yang sedang login ke YouTube dalam format Netscape cookies.txt.',
          '2. Unggah sebagai .alvareth-bot-data/youtube-cookies.txt di folder utama bot.',
          '3. Pastikan file hanya dapat dibaca akun server (izin 600), lalu restart bot.',
          '',
          'Alternatif: set YTDLP_COOKIES_FILE ke path absolut file cookies.',
          'Jangan kirim file cookies ke WhatsApp, GitHub, atau siapa pun.'
        ].join('\n')
      : '❌ *Proses .lirik gagal.*\n' + safeError(error) +
        '\n\nPastikan Python, FFmpeg, dan dependensi pada docs/LIRIK.md sudah terpasang.'
    await safeReply(m, conn, failureMessage)
    try { await m.react('❌') } catch {}
  } finally {
    if (source?.cleanupDir) await cleanupDownload(source.cleanupDir).catch(() => {})
    await fs.rm(job.directory, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => {
      if (jobs.get(job.key) === job) jobs.delete(job.key)
    }, 10 * 60 * 1000).unref?.()
  }
}

const handler = async (m, { conn, text }) => {
  const key = sessionKey(m)
  if (!key) return safeReply(m, conn, 'Identitas chat tidak terbaca. Coba ulangi perintah.')

  const input = String(text || '').trim()
  if (/^status$/i.test(input)) {
    const job = jobs.get(key)
    return safeReply(m, conn, job
      ? 'ℹ️ *STATUS .LIRIK*\nStatus: ' + job.status + '\nID: ' + job.id
      : 'Tidak ada proses .lirik yang sedang berjalan.')
  }

  const url = extractYoutubeUrl(input)
  const quotedMedia = getQuotedMediaInfo(m)
  if (!url && !quotedMedia) {
    return safeReply(m, conn, [
      '🎵 *ALVARETH LIRIK*',
      '',
      'Reply/kutip video atau audio, lalu ketik:',
      '.lirik',
      '',
      'Atau gunakan URL YouTube:',
      '.lirik https://youtu.be/VIDEO_ID',
      '',
      'Bot mengirim transkrip TXT dan subtitle SRT. Ketik .lirik status untuk melihat progres.'
    ].join('\n'))
  }

  if (input && !url) {
    return safeReply(m, conn, 'URL tidak dikenali. Gunakan URL YouTube yang valid, atau reply/kutip media lalu ketik .lirik.')
  }
  if (jobs.has(key)) {
    return safeReply(m, conn, '⏳ Proses .lirik sebelumnya masih berjalan. Gunakan .lirik status untuk melihat progres.')
  }

  let directory
  try {
    directory = await createPrivateJobDirectory()
  } catch (error) {
    return safeReply(m, conn, 'Gagal menyiapkan folder sementara: ' + safeError(error))
  }

  const job = {
    id: randomUUID().slice(0, 8),
    key,
    directory,
    status: 'Menunggu worker',
    createdAt: Date.now()
  }
  jobs.set(key, job)
  await safeReply(m, conn, '⏳ Permintaan .lirik diterima. Gunakan .lirik status untuk memeriksa progres.')
  void runLirikJob(m, conn, job, url)
}

handler.help = ['lirik', 'lirik <url>', 'lirik status']
handler.tags = ['downloader']
handler.command = /^lirik$/i

export default handler
