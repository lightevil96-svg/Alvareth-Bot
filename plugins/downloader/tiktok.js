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
function isSocketReady(conn) {
  const ws = conn?.ws
  if (!ws) return false
  if (typeof ws.isOpen === 'boolean') return ws.isOpen
  if (typeof ws.readyState === 'number') return ws.readyState === 1
  return false
}

// A .tt task can take several minutes. During that time main.js may replace
// global.conn, so never keep using the socket captured when the command began.
async function waitForActiveConnection(fallbackConn, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  let lastNotice = 0

  while (Date.now() < deadline) {
    const candidate = globalThis.conn?.sendMessage ? globalThis.conn : fallbackConn
    if (isSocketReady(candidate)) return candidate

    if (Date.now() - lastNotice >= 10000) {
      console.log('[TikTok] Menunggu koneksi WhatsApp pulih sebelum mengirim hasil...')
      lastNotice = Date.now()
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error('Koneksi WhatsApp belum pulih setelah 90 detik. Jalankan ulang perintah .tt.')
}

async function sendMessageWithReconnect(fallbackConn, ...args) {
  let active = await waitForActiveConnection(fallbackConn)
  try {
    return await active.sendMessage(...args)
  } catch (error) {
    if (!/connection closed|connection is closed/i.test(String(error?.message || error))) throw error

    console.warn('[TikTok] Socket tertutup saat mengirim; menunggu socket pengganti...')
    const deadline = Date.now() + 300000
    while (Date.now() < deadline) {
      const next = globalThis.conn
      if (next && next !== active && typeof next.sendMessage === 'function' && isSocketReady(next)) {
        console.log('[TikTok] Socket pengganti aktif; mengirim hasil yang sudah diproses.')
        return next.sendMessage(...args)
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('Socket WhatsApp baru tidak tersedia setelah 5 menit. Video sudah diproses; coba ulang .tt setelah bot tersambung.')
  }
}

async function reactSafe(conn, m, text) {
  if (!m?.chat || !m?.key) return
  const active = globalThis.conn?.sendMessage && isSocketReady(globalThis.conn)
    ? globalThis.conn
    : conn
  if (!isSocketReady(active)) return
  try {
    await active.sendMessage(m.chat, { react: { text, key: m.key } })
  } catch (error) {
    // Reaction is optional; a stale socket must not make a successful download fail.
    if (!/connection closed|connection is closed/i.test(String(error?.message || error))) {
      console.warn('[TikTok] Gagal mengirim reaksi:', error?.message || error)
    }
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

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.ceil(seconds)
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

function terminalProgress(label, percent, elapsedSeconds, etaSeconds, detail = '') {
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)).toFixed(1) + '%' : '--'
  const line = '[TikTok] ' + label + ' | ' + pct +
    ' | berjalan ' + formatDuration(elapsedSeconds) +
    ' | sisa ' + formatDuration(etaSeconds) +
    (detail ? ' | ' + detail : '')
  // A carriage return updates the same terminal line; periodic updates reflect
  // bytes/FFmpeg timestamps from the actual process, not a decorative animation.
  process.stdout.write('\r' + line + ' '.repeat(Math.max(0, 12)))
}

function runFfmpeg(args, { durationSeconds = 0, label = 'Konversi MP4' } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn('ffmpeg', [...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let stdoutBuffer = ''
    let lastPercent = -1

    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        const match = line.match(/^out_time_(?:ms|us)=(\d+)$/)
        if (!match || !(durationSeconds > 0)) continue
        const currentSeconds = Number(match[1]) / 1000000
        const percent = Math.min(99.9, currentSeconds / durationSeconds * 100)
        if (percent - lastPercent < 0.5 && percent < 99) continue
        lastPercent = percent
        const elapsed = (Date.now() - startedAt) / 1000
        const rate = currentSeconds / Math.max(elapsed, 0.1)
        const eta = rate > 0 ? Math.max(0, (durationSeconds - currentSeconds) / rate) : NaN
        terminalProgress(label, percent, elapsed, eta, 'FFmpeg')
      }
    })
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    child.once('error', error => {
      process.stdout.write('\n')
      reject(error)
    })
    child.once('close', code => {
      const elapsed = (Date.now() - startedAt) / 1000
      process.stdout.write('\r[TikTok] ' + label + (code === 0 ? ' | 100.0% | selesai dalam ' : ' | GAGAL setelah ') + formatDuration(elapsed) + '                    \n')
      if (code === 0) return resolve()
      reject(new Error('FFmpeg gagal (kode ' + code + '): ' + (stderr.trim() || 'output MP4 tidak dapat dibuat')))
    })
  })
}

async function getMediaDuration(filePath) {
  return new Promise(resolve => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath
    ], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.once('error', () => resolve(0))
    child.once('close', code => {
      const duration = Number(output.trim())
      resolve(code === 0 && Number.isFinite(duration) && duration > 0 ? duration : 0)
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
  const startedAt = Date.now()
  const contentLength = Number(response.headers['content-length']) || 0
  let lastUpdate = 0
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length
      if (bytes > MAX_VIDEO_BYTES) {
        return callback(new Error('Video melebihi batas aman 150 MB.'))
      }
      const now = Date.now()
      if (now - lastUpdate >= 500) {
        lastUpdate = now
        const elapsed = (now - startedAt) / 1000
        const speed = bytes / Math.max(elapsed, 0.1)
        const percent = contentLength > 0 ? bytes / contentLength * 100 : NaN
        const eta = contentLength > bytes && speed > 0 ? (contentLength - bytes) / speed : NaN
        const detail = (bytes / 1024 / 1024).toFixed(2) + ' MB' +
          (contentLength > 0 ? ' / ' + (contentLength / 1024 / 1024).toFixed(2) + ' MB' : '') +
          ' @ ' + (speed / 1024 / 1024).toFixed(2) + ' MB/s'
        terminalProgress('Unduh video', percent, elapsed, eta, detail)
      }
      callback(null, chunk)
    }
  })

  await pipeline(response.data, limiter, fs.createWriteStream(destination))
  const downloadElapsed = (Date.now() - startedAt) / 1000
  process.stdout.write('\r[TikTok] Unduh video | 100.0% | selesai dalam ' + formatDuration(downloadElapsed) + '                    \n')
  const info = await fsp.stat(destination)
  if (info.size < 4096) throw new Error('File video terlalu kecil atau tidak lengkap.')
  if (info.size > MAX_VIDEO_BYTES) throw new Error('File video melebihi batas aman 150 MB.')
  return info.size
}

// Re-encode to broadly compatible H.264/AAC MP4 and move the MP4 index to the
// front. This avoids sending an unverified remote URL or a badly packaged file.
async function normalizeVideoToMp4(input, output) {
  const durationSeconds = await getMediaDuration(input)
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
  ], { durationSeconds, label: 'Konversi MP4' })

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
        console.log('\\n[TikTok] Memproses varian ' + (candidate.label || ('#' + (i + 1))) + '...')
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
      await sendMessageWithReconnect(conn, 
        m.chat,
        {
          album: res.images.map((img, i) => ({
            image: { url: img },
            caption: i === 0 ? caption : ''
          }))
        },
        { quoted: m, noAlvarethPreview: true }
      )

      if (res.audio) {
        await sendMessageWithReconnect(conn, 
          m.chat,
          {
            audio: { url: res.audio },
            mimetype: 'audio/mpeg'
          },
          { quoted: m, noAlvarethPreview: true }
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
        await sendMessageWithReconnect(conn, 
          m.chat,
          {
            document: prepared.buffer,
            mimetype: 'video/mp4',
            fileName,
            caption
          },
          { quoted: m, noAlvarethPreview: true }
        )
      } else {
        await sendMessageWithReconnect(conn, 
          m.chat,
          {
            video: prepared.buffer,
            mimetype: 'video/mp4',
            fileName,
            caption
          },
          { quoted: m, noAlvarethPreview: true }
        )
      }
    } else if (!res.audio) {
      throw new Error('Video atau media TikTok tidak ditemukan pada tautan tersebut.')
    }

    if (res.audio) {
      await sendMessageWithReconnect(conn, 
        m.chat,
        {
          audio: { url: res.audio },
          mimetype: 'audio/mpeg'
        },
        { quoted: m, noAlvarethPreview: true }
      )
    }

    await reactSafe(conn, m, '✅')
  } catch (e) {
    await reactSafe(conn, m, '❌')
    console.error('[TikTok Downloader]', e?.stack || e)
    await sendMessageWithReconnect(conn, m.chat, {
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
