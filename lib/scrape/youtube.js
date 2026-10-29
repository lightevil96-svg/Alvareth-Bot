import axios from 'axios'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { fileTypeFromFile } from 'file-type'

const API = 'https://be-video-downloader.qbyte.web.id'
const WEB = 'https://video.downloader.qbyte.web.id/'

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36'

const http = axios.create({
  timeout: 120000,
  maxRedirects: 5,
  validateStatus: () => true
})

function cleanName(text) {
  return String(text || 'media')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getId(format) {
  return String(format.format_id || format.itag || format.id)
}

function getHeight(format) {
  if (format.height) return Number(format.height)

  const resolution = String(format.resolution || '')

  const wxh = resolution.match(/(\d+)\s*x\s*(\d+)/i)
  if (wxh) return Number(wxh[2])

  const p = resolution.match(/(\d+)\s*p/i)
  if (p) return Number(p[1])

  const any = resolution.match(/\d+/)
  return any ? Number(any[0]) : 0
}

export async function getYoutubeInfo(url) {
  const res = await http.get(`${API}/api/info`, {
    params: { url },
    headers: {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      origin: WEB.slice(0, -1),
      referer: WEB
    }
  })

  if (res.status < 200 || res.status >= 300) throw new Error(`Gagal ambil info HTTP ${res.status}`)
  return res.data
}

function pickVideo(info, targetQuality) {
  const formats = Array.isArray(info.formats) ? info.formats : []

  const exact = formats
    .filter(f => f.vcodec !== 'none' && getHeight(f) === targetQuality)
    .sort((a, b) => {
      const av = String(a.ext || '').toLowerCase() === 'mp4' ? 1 : 0
      const bv = String(b.ext || '').toLowerCase() === 'mp4' ? 1 : 0
      return bv - av
    })

  if (exact[0]) return exact[0]

  const closest = formats
    .filter(f => f.vcodec !== 'none')
    .sort((a, b) => {
      const ah = getHeight(a)
      const bh = getHeight(b)
      const ad = Math.abs(ah - targetQuality)
      const bd = Math.abs(bh - targetQuality)

      if (ad !== bd) return ad - bd

      const av = String(a.ext || '').toLowerCase() === 'mp4' ? 1 : 0
      const bv = String(b.ext || '').toLowerCase() === 'mp4' ? 1 : 0

      return bv - av
    })

  if (closest[0]) return closest[0]

  throw new Error('Format video tidak ditemukan')
}

function pickBestVideo(info) {
  const formats = Array.isArray(info.formats) ? info.formats : []
  const videos = formats
    .filter(f => f.vcodec !== 'none')
    .sort((a, b) => {
      const heightDiff = getHeight(b) - getHeight(a)
      if (heightDiff !== 0) return heightDiff
      const aMp4 = String(a.ext || '').toLowerCase() === 'mp4' ? 1 : 0
      const bMp4 = String(b.ext || '').toLowerCase() === 'mp4' ? 1 : 0
      if (aMp4 !== bMp4) return bMp4 - aMp4
      return Number(b.tbr || 0) - Number(a.tbr || 0)
    })

  if (videos[0]) return videos[0]
  throw new Error('Tidak ada format video yang tersedia')
}

function getAudioBitrate(format) {
  return Number(format?.abr || format?.tbr || 0)
}

function pickAudioForBitrate(info, targetBitrate = 320) {
  const formats = Array.isArray(info.formats) ? info.formats : []
  const audio = formats
    .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
    .sort((a, b) => {
      const aRate = getAudioBitrate(a)
      const bRate = getAudioBitrate(b)
      if (targetBitrate >= 320) return bRate - aRate
      const aDistance = aRate ? Math.abs(aRate - targetBitrate) : Number.MAX_SAFE_INTEGER
      const bDistance = bRate ? Math.abs(bRate - targetBitrate) : Number.MAX_SAFE_INTEGER
      if (aDistance !== bDistance) return aDistance - bDistance
      return aRate - bRate
    })

  if (audio[0]) return audio[0]
  throw new Error('Format audio tidak ditemukan')
}

function pickBestAudio(info) {
  return pickAudioForBitrate(info, 320)
}

async function checkDownload() {
  const res = await http.get(`${API}/api/check-download`, {
    headers: {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      origin: WEB.slice(0, -1),
      referer: WEB
    }
  })

  if (res.status < 200 || res.status >= 300) throw new Error(`Server download sedang penuh HTTP ${res.status}`)
}

async function downloadFormat(url, info, format, label, outputDir) {
  await fsp.mkdir(outputDir, { recursive: true })

  const ext = format.ext || (label.includes('audio') ? 'm4a' : 'mp4')
  const formatId = getId(format)
  const title = cleanName(info.title || 'media')
  const filename = title + '.' + ext
  const output = path.join(outputDir, title + '-' + label + '-' + formatId + '.' + ext)

  await checkDownload()

  const res = await http.get(API + '/api/download', {
    params: { url, format: formatId, filename },
    responseType: 'stream',
    headers: {
      'user-agent': UA,
      accept: '*/*',
      referer: WEB
    }
  })

  if (res.status < 200 || res.status >= 300) {
    res.data?.destroy?.()
    throw new Error(label + ' gagal download HTTP ' + res.status)
  }

  const responseMime = String(res.headers?.['content-type'] || '')
    .split(';')[0].trim().toLowerCase()
  if (/^(text\/html|text\/plain|application\/json|application\/xml)/i.test(responseMime)) {
    res.data?.destroy?.()
    throw new Error(label + ' mengembalikan ' + responseMime + ', bukan file media.')
  }

  try {
    await pipeline(res.data, fs.createWriteStream(output))
    const stat = await fsp.stat(output)
    if (!stat.size) throw new Error(label + ' menghasilkan file kosong.')

    // Check file signatures before FFmpeg sees the file. Some providers respond
    // HTTP 200 with an HTML challenge/error page saved using an audio extension.
    const detected = await fileTypeFromFile(output)
    const mime = String(detected?.mime || '').toLowerCase()
    if (!detected || (!mime.startsWith('audio/') && !mime.startsWith('video/'))) {
      throw new Error(
        label + ' bukan file audio/video yang valid' +
        (responseMime ? ' (Content-Type: ' + responseMime + ')' : '') +
        (mime ? ' (deteksi: ' + mime + ')' : '.')
      )
    }

    return output
  } catch (error) {
    await fsp.unlink(output).catch(() => {})
    throw error
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })

    let error = ''
    ffmpeg.stderr.on('data', chunk => { error += chunk.toString() })

    ffmpeg.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg gagal code ${code}: ${error.slice(-700)}`))
    })

    ffmpeg.on('error', reject)
  })
}

async function mergeVideoAudio(videoPath, audioPath, outputPath) {
  await runFfmpeg(['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-shortest', outputPath])
  return outputPath
}

async function convertAudioToMp3(audioPath, outputPath, targetBitrate = 320) {
  const bitrate = [128, 192, 256, 320].includes(Number(targetBitrate)) ? Number(targetBitrate) : 320
  await runFfmpeg(['-y', '-i', audioPath, '-vn', '-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`, outputPath])
  return outputPath
}

export async function downloadYoutubeVideo(url, targetQuality = 720, onProgress = null) {
  const normalizedUrl = normalizeYoutubeVideoUrl(url)
  const sessionId = crypto.randomBytes(4).toString('hex')
  const outputDir = path.resolve('./downloads', sessionId)

  try {
    onProgress?.(0, 'Mencoba API metadata YouTube')
    const info = await getYoutubeInfo(normalizedUrl)
    const videoFormat = pickVideo(info, targetQuality)
    const audioFormat = pickBestAudio(info)
    const title = cleanName(info.title || 'media')
    const quality = getHeight(videoFormat) || targetQuality

    onProgress?.(0, 'API metadata berhasil; mengunduh format video/audio')
    const videoTemp = await downloadFormat(normalizedUrl, info, videoFormat, 'video-temp', outputDir)
    onProgress?.(45, 'Unduhan video selesai; mengunduh audio')
    const audioTemp = await downloadFormat(normalizedUrl, info, audioFormat, 'audio-temp', outputDir)
    onProgress?.(85, 'Unduhan selesai; menggabungkan audio-video')
    const mp4Path = path.join(outputDir, `${title}-${quality}p.mp4`)
    await mergeVideoAudio(videoTemp, audioTemp, mp4Path)
    await fsp.unlink(videoTemp).catch(() => {})
    await fsp.unlink(audioTemp).catch(() => {})
    return { path: mp4Path, outputDir, title: info.title, quality }
  } catch (apiError) {
    await cleanupDownload(outputDir)
    console.warn('[YouTube] Provider API gagal, mencoba fallback yt-dlp:', apiError?.message || apiError)
    try {
      return await downloadYoutubeVideoYtDlp(normalizedUrl, targetQuality, onProgress)
    } catch (fallbackError) {
      throw new Error(
        'Downloader YouTube utama gagal (' + String(apiError?.message || apiError).slice(0, 160) +
        '); fallback yt-dlp juga gagal (' + String(fallbackError?.message || fallbackError).slice(0, 220) + ').'
      )
    }
  }
}

function normalizeYoutubeVideoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0]
      if (id) return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id)
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com')) {
      const match = url.pathname.match(/^\/(?:live|shorts|embed|v)\/([^/?#]+)/i)
      if (match?.[1]) return 'https://www.youtube.com/watch?v=' + encodeURIComponent(match[1])
    }
    return url.toString()
  } catch {
    return String(rawUrl || '')
  }
}

// Fallback built from the official open-source yt-dlp binary. It handles YouTube
// live/watch/shorts URLs without relying on the third-party qbyte download API.
export async function downloadYoutubeVideoYtDlp(url, targetQuality = 360, onProgress = null) {
  const normalizedUrl = normalizeYoutubeVideoUrl(url)
  const outputDir = path.resolve('./downloads', crypto.randomBytes(4).toString('hex'))
  await fsp.mkdir(outputDir, { recursive: true })
  try {
    const binaryPath = (await ensureYtDlpPythonRunner()) || await ensureYtDlpBinary()
    const template = path.join(outputDir, '%(title).180B.%(ext)s')
    const quality = Math.max(144, Math.min(2160, Math.floor(Number(targetQuality) || 360)))
    const format = 'bestvideo[height<=' + quality + ']+bestaudio/best[height<=' + quality + ']/best'
    const isTikTok = /(^|\.)tiktok\.com$/i.test(new URL(normalizedUrl).hostname)
    const userAgentArgs = isTikTok ? [
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      '--referer', 'https://www.tiktok.com/'
    ] : []
    if (typeof onProgress === 'function') onProgress(0, 'yt-dlp siap; mengambil metadata')
    const { stdout } = await runYtDlp(binaryPath, [
      ...userAgentArgs,
      '--newline',
      '--no-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '--socket-timeout', '45',
      '--retries', '4',
      '--fragment-retries', '4',
      '--merge-output-format', 'mp4',
      '-f', format,
      '--print', 'after_move:filepath',
      '-o', template,
      normalizedUrl
    ], 6 * 60 * 60 * 1000, (percent, line) => onProgress?.(percent, line))
    const outputPath = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
    if (!outputPath || !path.isAbsolute(outputPath)) throw new Error('yt-dlp tidak mengembalikan path hasil video.')
    const info = await fsp.stat(outputPath)
    const detected = await fileTypeFromFile(outputPath)
    if (!info.size || !detected?.mime?.startsWith('video/')) {
      throw new Error('Hasil unduhan yt-dlp bukan video yang valid.')
    }
    const title = path.basename(outputPath, path.extname(outputPath))
    return { path: outputPath, outputDir, title, quality, downloader: 'yt-dlp' }
  } catch (error) {
    await cleanupDownload(outputDir)
    throw error
  }
}

export async function downloadYoutubeVideoBest(url) {
  const sessionId = crypto.randomBytes(4).toString('hex')
  const outputDir = path.join('./downloads', sessionId)

  const info = await getYoutubeInfo(url)
  const videoFormat = pickBestVideo(info)
  const audioFormat = pickBestAudio(info)
  const title = cleanName(info.title || 'media')
  const quality = getHeight(videoFormat) || 'Auto'

  const videoTemp = await downloadFormat(url, info, videoFormat, 'video-best-temp', outputDir)
  const audioTemp = await downloadFormat(url, info, audioFormat, 'audio-best-temp', outputDir)
  const mp4Path = path.join(outputDir, `${title}-${quality}p.mp4`)
  await mergeVideoAudio(videoTemp, audioTemp, mp4Path)

  await fsp.unlink(videoTemp).catch(() => {})
  await fsp.unlink(audioTemp).catch(() => {})

  return {
    path: mp4Path,
    outputDir,
    title: info.title,
    quality,
    sourceAudioBitrate: getAudioBitrate(audioFormat) || null
  }
}

export async function downloadYoutubeAudio(url, targetBitrate = 320) {
  const requestedBitrate = [128, 192, 256, 320].includes(Number(targetBitrate))
    ? Number(targetBitrate)
    : 320
  const sessionId = crypto.randomBytes(4).toString('hex')
  const outputDir = path.join('./downloads', sessionId)

  try {
    const info = await getYoutubeInfo(url)
    const audioFormat = pickAudioForBitrate(info, requestedBitrate)
    const sourceBitrate = getAudioBitrate(audioFormat) || null
    const title = cleanName(info.title || 'media')
    const audioTemp = await downloadFormat(url, info, audioFormat, 'audio-temp', outputDir)
    const mp3Path = path.join(outputDir, title + '-' + requestedBitrate + 'kbps.mp3')
    await convertAudioToMp3(audioTemp, mp3Path, requestedBitrate)
    await fsp.unlink(audioTemp).catch(() => {})

    const stat = await fsp.stat(mp3Path)
    if (!stat.size || !(await fileTypeFromFile(mp3Path))) {
      throw new Error('Hasil konversi MP3 kosong atau bukan file audio yang valid.')
    }

    return {
      path: mp3Path,
      outputDir,
      title: info.title,
      bitrate: requestedBitrate,
      sourceBitrate
    }
  } catch (error) {
    await cleanupDownload(outputDir)
    throw error
  }
}

export async function encodeAudioBufferToMp3(buffer, targetBitrate = 320) {
  const bitrate = [128, 192, 256, 320].includes(Number(targetBitrate)) ? Number(targetBitrate) : 320
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Data audio kosong.')
  const outputDir = path.join('./downloads', crypto.randomBytes(4).toString('hex'))
  await fsp.mkdir(outputDir, { recursive: true })
  const inputPath = path.join(outputDir, 'audio-input.bin')
  const outputPath = path.join(outputDir, `audio-${bitrate}kbps.mp3`)

  try {
    await fsp.writeFile(inputPath, buffer)
    await convertAudioToMp3(inputPath, outputPath, bitrate)
    return {
      buffer: await fsp.readFile(outputPath),
      outputDir,
      bitrate
    }
  } catch (error) {
    await cleanupDownload(outputDir)
    throw error
  }
}

export async function cleanupDownload(outputDir) {
  await fsp.rm(outputDir, { recursive: true, force: true }).catch(() => {})
}

// Last-resort local downloader. Uses the official yt-dlp release binary and
// caches it outside per-request folders so expired third-party API links do not
// permanently break .ytmp3. Linux x64/arm64 are the supported panel targets.
async function ensureYtDlpBinary() {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
    throw new Error('Fallback yt-dlp otomatis hanya didukung pada Linux x64/arm64.')
  }

  const binDir = path.resolve('./downloads/.bin')
  const binaryPath = path.join(binDir, process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux')
  await fsp.mkdir(binDir, { recursive: true })

  try {
    const stat = await fsp.stat(binaryPath)
    // Refresh a cached binary periodically so an old yt-dlp release does not
    // keep failing after YouTube changes its extraction/challenge requirements.
    const isFresh = Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000
    if (stat.isFile() && stat.size > 1024 * 1024 && isFresh) {
      await fsp.chmod(binaryPath, 0o755)
      return binaryPath
    }
  } catch {}

  const binaryUrl = process.arch === 'arm64'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'

  const response = await fetch(binaryUrl, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error('Gagal mengunduh fallback yt-dlp resmi (HTTP ' + response.status + ').')
  const binary = Buffer.from(await response.arrayBuffer())
  if (binary.length < 1024 * 1024) throw new Error('File fallback yt-dlp terlalu kecil atau tidak valid.')

  const tempPath = binaryPath + '.tmp'
  await fsp.writeFile(tempPath, binary, { mode: 0o755 })
  await fsp.chmod(tempPath, 0o755)
  await fsp.rename(tempPath, binaryPath)
  return binaryPath
}

async function ensureYtDlpPythonRunner() {
  // Prefer the official Python script to avoid PyInstaller's one-file extraction
  // error (e.g. Cryptodome/_ARC4.abi3.so decompression failure on constrained panels).
  const candidates = ['python3', 'python']
  for (const command of candidates) {
    try {
      await new Promise((resolvePromise, reject) => {
        const child = spawn(command, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Python version check timed out')) }, 5000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', code => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(command + ' unavailable')) })
      })
      const binDir = path.resolve('./downloads/.bin')
      const scriptPath = path.join(binDir, 'yt-dlp.py')
      await fsp.mkdir(binDir, { recursive: true })
      let fresh = false
      try {
        const info = await fsp.stat(scriptPath)
        fresh = info.isFile() && info.size > 1024 * 1024 && Date.now() - info.mtimeMs < 24 * 60 * 60 * 1000
      } catch {}
      if (!fresh) {
        const response = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', {
          signal: AbortSignal.timeout(120000),
          headers: { 'User-Agent': 'AlvarethBot/1.0' }
        })
        if (!response.ok) throw new Error('Gagal mengunduh skrip yt-dlp resmi (HTTP ' + response.status + ').')
        const script = Buffer.from(await response.arrayBuffer())
        const preview = script.subarray(0, 256).toString('utf8')
        if (script.length < 1024 * 1024 || !preview.includes('python')) {
          throw new Error('Skrip yt-dlp dari GitHub tidak valid.')
        }
        const tempPath = scriptPath + '.tmp'
        await fsp.writeFile(tempPath, script, { mode: 0o600 })
        await fsp.rename(tempPath, scriptPath)
      }
      return { command, prefix: [scriptPath] }
    } catch (error) {
      console.warn('[YouTube] Python yt-dlp belum bisa digunakan dengan ' + command + ':', error?.message || error)
    }
  }
  return null
}

function runYtDlp(binaryPath, args, timeoutMs = 180000, onProgress = null) {
  return new Promise((resolve, reject) => {
    const command = typeof binaryPath === 'string' ? binaryPath : binaryPath.command
    const prefix = typeof binaryPath === 'string' ? [] : (binaryPath.prefix || [])
    const child = spawn(command, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let pending = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('yt-dlp timeout setelah ' + Math.round(timeoutMs / 60000) + ' menit.'))
    }, timeoutMs)
    const consumeProgress = chunk => {
      pending += chunk.toString()
      const lines = pending.split(/[\\r\\n]+/)
      pending = lines.pop() || ''
      for (const line of lines) {
        const match = line.match(/\\[download\\]\\s+(\\d+(?:\\.\\d+)?)%/)
        if (match && typeof onProgress === 'function') {
          try { onProgress(Number(match[1]), line.trim()) } catch {}
        }
      }
    }
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-250000) })
    child.stderr.on('data', chunk => {
      const data = chunk.toString()
      stderr = (stderr + data).slice(-12000)
      consumeProgress(data)
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (pending) consumeProgress('\\n')
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      else reject(new Error('yt-dlp gagal code ' + code + ': ' + (stderr || stdout).slice(-1200)))
    })
  })
}

export async function downloadYoutubeAudioYtDlp(url, targetBitrate = 320) {
  const bitrate = [128, 192, 256, 320].includes(Number(targetBitrate)) ? Number(targetBitrate) : 320
  const outputDir = path.resolve('./downloads', crypto.randomBytes(4).toString('hex'))
  await fsp.mkdir(outputDir, { recursive: true })

  try {
    const binaryPath = await ensureYtDlpBinary()
    const template = path.join(outputDir, '%(title).180B.%(ext)s')
    const { stdout } = await runYtDlp(binaryPath, [
      '--no-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '--socket-timeout', '30',
      '--retries', '2',
      '--fragment-retries', '2',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', bitrate + 'K',
      '--print', 'after_move:filepath',
      '-o', template,
      url
    ])

    const outputPath = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
    if (!outputPath || !path.isAbsolute(outputPath)) throw new Error('yt-dlp tidak mengembalikan lokasi file hasil.')
    const stat = await fsp.stat(outputPath)
    const detected = await fileTypeFromFile(outputPath)
    if (!stat.size || detected?.mime !== 'audio/mpeg') {
      throw new Error('Hasil yt-dlp bukan file MP3 yang valid.')
    }

    return {
      path: outputPath,
      outputDir,
      title: path.basename(outputPath, path.extname(outputPath)),
      bitrate,
      sourceBitrate: null
    }
  } catch (error) {
    await cleanupDownload(outputDir)
    throw error
  }
}
