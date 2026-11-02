import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileTypeFromBuffer } from 'file-type'
import { getQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'
import {
  downloadYoutubeAudioYtDlp,
  downloadYoutubeAudio,
  cleanupDownload
} from '../../lib/scrape/youtube.js'

const STATUS_JID = 'status@broadcast'
const MAX_STATUS_SECONDS = 90
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_VIDEO_BYTES = 64 * 1024 * 1024
const MAX_STATUS_VIDEO_BYTES = 60 * 1024 * 1024
const PENDING_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_PHOTOS = 20

// Foto disimpan sementara per pengirim + chat, supaya permintaan musik dari
// pengguna lain tidak dapat mengambil foto milik pengguna yang berbeda.
const pendingPhotos = new Map()

function normalizeJid(conn, value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  let jid = value.trim()
  try {
    if (typeof conn.decodeJid === 'function') jid = conn.decodeJid(jid) || jid
  } catch {}
  return jid.replace(/:\d+(?=@)/, '')
}

function getStatusAudience(conn) {
  const ownJids = new Set([
    normalizeJid(conn, conn.user?.id),
    normalizeJid(conn, conn.user?.lid),
    normalizeJid(conn, conn.user?.jid)
  ].filter(Boolean))

  const chats = conn.chats && typeof conn.chats === 'object' ? conn.chats : {}
  const recipients = new Set()

  for (const key of Object.keys(chats)) {
    const jid = normalizeJid(conn, key)
    if (!jid || ownJids.has(jid)) continue
    if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) {
      recipients.add(jid)
    }
  }

  return [...recipients]
}

async function sendStatus(conn, content) {
  const statusJidList = getStatusAudience(conn)
  if (!statusJidList.length) {
    throw new Error('Daftar kontak pribadi belum tersedia di cache bot. Pastikan kontak WhatsApp sudah tersinkron, lalu coba lagi.')
  }

  // Baileys fork Alvareth menerima statusJidList pada opsi relay Status.
  return conn.sendMessage(STATUS_JID, content, {
    statusJidList,
    broadcast: true
  })
}

function pendingKey(m) {
  return String(m.chat || '') + '|' + String(m.sender || '')
}

function prunePendingPhotos() {
  const now = Date.now()
  for (const [key, item] of pendingPhotos) {
    if (!item || now - item.createdAt > PENDING_TTL_MS) pendingPhotos.delete(key)
  }

  while (pendingPhotos.size >= MAX_PENDING_PHOTOS) {
    const oldestKey = pendingPhotos.keys().next().value
    if (!oldestKey) break
    pendingPhotos.delete(oldestKey)
  }
}

function parseTimestamp(value) {
  const raw = String(value || '').trim()
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(raw)) return null

  const parts = raw.split(':')
  const last = Number(parts.pop())
  if (!Number.isFinite(last) || (parts.length > 0 && last >= 60)) return null

  let seconds = last
  if (parts.length >= 1) {
    const minutes = Number(parts.pop())
    if (!Number.isFinite(minutes) || minutes > 59) return null
    seconds += minutes * 60
  }
  if (parts.length >= 1) {
    const hours = Number(parts.pop())
    if (!Number.isFinite(hours)) return null
    seconds += hours * 3600
  }
  if (parts.length) return null
  return seconds
}

function parseYoutubeRequest(input) {
  const normalized = String(input || '').trim().replace(/^(?:\\.sw|sw)\\s+/i, '')
  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length !== 3) return null

  let parsedUrl
  try {
    parsedUrl = new URL(parts[0])
  } catch {
    return null
  }

  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '')
  const isYoutube = host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be'

  if (!isYoutube || !['http:', 'https:'].includes(parsedUrl.protocol)) return null

  const start = parseTimestamp(parts[1])
  const end = parseTimestamp(parts[2])
  if (start === null || end === null || end <= start) return null

  return { url: parsedUrl.toString(), start, end }
}

function safeError(error) {
  return String(error?.message || error || 'Kesalahan tidak diketahui')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL YouTube]')
    .replace(/\s+/g, ' ')
    .slice(0, 700)
}

function runProcess(binary, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(binary + ' melewati batas waktu proses.'))
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout = (stdout + chunk.toString()).slice(-4000)
    })
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-8000)
    })
    child.once('error', error => finish(error))
    child.once('close', code => {
      if (code === 0) finish(null, { stdout: stdout.trim(), stderr: stderr.trim() })
      else finish(new Error(binary + ' gagal (kode ' + code + '): ' + (stderr || stdout || 'tanpa detail').slice(-1200)))
    })
  })
}

async function probeDuration(filePath) {
  try {
    const { stdout } = await runProcess('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], 30000)
    const duration = Number(stdout)
    return Number.isFinite(duration) && duration > 0 ? duration : null
  } catch (error) {
    console.warn('[SW] ffprobe tidak tersedia/ gagal membaca durasi:', safeError(error))
    return null
  }
}

async function uploadRepliedVideo(m, conn, mediaInfo, video) {
  if (!Buffer.isBuffer(video) || !video.length) {
    throw new Error('Video reply tidak dapat diunduh dari pesan WhatsApp.')
  }
  if (video.length > MAX_VIDEO_BYTES) {
    throw new Error('Ukuran video melewati batas fitur .sw (64 MB).')
  }

  const detected = await fileTypeFromBuffer(video)
  if (detected?.mime && !detected.mime.startsWith('video/')) {
    throw new Error('Media yang direply bukan file video.')
  }

  await fs.mkdir(path.resolve('./downloads'), { recursive: true })
  const workDir = await fs.mkdtemp(path.resolve('./downloads/sw-video-'))
  try {
    const extension = detected?.ext || 'mp4'
    const inputPath = path.join(workDir, 'status-source.' + extension)
    await fs.writeFile(inputPath, video)

    const duration = await probeDuration(inputPath)
    if (duration !== null && duration > MAX_STATUS_SECONDS) {
      throw new Error('Durasi video ' + Math.ceil(duration) + ' detik. Status video dibatasi maksimal 90 detik.')
    }

    const mimetype = String(mediaInfo?.mime || detected?.mime || 'video/mp4')
      .split(';')[0].trim()

    await sendStatus(conn, {
      video,
      mimetype
    })
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }

  await m.reply('✅ Video berhasil dikirim ke Status WhatsApp.')
  await m.react?.('✅').catch(() => {})
}

async function createPhotoMusicStatus(m, conn, imageBuffer, request) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    throw new Error('Foto tidak tersedia. Reply ulang foto dengan perintah .sw.')
  }
  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Ukuran foto terlalu besar untuk diproses (maksimal 15 MB).')
  }

  const imageType = await fileTypeFromBuffer(imageBuffer)
  if (!imageType?.mime?.startsWith('image/')) {
    throw new Error('File yang direply tidak terdeteksi sebagai foto/gambar.')
  }

  const duration = request.end - request.start
  if (duration > MAX_STATUS_SECONDS) {
    throw new Error('Durasi musik maksimal 90 detik per Status. Contoh: .sw link-youtube 1:00 2:00')
  }

  const workRoot = path.resolve('./downloads')
  await fs.mkdir(workRoot, { recursive: true })
  const workDir = await fs.mkdtemp(path.join(workRoot, 'sw-photo-'))
  let audioResult = null

  try {
    const imagePath = path.join(workDir, 'status-image.' + imageType.ext)
    const outputPath = path.join(workDir, 'status-photo-music.mp4')
    await fs.writeFile(imagePath, imageBuffer)

    let audioError
    try {
      console.log('[SW] Mengunduh audio YouTube melalui yt-dlp.')
      audioResult = await downloadYoutubeAudioYtDlp(request.url, 192)
    } catch (error) {
      audioError = error
      console.warn('[SW] yt-dlp gagal; mencoba provider audio cadangan:', safeError(error))
      try {
        audioResult = await downloadYoutubeAudio(request.url, 192)
      } catch (fallbackError) {
        throw new Error(
          'Audio YouTube gagal diunduh. yt-dlp: ' + safeError(audioError) +
          ' | cadangan: ' + safeError(fallbackError)
        )
      }
    }

    console.log('[SW] Menggabungkan foto dengan audio ' +
      request.start + 's–' + request.end + 's menjadi video Status.')

    const filter = "scale=w='min(1080,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease," +
      'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p'

    await runProcess('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1',
      '-framerate', '30',
      '-i', imagePath,
      '-ss', String(request.start),
      '-i', audioResult.path,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-t', String(duration),
      '-vf', filter,
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'stillimage',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-shortest',
      '-movflags', '+faststart',
      outputPath
    ], 10 * 60 * 1000)

    const stat = await fs.stat(outputPath)
    if (!stat.size) throw new Error('FFmpeg menghasilkan file Status kosong.')
    if (stat.size > MAX_STATUS_VIDEO_BYTES) {
      throw new Error('Hasil video melebihi batas ukuran Status 60 MB.')
    }

    const resultVideo = await fs.readFile(outputPath)
    await sendStatus(conn, {
      video: resultVideo,
      mimetype: 'video/mp4'
    })
  } finally {
    if (audioResult?.outputDir) {
      await cleanupDownload(audioResult.outputDir).catch(error => {
        console.warn('[SW] Gagal membersihkan unduhan audio:', safeError(error))
      })
    }
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }

  await m.reply(
    '✅ Foto berhasil diunggah ke Status WhatsApp dengan musik YouTube.\n' +
    '🎵 Potongan musik: ' + request.start + 's – ' + request.end + 's.'
  )
  await m.react?.('✅').catch(() => {})
}

const handler = async (m, { conn, text }) => {
  const input = String(text || '').trim()
  const quoted = m.quoted
  const mediaInfo = getQuotedMediaInfo(m)
  const quotedMime = String(mediaInfo?.mime || quoted?.mimetype || '').toLowerCase()
  const mediaType = String(mediaInfo?.type || quoted?.mediaType || quoted?.mtype || '')
  const normalizedMediaType = mediaType.toLowerCase()
  const isVideo = /^(?:video|ptv)message$/.test(normalizedMediaType) || quotedMime.startsWith('video/')
  const isImage = /^imagemessage$/.test(normalizedMediaType) || quotedMime.startsWith('image/')
  const key = pendingKey(m)

  prunePendingPhotos()

  try {
    if (isVideo || isImage) {
      console.log('[SW] Reply media terdeteksi:', {
        type: mediaType || 'unknown',
        mime: quotedMime || 'not-provided',
        source: m.rawMessage?.message ? 'raw-message' : 'serialized-message'
      })

      const mediaBuffer = await downloadQuotedMedia(m, conn)
      if (!Buffer.isBuffer(mediaBuffer) || !mediaBuffer.length) {
        throw new Error('Media reply terdeteksi sebagai ' + (mediaType || quotedMime || 'media') + ', tetapi file tidak berhasil diunduh.')
      }

      if (isVideo) {
        return await uploadRepliedVideo(m, conn, mediaInfo, mediaBuffer)
      }

      const request = parseYoutubeRequest(input) ||
        parseYoutubeRequest(mediaInfo?.caption || quoted?.caption || quoted?.text || '')
      if (request) {
        return await createPhotoMusicStatus(m, conn, mediaBuffer, request)
      }

      pendingPhotos.set(key, {
        buffer: mediaBuffer,
        createdAt: Date.now()
      })

      return m.reply(
        '🖼️ Foto diterima. Sekarang kirim link YouTube dan rentang musiknya dengan format:\n\n' +
        '.sw https://youtu.be/VIDEO_ID 1:00 2:00\n\n' +
        'Keterangan: waktu pertama adalah awal musik, waktu kedua adalah akhir musik. Maksimal durasi potongan 90 detik. Foto tersimpan sementara selama 10 menit.'
      )
    }

    if (input) {
      const request = parseYoutubeRequest(input)
      if (!request) {
        return m.reply(
          'Format belum benar. Gunakan:\n.sw https://youtu.be/VIDEO_ID 1:00 2:00\n\n' +
          'Waktu menggunakan MM:SS atau HH:MM:SS.'
        )
      }

      const pending = pendingPhotos.get(key)
      if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
        pendingPhotos.delete(key)
        return m.reply('Foto belum tersedia atau sudah kedaluwarsa. Reply foto terlebih dahulu dengan perintah .sw, lalu kirim link YouTube dan waktunya.')
      }

      await createPhotoMusicStatus(m, conn, pending.buffer, request)
      pendingPhotos.delete(key)
      return
    }

    console.warn('[SW] .sw tidak menemukan reply media:', {
      hasQuoted: Boolean(quoted),
      quotedType: quoted?.mtype || null,
      quotedMediaType: quoted?.mediaType || null,
      quotedMime: quotedMime || null,
      hasRawMessage: Boolean(m.rawMessage?.message)
    })

    return m.reply(
      '*📲 WHATSAPP STATUS*\n\n' +
      '1. Reply video dengan .sw untuk langsung mengunggahnya ke Status.\n' +
      '2. Reply foto dengan .sw, lalu kirim link YouTube dan waktu musiknya.\n\n' +
      'Contoh:\n.sw https://youtu.be/VIDEO_ID 1:00 2:00'
    )
  } catch (error) {
    console.error('[SW] Gagal mengunggah Status:', error?.stack || error)
    return m.reply('❌ Fitur .sw gagal: ' + safeError(error))
  }
}
handler.help = ['sw']
handler.tags = ['owner']
handler.command = /^sw$/i
handler.owner = true

export default handler
