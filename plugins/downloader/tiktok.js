import { tiktokSearch, tiktokScrape } from '../../lib/scrape/tikwm.js'
import { downloadYoutubeVideoYtDlp, cleanupDownload as cleanupYtDlpDownload } from '../../lib/scrape/youtube.js'
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

// Cache the original photo from a successful .tt render so the button doesn't
// have to call TikWM again. Short TikTok URLs can fail on a second scrape.
const SINGLE_PHOTO_CACHE_TTL_MS = 15 * 60 * 1000
const SINGLE_PHOTO_CACHE_MAX_ENTRIES = 10
const SINGLE_PHOTO_CACHE_MAX_BYTES = 10 * 1024 * 1024
const singlePhotoCache = new Map()

// A WhatsApp interactive-button reply can be delivered more than once by some
// clients/session states. Make .ttfoto idempotent per chat, sender, and source URL.
const PHOTO_ACTION_PROCESSING_TTL_MS = 3 * 60 * 1000
const PHOTO_ACTION_SENT_TTL_MS = 60 * 1000
const PHOTO_ACTION_MAX_ENTRIES = 100
const photoActionDedup = new Map()

function claimPhotoAction(chat, sender, url) {
  const now = Date.now()
  for (const [key, entry] of photoActionDedup) {
    if (!entry || entry.expiresAt <= now) photoActionDedup.delete(key)
  }

  const key = [String(chat || ''), String(sender || ''), normalizeTikTokCacheKey(url)].join('|')
  const existing = photoActionDedup.get(key)
  if (existing && existing.expiresAt > now) {
    return { key, acquired: false, state: existing.state }
  }

  photoActionDedup.set(key, {
    state: 'processing',
    expiresAt: now + PHOTO_ACTION_PROCESSING_TTL_MS
  })
  while (photoActionDedup.size > PHOTO_ACTION_MAX_ENTRIES) {
    const oldestKey = photoActionDedup.keys().next().value
    if (oldestKey === undefined) break
    photoActionDedup.delete(oldestKey)
  }
  return { key, acquired: true }
}

function markPhotoActionSent(key) {
  if (!key) return
  photoActionDedup.set(key, {
    state: 'sent',
    expiresAt: Date.now() + PHOTO_ACTION_SENT_TTL_MS
  })
}

function releasePhotoAction(key) {
  if (key && photoActionDedup.get(key)?.state === 'processing') {
    photoActionDedup.delete(key)
  }
}

function normalizeTikTokCacheKey(input) {
  try {
    const parsed = new URL(String(input || '').trim())
    parsed.hash = ''
    parsed.search = ''
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.origin.toLowerCase() + parsed.pathname
  } catch {
    return String(input || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function pruneSinglePhotoCache() {
  const now = Date.now()
  for (const [key, value] of singlePhotoCache) {
    if (!value || value.expiresAt <= now) singlePhotoCache.delete(key)
  }
  while (singlePhotoCache.size > SINGLE_PHOTO_CACHE_MAX_ENTRIES) {
    const oldestKey = singlePhotoCache.keys().next().value
    if (oldestKey === undefined) break
    singlePhotoCache.delete(oldestKey)
  }
}

function getCachedSinglePhoto(url) {
  pruneSinglePhotoCache()
  const key = normalizeTikTokCacheKey(url)
  const cached = singlePhotoCache.get(key)
  if (!cached || cached.expiresAt <= Date.now()) return null
  singlePhotoCache.delete(key)
  singlePhotoCache.set(key, cached)
  return cached
}

function cacheSinglePhoto(url, photo) {
  if (!url || !Buffer.isBuffer(photo?.imageBuffer) || !photo.imageBuffer.length) return
  if (photo.imageBuffer.length > SINGLE_PHOTO_CACHE_MAX_BYTES) return
  pruneSinglePhotoCache()
  const key = normalizeTikTokCacheKey(url)
  singlePhotoCache.delete(key)
  singlePhotoCache.set(key, {
    ...photo,
    expiresAt: Date.now() + SINGLE_PHOTO_CACHE_TTL_MS
  })
  pruneSinglePhotoCache()
}

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

async function downloadToBuffer(url, maxBytes = MAX_VIDEO_BYTES) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer', timeout: 120000, maxRedirects: 5, maxContentLength: maxBytes,
    headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36', referer: 'https://www.tikwm.com/' }
  })
  const buffer = Buffer.from(response.data)
  if (!buffer.length || buffer.length > maxBytes) throw new Error('Media TikTok kosong atau melebihi batas ukuran.')
  return buffer
}

async function renderSinglePhotoWithMusic(imageUrl, audioUrl, outputPath) {
  if (!audioUrl) throw new Error('Musik postingan tidak tersedia dari provider TikTok.')
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alvareth-tiktok-photo-'))
  const imagePath = path.join(tempDir, 'photo.jpg')
  const audioPath = path.join(tempDir, 'music.bin')
  try {
    const [imageBuffer, audioBuffer] = await Promise.all([
      downloadToBuffer(imageUrl, 20 * 1024 * 1024),
      downloadToBuffer(audioUrl, 30 * 1024 * 1024)
    ])
    await Promise.all([fsp.writeFile(imagePath, imageBuffer), fsp.writeFile(audioPath, audioBuffer)])
    const audioDuration = await getMediaDuration(audioPath)
    if (!(audioDuration > 0)) throw new Error('Durasi musik TikTok tidak dapat dibaca.')
    const duration = Math.min(audioDuration, 60)
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', '30', '-i', imagePath, '-i', audioPath,
      '-t', String(duration), '-map', '0:v:0', '-map', '1:a:0',
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', outputPath
    ], { durationSeconds: duration, label: 'Render foto + musik' })
    const info = await fsp.stat(outputPath)
    if (info.size < 4096 || info.size > MAX_VIDEO_BYTES) throw new Error('Hasil video foto tidak valid atau terlalu besar.')
    return { buffer: await fsp.readFile(outputPath), imageBuffer, size: info.size, duration }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function cleanupStaleTikTokTemps(root = os.tmpdir()) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let entries = []
  try { entries = await fsp.readdir(root, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^alvareth-tiktok(?:-single|-photo)?-/.test(entry.name)) continue
    const candidate = path.join(root, entry.name)
    try {
      const info = await fsp.stat(candidate)
      if (info.mtimeMs < cutoff) {
        await fsp.rm(candidate, { recursive: true, force: true })
        console.log('[TikTok] Membersihkan direktori sementara tertinggal:', candidate)
      }
    } catch {}
  }
}

async function availableDiskBytes(dir) {
  try {
    const info = await fsp.statfs(dir)
    return Number(info.bavail) * Number(info.bsize)
  } catch {
    return Infinity
  }
}

function isDiskFullError(error) {
  return /no space left on device|enospc|disk quota exceeded|not enough space/i.test(String(error?.message || error))
}

async function prepareBestTikTokVideo(res, sourceUrl = '') {
  const candidates = Array.isArray(res.videoCandidates) && res.videoCandidates.length
    ? res.videoCandidates
    : (res.video ? [{ label: 'video tersedia', url: res.video }] : [])
  if (!candidates.length) throw new Error('Provider tidak menyediakan URL video yang dapat diunduh.')

  const configuredRoot = String(process.env.ALVARETH_TIKTOK_TMPDIR || '').trim()
  const tempRoot = path.resolve(configuredRoot || os.tmpdir())
  await fsp.mkdir(tempRoot, { recursive: true })
  await cleanupStaleTikTokTemps(tempRoot)
  const tempDir = await fsp.mkdtemp(path.join(tempRoot, 'alvareth-tiktok-'))
  const errors = []

  try {
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (!candidate?.url || !/^https?:\/\//i.test(candidate.url)) continue
      const sourcePath = path.join(tempDir, 'source-' + i + '.bin')
      const outputPath = path.join(tempDir, 'alvareth-tiktok-' + i + '.mp4')

      try {
        const freeBytes = await availableDiskBytes(tempDir)
        if (freeBytes < 32 * 1024 * 1024) {
          throw new Error('Ruang disk sementara tersisa kurang dari 32 MB. Kosongkan disk TokoPanel atau atur ALVARETH_TIKTOK_TMPDIR ke lokasi yang memiliki ruang lebih besar.')
        }
        console.log('\n[TikTok] Memproses varian ' + (candidate.label || ('#' + (i + 1))) + '...')
        await downloadVideoFile(candidate.url, sourcePath)
        const sourceDuration = await getMediaDuration(sourcePath)
        if (!(sourceDuration > 0)) throw new Error('Sumber dari provider tidak terbaca sebagai video utuh (durasi/metadata tidak valid).')
        const normalized = await normalizeVideoToMp4(sourcePath, outputPath)
        console.log('[TikTok] Berhasil menyiapkan video dari varian:', candidate.label || ('#' + (i + 1)))
        return { ...normalized, quality: candidate.label || 'tertinggi yang tersedia' }
      } catch (error) {
        const detail = (error?.message || String(error)).slice(0, 500)
        errors.push((candidate.label || ('varian #' + (i + 1))) + ': ' + detail)
        // Do not retain partial/corrupt files between quality attempts; they can
        // fill the container disk and make the final watermark fallback fail.
        await Promise.all([
          fsp.rm(sourcePath, { force: true }).catch(() => {}),
          fsp.rm(outputPath, { force: true }).catch(() => {})
        ])
        console.warn('[TikTok] Varian gagal; file parsial dibuang:', errors[errors.length - 1])
        if (isDiskFullError(error)) {
          throw new Error('Penyimpanan server penuh saat mengunduh/merender TikTok (ENOSPC). Percobaan lain dihentikan agar disk tidak makin penuh. Bersihkan file sementara lama atau atur ALVARETH_TIKTOK_TMPDIR ke direktori dengan ruang kosong.')
        }
      }
    }

    // TikWM URLs can occasionally return truncated/corrupt H.264 data. Fall back
    // to yt-dlp directly from the original TikTok URL rather than trying every
    // corrupted variant again or falsely returning an incomplete MP4.
    if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
      let fallback = null
      try {
        console.log('[TikTok] Varian TikWM gagal; mencoba fallback yt-dlp resmi...')
        fallback = await downloadYoutubeVideoYtDlp(sourceUrl, 1080, (percent, detail) => {
          if (Number.isFinite(Number(percent))) {
            const value = Math.max(0, Math.min(100, Number(percent)))
            terminalProgress('Fallback yt-dlp', value, 0, NaN, String(detail || '').slice(0, 140))
          } else if (detail) console.log('[TikTok] yt-dlp:', String(detail).slice(0, 200))
        })
        const fileInfo = await fsp.stat(fallback.path)
        if (!fileInfo.size || fileInfo.size > MAX_VIDEO_BYTES) {
          throw new Error('Fallback yt-dlp menghasilkan file kosong atau lebih dari 150 MB.')
        }
        const duration = await getMediaDuration(fallback.path)
        if (!(duration > 0)) throw new Error('Fallback yt-dlp menghasilkan video yang metadata/durasinya tidak valid.')
        const normalizedPath = path.join(tempDir, 'yt-dlp-fallback.mp4')
        const normalized = await normalizeVideoToMp4(fallback.path, normalizedPath)
        console.log('[TikTok] Berhasil mengunduh TikTok memakai fallback yt-dlp.')
        return { ...normalized, quality: 'yt-dlp fallback' }
      } catch (error) {
        errors.push('yt-dlp fallback: ' + String(error?.message || error).slice(0, 600))
        if (isDiskFullError(error)) {
          throw new Error('Disk server penuh saat fallback yt-dlp. Bersihkan penyimpanan TokoPanel atau atur ALVARETH_TIKTOK_TMPDIR ke lokasi lain yang memiliki ruang cukup.')
        }
      } finally {
        if (fallback?.outputDir) await cleanupYtDlpDownload(fallback.outputDir).catch(() => {})
      }
    }

    throw new Error('Semua varian TikTok gagal diverifikasi/dikonversi. ' + errors.slice(0, 4).join(' | '))
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

  const isPhotoOnlyCommand = /^ttfoto$/i.test(command)
  // For .ttfoto, the command's URL must win over the quoted button/message text.
  // Otherwise a quoted caption can replace the URL and trigger a failed scrape.
  const input = String(isPhotoOnlyCommand
    ? (text || m.quoted?.text || m.quoted?.caption || '')
    : (m.quoted ? (m.quoted.text || m.quoted.caption || text || '') : (text || ''))
  ).trim()
  let photoActionKey = null
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

    if (!url && isPhotoOnlyCommand) {
      throw new Error('Perintah .ttfoto memerlukan tautan TikTok yang sama dengan perintah .tt sebelumnya. Kirim ulang .tt dengan tautan tersebut untuk membuat tombol foto baru.')
    }

    if (!url) {
      const results = await tiktokSearch(input)
      if (!results.length) throw new Error('Hasil TikTok tidak ditemukan.')
      url = results[0].url
    }

    if (isPhotoOnlyCommand) {
      const claim = claimPhotoAction(m.chat, m.sender, url)
      if (!claim.acquired) {
        console.info('[TikTok] Mengabaikan pemanggilan .ttfoto duplikat:', {
          chat: m.chat,
          sender: m.sender,
          state: claim.state
        })
        return
      }
      photoActionKey = claim.key
    }

    // If this came from the action button, send the exact source photo cached
    // during .tt. This fast path avoids TikWM being called a second time.
    if (isPhotoOnlyCommand) {
      const cachedPhoto = getCachedSinglePhoto(url)
      if (cachedPhoto) {
        const photoCaption = '📷 *FOTO ASLI TIKTOK*\n\n' +
          '📝 *Judul:* ' + cachedPhoto.title + '\n' +
          '👤 *Kreator:* ' + cachedPhoto.author + '\n\n' +
          '✨ _Downloaded by ' + (global.namebot || 'Alvareth Bot') + '_'
        await sendMessageWithReconnect(conn, m.chat, {
          image: cachedPhoto.imageBuffer,
          caption: photoCaption
        }, { quoted: m, noAlvarethPreview: true })
        markPhotoActionSent(photoActionKey)
        await reactSafe(conn, m, '✅')
        return
      }
    }

    const res = await tiktokScrape(url)
    if (!res) throw new Error('Gagal mengambil data TikTok. Pastikan tautan masih aktif dan dapat diakses.')

    const title = (res.title || 'TikTok Video').replace(/\s+/g, ' ').trim()
    const uploader = res.author || '-'
    const displayTitle = title.length > 220 ? title.slice(0, 217).trimEnd() + '...' : title
    const displayUploader = String(uploader).length > 80 ? String(uploader).slice(0, 77).trimEnd() + '...' : uploader
    const mediaFormat = res.type === 'image' ? 'Foto / Slideshow' : res.video ? 'Video MP4' : 'Media'
    const caption = [
      '🎬 *ALVARETH TIKTOK DOWNLOADER*',
      '',
      '✅ *Video berhasil diunduh*',
      '',
      '📝 *Judul*',
      displayTitle,
      '',
      '👤 *Kreator*',
      displayUploader,
      '',
      '📥 *Status:* Siap ditonton',
      '💠 *Format:* ' + mediaFormat,
      '',
      '✨ _Downloaded by Alvareth Bot_ ✨'
    ].join('\n')
    // .ttfoto must never fall through into the video sender. If no cached
    // photo exists, fetch just the original photo and stop with a clear error if
    // the provider has no images, rather than re-sending the rendered video.
    if (isPhotoOnlyCommand) {
      if (!Array.isArray(res.images) || res.images.length === 0) {
        throw new Error('Foto asli tidak tersedia dari provider TikTok saat ini. Jalankan .tt lagi untuk membuat video dan tombol foto baru; perintah .ttfoto tidak akan mengirim ulang video.')
      }
      await sendMessageWithReconnect(conn, m.chat, {
        image: { url: res.images[0] },
        caption: '📷 *FOTO ASLI TIKTOK*\n\n' +
          '📝 *Judul:* ' + title + '\n' +
          '👤 *Kreator:* ' + uploader + '\n\n' +
          '✨ _Downloaded by ' + (global.namebot || 'Alvareth Bot') + '_'
      }, { quoted: m, noAlvarethPreview: true })
      markPhotoActionSent(photoActionKey)
      await reactSafe(conn, m, '✅')
      return
    }

    if (res.type === 'image' && Array.isArray(res.images) && res.images.length > 0) {
      if (res.images.length === 1 && !/^ttfoto$/i.test(command)) {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alvareth-tiktok-single-'))
        const outputPath = path.join(tempDir, 'tiktok-photo.mp4')
        try {
          const rendered = await renderSinglePhotoWithMusic(res.images[0], res.audio, outputPath)
          await sendMessageWithReconnect(conn, m.chat, {
            video: rendered.buffer,
            mimetype: 'video/mp4',
            fileName: safeFilename(title),
            caption: caption + '\n\n🎵 Foto tunggal dirender menjadi video dengan musik asli, maksimal 60 detik.'
          }, { quoted: m, noAlvarethPreview: true })
          // Keep the original downloaded image for the button, so the selected
          // action doesn't re-scrape TikTok or accidentally re-send the video.
          cacheSinglePhoto(url, {
            imageBuffer: rendered.imageBuffer,
            title,
            author: String(uploader || '-')
          })
          // Reuse the same nativeFlow button format as plugins/main/menu.js.
          // This SC's Baileys fork handles menu actions through nativeFlow; a raw
          // templateButtons payload can be silently ignored by this sendMessage path.
          const buttonResult = await sendMessageWithReconnect(conn, m.chat, {
            text: 'Foto tunggal sudah dijadikan video. Mau foto aslinya?',
            footer: global.namebot || 'Alvareth Bot',
            optionText: 'Pilih Aksi',
            optionTitle: '📷 Foto TikTok',
            offerText: global.namebot || 'Alvareth Bot',
            offerCode: global.namebot || 'Alvareth Bot',
            offerUrl: global.botLink || 'https://spoo.me/Alvareth-Bot',
            offerExpiration: Date.now() + 86400000,
            nativeFlow: [{
              text: '📷 Ambil Foto Asli',
              id: `${usedPrefix}ttfoto ${url}`,
              icon: 'image'
            }],
            interactiveAsTemplate: false
          }, { quoted: m, noAlvarethPreview: true })
          if (!buttonResult?.key?.id) {
            throw new Error('Pesan tombol Ambil Foto tidak mengembalikan ID pesan.')
          }
        } finally {
          await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        }
      } else {
        if (res.images.length === 1) {
          // .ttfoto returns the original image directly; an album wrapper is unnecessary for one photo.
          await sendMessageWithReconnect(conn, m.chat, {
            image: { url: res.images[0] },
            caption
          }, { quoted: m, noAlvarethPreview: true })
        } else {
          const imageMessages = res.images.map((img, i) => ({
            image: { url: img },
            caption: i === 0 ? caption : ''
          }))
          await sendMessageWithReconnect(conn, m.chat, { album: imageMessages }, { quoted: m, noAlvarethPreview: true })
        }
      }
      await reactSafe(conn, m, '✅')
      return
    }

    if (res.video || (Array.isArray(res.videoCandidates) && res.videoCandidates.length)) {
      const prepared = await prepareBestTikTokVideo(res, url)
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
    releasePhotoAction(photoActionKey)
    await reactSafe(conn, m, '❌')
    console.error('[TikTok Downloader]', e?.stack || e)
    await sendMessageWithReconnect(conn, m.chat, {
      text: 'Gagal memproses TikTok: ' + String(e?.message || e)
    }, { quoted: m }).catch(() => {})
  }
}

handler.help = ['tt', 'tiktok']
handler.tags = ['downloader']
handler.command = /^(tt|tiktok|ttfoto)$/i
handler.limit = true
handler.register = false

export default handler
