import { tiktokSearch, tiktokScrape } from '../../lib/scrape/tikwm.js'
import axios from 'axios'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

const MAX_VIDEO_BYTES = 150 * 1024 * 1024
const MAX_INLINE_VIDEO_BYTES = 50 * 1024 * 1024

// Some messages in this Baileys fork are protobuf-converted objects without the
// serializer prototype methods. Send reactions through the socket directly.
async function reactSafe(conn, m, text) {
  if (!m?.chat || !m?.key) return
  try {
    await conn.sendMessage(m.chat, { react: { text, key: m.key } })
  } catch (error) {
    console.warn('[TikTok] Gagal mengirim reaksi:', error?.message || error)
  }
}

// Accept a TikTok URL even when it is pasted beside other text or punctuation.
function extractTikTokUrl(input) {
  const candidates = String(input || '').match(/https?:\/\/[^\s<>"']+/gi) || []
  for (const raw of candidates) {
    const candidate = raw.replace(/[),\].!?;:]+$/g, '')
    try {
      const parsed = new URL(candidate)
      const host = parsed.hostname.toLowerCase()
      if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
        return parsed.toString()
      }
    } catch {
      // Ignore malformed URLs and inspect the next match.
    }
  }
  return ''
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''

    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) return resolve()
      reject(new Error('FFmpeg gagal (kode ' + code + '): ' + (stderr.trim() || 'output MP4 tidak dapat dibuat')))
    })
  })
}

async function downloadVideoFile(url, destination) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 120000,
    maxRedirects: 5,
    maxContentLength: MAX_VIDEO_BYTES,
    maxBodyLength: MAX_VIDEO_BYTES,
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36',
      referer: 'https://www.tikwm.com/',
      accept: 'video/mp4,video/*,application/octet-stream,*/*'
    }
  })

  const contentType = String(response.headers['content-type'] || '').toLowerCase()
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    response.data.destroy()
    throw new Error('Provider mengembalikan halaman web, bukan file video.')
  }

  let bytes = 0
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length
      if (bytes > MAX_VIDEO_BYTES) {
        return callback(new Error('Video melebihi batas aman 150 MB.'))
      }
      callback(null, chunk)
    }
  })

  await pipeline(response.data, limiter, fs.createWriteStream(destination))
  const info = await fsp.stat(destination)
  if (info.size < 4096) throw new Error('File video terlalu kecil atau tidak lengkap.')
  if (info.size > MAX_VIDEO_BYTES) throw new Error('File video melebihi batas aman 150 MB.')
  return info.size
}

// Re-encode to broadly compatible H.264/AAC MP4 and move the MP4 index to the
// front. This avoids sending an unverified remote URL or a badly packaged file.
async function normalizeVideoToMp4(input, output) {
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-sn', '-dn',
    output
  ])

  const info = await fsp.stat(output)
  if (info.size < 4096) throw new Error('Hasil konversi MP4 tidak lengkap.')
  if (info.size > MAX_VIDEO_BYTES) throw new Error('Hasil video melebihi batas pengiriman 150 MB.')

  const buffer = await fsp.readFile(output)
  if (!buffer.subarray(0, 32).includes(Buffer.from('ftyp'))) {
    throw new Error('Struktur kontainer MP4 tidak valid.')
  }
  return { buffer, size: info.size }
}

async function prepareBestTikTokVideo(res) {
  const candidates = Array.isArray(res.videoCandidates) && res.videoCandidates.length
    ? res.videoCandidates
    : (res.video ? [{ label: 'video tersedia', url: res.video }] : [])

  if (!candidates.length) throw new Error('Provider tidak menyediakan URL video yang dapat diunduh.')

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alvareth-tiktok-'))
  const errors = []

  try {
    // tiktokScrape orders HD first. Use a lower variant only if the preferred
    // source cannot be downloaded or converted into a valid MP4.
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (!candidate?.url || !/^https?:\/\//i.test(candidate.url)) continue

      const sourcePath = path.join(tempDir, 'source-' + i + '.bin')
      const outputPath = path.join(tempDir, 'alvareth-tiktok-' + i + '.mp4')

      try {
        await downloadVideoFile(candidate.url, sourcePath)
        const normalized = await normalizeVideoToMp4(sourcePath, outputPath)
        console.log('[TikTok] Berhasil menyiapkan video dari varian:', candidate.label || ('#' + (i + 1)))
        return { ...normalized, quality: candidate.label || 'tertinggi yang tersedia' }
      } catch (error) {
        errors.push((candidate.label || ('varian #' + (i + 1))) + ': ' + (error?.message || String(error)))
        console.warn('[TikTok] Varian video gagal, mencoba fallback:', errors[errors.length - 1])
      }
    }

    throw new Error('Semua varian video TikTok gagal diunduh atau diverifikasi. ' + errors.slice(0, 3).join(' | '))
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

function safeFilename(value) {
  const name = String(value || 'tiktok-video')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return (name || 'tiktok-video') + '.mp4'
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  await reactSafe(conn, m, '✨')

  const input = String(m.quoted ? (m.quoted.text || m.quoted.caption || text || '') : (text || '')).trim()
  if (!input) {
    return m.reply(
      'Contoh:\n' +
      usedPrefix + command + ' https://vt.tiktok.com/xxxx\n' +
      usedPrefix + command + ' anime edit'
    )
  }

  try {
    let url = extractTikTokUrl(input)

    if (!url && /^https?:\/\//i.test(input)) {
      throw new Error('Link bukan link TikTok yang dikenali. Kirim tautan TikTok seperti https://www.tiktok.com/... atau https://vt.tiktok.com/...')
    }

    if (!url) {
      const results = await tiktokSearch(input)
      if (!results.length) throw new Error('Hasil TikTok tidak ditemukan.')
      url = results[0].url
    }

    const res = await tiktokScrape(url)
    if (!res) throw new Error('Gagal mengambil data TikTok. Pastikan tautan masih aktif dan dapat diakses.')

    const title = (res.title || 'TikTok Video').replace(/\s+/g, ' ').trim()
    const uploader = res.author || '-'
    const displayTitle = title.length > 220 ? title.slice(0, 217).trimEnd() + '...' : title
    const displayUploader = String(uploader).length > 80 ? String(uploader).slice(0, 77).trimEnd() + '...' : uploader
    const mediaFormat = res.type === 'image' ? 'Photo / Slideshow' : res.video ? 'Video MP4' : 'Media'
    const caption = '╭━━━〔 🎬 *ALVARETH • TIKTOK* 〕━━━╮\n' +
      '┃\n' +
      '┃  ✦ *VIDEO BERHASIL DIUNDUH*\n' +
      '┃  ───────────────────\n' +
      '┃\n' +
      '┃  📝 *JUDUL VIDEO*\n' +
      '┃  ' + displayTitle + '\n' +
      '┃\n' +
      '┃  👤 *KREATOR*\n' +
      '┃  ' + displayUploader + '\n' +
      '┃\n' +
      '┃  📥 *STATUS*  •  Siap ditonton\n' +
      '┃  💠 *FORMAT*  •  ' + mediaFormat + '\n' +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━━━━━\n' +
      '     ✨ _Downloaded by Alvareth Bot_ ✨'

    if (res.type === 'image' && Array.isArray(res.images) && res.images.length > 0) {
      await conn.sendMessage(
        m.chat,
        {
          album: res.images.map((img, i) => ({
            image: { url: img },
            caption: i === 0 ? caption : ''
          }))
        },
        { quoted: m }
      )

      if (res.audio) {
        await conn.sendMessage(
          m.chat,
          {
            audio: { url: res.audio },
            mimetype: 'audio/mpeg'
          },
          { quoted: m }
        )
      }

      await reactSafe(conn, m, '✅')
      return
    }

    if (res.video || (Array.isArray(res.videoCandidates) && res.videoCandidates.length)) {
      const prepared = await prepareBestTikTokVideo(res)
      const fileName = safeFilename(title)

      if (prepared.size > MAX_INLINE_VIDEO_BYTES) {
        // Send large files as MP4 documents rather than risk a failed inline-video upload.
        await conn.sendMessage(
          m.chat,
          {
            document: prepared.buffer,
            mimetype: 'video/mp4',
            fileName,
            caption
          },
          { quoted: m }
        )
      } else {
        await conn.sendMessage(
          m.chat,
          {
            video: prepared.buffer,
            mimetype: 'video/mp4',
            fileName,
            caption
          },
          { quoted: m }
        )
      }
    } else if (!res.audio) {
      throw new Error('Video atau media TikTok tidak ditemukan pada tautan tersebut.')
    }

    if (res.audio) {
      await conn.sendMessage(
        m.chat,
        {
          audio: { url: res.audio },
          mimetype: 'audio/mpeg'
        },
        { quoted: m }
      )
    }

    await reactSafe(conn, m, '✅')
  } catch (e) {
    await reactSafe(conn, m, '❌')
    console.error('[TikTok Downloader]', e?.stack || e)
    await conn.sendMessage(m.chat, {
      text: 'Gagal memproses TikTok: ' + String(e?.message || e)
    }, { quoted: m }).catch(() => {})
  }
}

handler.help = ['tt', 'tiktok']
handler.tags = ['downloader']
handler.command = /^(tt|tiktok)$/i
handler.limit = true
handler.register = false

export default handler
