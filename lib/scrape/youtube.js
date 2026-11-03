import axios from 'axios'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
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

function getFps(format) {
  return Number(format?.fps || format?.framerate || format?.frame_rate || 0)
}

function getWidth(format) {
  if (format?.width) return Number(format.width)
  const resolution = String(format?.resolution || '')
  const match = resolution.match(/(\d+)\s*x\s*(\d+)/i)
  return match ? Number(match[1]) : 0
}

function getFormatPixels(format) {
  return getWidth(format) * getHeight(format)
}

function getVideoBitrate(format) {
  return Number(format?.vbr || format?.tbr || format?.bitrate || 0)
}

function compareVideoFormats(a, b) {
  return getFormatPixels(b) - getFormatPixels(a) ||
    getHeight(b) - getHeight(a) ||
    getWidth(b) - getWidth(a) ||
    getFps(b) - getFps(a) ||
    getVideoBitrate(b) - getVideoBitrate(a) ||
    Number(b.filesize || b.filesize_approx || 0) - Number(a.filesize || a.filesize_approx || 0)
}

export async function getYoutubeInfo(url, timeoutMs = 120000) {
  const res = await http.get(`${API}/api/info`, {
    params: { url },
    timeout: timeoutMs,
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

async function getClipYoutubeInfo(url, onProgress = null) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await getYoutubeInfo(url, 0)
    } catch (error) {
      lastError = error
      const transient = /Gagal ambil info HTTP (?:502|503|504)\b/.test(String(error?.message || error))
      if (!transient || attempt >= 2) break
      console.warn('[YouTube Clip] API cadangan bermasalah sementara; satu kali retry setelah HTTP 5xx.')
      try { onProgress?.(null, '[qbyte] API cadangan mengalami gangguan sementara, mencoba ulang sekali.') } catch {}
      await new Promise(resolve => setTimeout(resolve, 1200))
    }
  }
  throw lastError
}

function pickVideo(info, targetQuality) {
  const formats = Array.isArray(info.formats) ? info.formats : []

  const exact = formats
    .filter(f => getHeight(f) > 0 && f.vcodec !== 'none' && getHeight(f) === targetQuality)
    .sort((a, b) => {
      const av = String(a.ext || '').toLowerCase() === 'mp4' ? 1 : 0
      const bv = String(b.ext || '').toLowerCase() === 'mp4' ? 1 : 0
      return bv - av
    })

  if (exact[0]) return exact[0]

  const closest = formats
    .filter(f => getHeight(f) > 0 && f.vcodec !== 'none')
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

function getVideoFormats(info) {
  return (Array.isArray(info?.formats) ? info.formats : [])
    .filter(format => getHeight(format) > 0 && format.vcodec !== 'none')
    .sort(compareVideoFormats)
}

function pickBestVideo(info) {
  const video = getVideoFormats(info)[0]
  if (video) return video
  throw new Error('Tidak ada format video yang tersedia')
}

function getAudioFormats(info) {
  return (Array.isArray(info?.formats) ? info.formats : [])
    .filter(format => format.acodec && format.acodec !== 'none' && format.vcodec === 'none')
    .sort((a, b) =>
      getAudioBitrate(b) - getAudioBitrate(a) ||
      Number(b.asr || 0) - Number(a.asr || 0) ||
      Number(b.filesize || b.filesize_approx || 0) - Number(a.filesize || a.filesize_approx || 0)
    )
}

function selectYtDlpFormats(info) {
  const videoFormats = getVideoFormats(info)
  const audioFormats = getAudioFormats(info)
  const video = videoFormats[0]
  if (!video) throw new Error('yt-dlp tidak menemukan stream video dengan resolusi yang valid.')

  const videoId = String(video.format_id || video.itag || video.id || '')
  if (!videoId) throw new Error('Format video terbaik tidak memiliki format ID.')
  const videoHasAudio = Boolean(video.acodec && video.acodec !== 'none')
  const audio = audioFormats[0]
  const audioId = String(audio?.format_id || audio?.itag || audio?.id || '')
  if (!videoHasAudio && !audioId) {
    throw new Error('Format video terbaik tidak memiliki audio dan stream audio terpisah tidak tersedia.')
  }

  return {
    selector: videoId + (videoHasAudio ? '' : '+' + audioId),
    video,
    audio: videoHasAudio ? null : audio,
    videoFormats,
    audioFormats
  }
}

function formatInventorySummary(formats, limit = 6) {
  return formats.slice(0, limit).map(format => ({
    id: String(format.format_id || format.itag || format.id || '?'),
    resolution: getWidth(format) + 'x' + getHeight(format),
    fps: getFps(format) || null,
    videoKbps: getVideoBitrate(format) || null,
    codec: String(format.vcodec || ''),
    ext: String(format.ext || '')
  }))
}

// Cookie data is kept entirely on the private TokoPanel filesystem.
// Never commit or log its content, or accept cookies through WhatsApp.
function getClipCookiesArgs() {
  const configured = String(process.env.YTDLP_COOKIES_FILE || '').trim()
  const privatePath = path.resolve('.alvareth-bot-data/youtube-cookies.txt')
  const filePath = configured || privatePath
  if (!configured && !fs.existsSync(filePath)) return []
  if (!path.isAbsolute(filePath)) {
    throw new Error('YTDLP_COOKIES_FILE harus menunjuk path absolut di server.')
  }
  let stat
  try {
    stat = fs.statSync(filePath)
    fs.accessSync(filePath, fs.constants.R_OK)
  } catch {
    const error = new Error('File cookies YouTube tidak ditemukan atau tidak dapat dibaca. Periksa YTDLP_COOKIES_FILE di TokoPanel.')
    error.code = 'YOUTUBE_COOKIES_INVALID'
    throw error
  }
  if (!stat.isFile() || stat.size < 32) {
    const error = new Error('File cookies YouTube kosong atau bukan file yang valid.')
    error.code = 'YOUTUBE_COOKIES_INVALID'
    throw error
  }
  // yt-dlp requires a Netscape/Mozilla cookie jar, not JSON or raw headers.
  let header = ''
  let descriptor = null
  try {
    descriptor = fs.openSync(filePath, 'r')
    const chunk = Buffer.alloc(96)
    const size = fs.readSync(descriptor, chunk, 0, chunk.length, 0)
    header = chunk.subarray(0, size).toString('utf8')
  } catch {
    const error = new Error('File cookies YouTube tidak dapat dibuka untuk validasi.')
    error.code = 'YOUTUBE_COOKIES_INVALID'
    throw error
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
  }
  if (!/^# (?:Netscape )?HTTP Cookie File(?:\r?\n|$)/.test(header)) {
    const error = new Error('File cookies YouTube harus dalam format Netscape cookies.txt, bukan JSON atau header mentah.')
    error.code = 'YOUTUBE_COOKIES_INVALID'
    throw error
  }
  return ['--cookies', filePath]
}

function isYoutubeVerificationError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return /sign in to confirm you.{0,3}re not a bot|use --cookies(?:-from-browser)?|confirm you're not a bot/.test(message)
}

function getYtDlpPotProviderArgs() {
  const raw = String(process.env.YTDLP_POT_PROVIDER_URL || '').trim()
  if (!raw) return []
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL provider harus HTTP atau HTTPS.')
    return ['--extractor-args', 'youtubepot-bgutilhttp:base_url=' + url.origin]
  } catch (error) {
    console.warn('[YouTube Clip] YTDLP_POT_PROVIDER_URL tidak valid:', error?.message || error)
    return []
  }
}

async function probeYtDlpFormats(runner, url, methodLabel, onProgress = null) {
  try { onProgress?.(null, '[quality] ' + methodLabel + ': memeriksa profil YouTube dan seluruh format.') } catch {}
  const baseArgs = [
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes', 'node',
    ...getClipCookiesArgs()
  ]
  const potProviderArgs = getYtDlpPotProviderArgs()
  const profiles = [
    { name: 'default', args: [] },
    { name: 'web_safari HLS', args: ['--extractor-args', 'youtube:player_client=web_safari'] }
  ]
  if (potProviderArgs.length) {
    profiles.push({
      name: 'mweb + PO Token Provider',
      args: ['--extractor-args', 'youtube:player_client=mweb', ...potProviderArgs]
    })
  }

  const candidates = []
  const profileFailures = []
  for (const profile of profiles) {
    try {
      let response
      try {
        response = await runYtDlp(runner, [
          ...baseArgs,
          '--remote-components', 'ejs:github',
          ...profile.args,
          url
        ], 0)
      } catch (error) {
        if (isYoutubeVerificationError(error)) throw error
        console.warn('[YouTube Clip] EJS remote component gagal pada ' + methodLabel + '/' + profile.name + '; mencoba tanpa komponen remote:', error?.message || error)
        response = await runYtDlp(runner, [...baseArgs, ...profile.args, url], 0)
      }

      const raw = String(response.stdout || '')
      const jsonStart = raw.indexOf('{')
      const jsonEnd = raw.lastIndexOf('}')
      if (jsonStart < 0 || jsonEnd <= jsonStart) {
        throw new Error('Metadata format JSON tidak ditemukan.')
      }

      let info
      try {
        info = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
      } catch (error) {
        throw new Error('Gagal membaca metadata format: ' + String(error?.message || error).slice(0, 160))
      }

      const selection = selectYtDlpFormats(info)
      selection.extractorArgs = profile.args
      selection.profileName = profile.name
      candidates.push(selection)
      console.log('[YouTube Clip] Inventaris kualitas ' + methodLabel + '/' + profile.name + ': ' + JSON.stringify({
        jumlahVideo: selection.videoFormats.length,
        jumlahAudio: selection.audioFormats.length,
        videoTerbaik: formatInventorySummary(selection.videoFormats, 8),
        audioTerbaik: formatInventorySummary(selection.audioFormats, 3),
        formatTerpilih: selection.selector
      }))
    } catch (error) {
      const detail = String(error?.message || error).slice(0, 220)
      profileFailures.push({ profile: profile.name, detail, verificationBlocked: isYoutubeVerificationError(error) })
      console.warn('[YouTube Clip] Profil ' + profile.name + ' tidak tersedia untuk ' + methodLabel + ': ' + detail)
    }
  }

  if (!candidates.length) {
    const blocked = profileFailures.some(item => item.verificationBlocked)
    const error = new Error(blocked
      ? 'YouTube meminta verifikasi akun pada server. Sediakan cookies dari sesi YouTube milik sendiri secara privat di TokoPanel; pemilihan resolusi tidak bisa berjalan sebelum akses diberikan.'
      : methodLabel + ' gagal membaca format dari seluruh profil YouTube: ' +
        profileFailures.map(item => item.profile + ': ' + item.detail).join(' | '))
    if (blocked) error.code = 'YOUTUBE_AUTH_REQUIRED'
    throw error
  }

  // Metadata says that a stream EXISTS, not that it can actually be downloaded.
  // Prefer HTTP/DASH over HLS at the same resolution; HLS can produce an
  // audio-only intermediate even when the manifest advertises 1080p.
  const protocolRank = format => {
    const protocol = String(format?.protocol || '').toLowerCase()
    if (protocol === 'https' || protocol === 'http') return 2
    if (protocol.startsWith('m3u8')) return 0
    return 1
  }
  const compareAccessibleVideo = (a, b) => {
    return getFormatPixels(b) - getFormatPixels(a) ||
      getHeight(b) - getHeight(a) ||
      getFps(b) - getFps(a) ||
      protocolRank(b) - protocolRank(a) ||
      getVideoBitrate(b) - getVideoBitrate(a)
  }
  const attempts = []
  const seen = new Set()
  for (const profile of candidates) {
    const formats = [...profile.videoFormats].sort(compareAccessibleVideo)
    for (const video of formats) {
      const videoId = String(video.format_id || video.itag || video.id || '')
      const containsAudio = Boolean(video.acodec && video.acodec !== 'none')
      const audio = containsAudio ? null : profile.audioFormats[0]
      const audioId = String(audio?.format_id || audio?.itag || audio?.id || '')
      if (!videoId || (!containsAudio && !audioId)) continue
      const key = profile.profileName + '|' + videoId + '|' + audioId
      if (seen.has(key)) continue
      seen.add(key)
      attempts.push({
        selector: videoId + (containsAudio ? '' : '+' + audioId),
        video, audio,
        extractorArgs: profile.extractorArgs,
        profileName: profile.profileName
      })
    }
  }
  attempts.sort((a, b) => compareAccessibleVideo(a.video, b.video))
  const best = attempts[0]
  if (!best) throw new Error('Tidak ada pilihan format audio dan video yang bisa dipasangkan.')

  const topWidth = getWidth(best.video)
  const topHeight = getHeight(best.video)
  // Keep only the highest resolution. One alternate stream at the exact same
  // dimensions may be tried if the preferred transport is broken; never walk
  // down through 720p/480p/360p merely to compare downloaded outputs.
  const selectedAttempts = attempts
    .filter(item => getWidth(item.video) === topWidth && getHeight(item.video) === topHeight)
    .slice(0, 2)

  const qualityMap = new Map()
  for (const profile of candidates) {
    for (const video of profile.videoFormats) {
      const width = getWidth(video)
      const height = getHeight(video)
      if (!width || !height) continue
      const key = width + 'x' + height
      const current = qualityMap.get(key)
      if (!current || compareAccessibleVideo(video, current) < 0) qualityMap.set(key, video)
    }
  }
  const availableQualities = [...qualityMap.values()]
    .sort(compareAccessibleVideo)
    .map(video => ({
      resolution: getWidth(video) + 'x' + getHeight(video),
      height: getHeight(video),
      fps: getFps(video) || null,
      protocol: video.protocol || '?'
    }))

  console.log('[YouTube Clip] Semua resolusi tersedia ' + methodLabel + ': ' +
    JSON.stringify(availableQualities))
  console.log('[YouTube Clip] Kualitas tertinggi dipilih ' + methodLabel + ': ' + JSON.stringify({
    format: best.selector,
    client: best.profileName,
    resolution: topWidth + 'x' + topHeight,
    fps: getFps(best.video) || null,
    protocol: best.video.protocol || '?',
    sameResolutionFallbacks: Math.max(0, selectedAttempts.length - 1)
  }))
  if (topHeight <= 360) {
    console.warn('[YouTube Clip] Semua profil ' + methodLabel + ' hanya melihat format sampai ' +
      topHeight + 'p. Jika sumber aslinya HD, periksa EJS dan konfigurasi PO Token Provider.')
  }
  return { ...best, attempts: selectedAttempts, topHeight, topWidth, availableQualities }
}

function getAudioBitrate(format) {
  return Number(format?.abr || format?.tbr || 0)
}

function pickAudioForBitrate(info, targetBitrate = 320) {
  const formats = Array.isArray(info.formats) ? info.formats : []
  const audio = formats
    .filter(f => f.vcodec === 'none' && Boolean(f.acodec) && f.acodec !== 'none')
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

async function checkDownload(timeoutMs = 120000) {
  const res = await http.get(`${API}/api/check-download`, {
    timeout: timeoutMs,
    headers: {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      origin: WEB.slice(0, -1),
      referer: WEB
    }
  })

  if (res.status < 200 || res.status >= 300) throw new Error(`Server download sedang penuh HTTP ${res.status}`)
}

async function downloadFormat(url, info, format, label, outputDir, maxBytes = Infinity, onProgress = null, timeoutMs = 120000) {
  await fsp.mkdir(outputDir, { recursive: true })

  const ext = format.ext || (label.includes('audio') ? 'm4a' : 'mp4')
  const formatId = getId(format)
  const title = cleanName(info.title || 'media')
  const filename = title + '.' + ext
  const output = path.join(outputDir, title + '-' + label + '-' + formatId + '.' + ext)

  await checkDownload(timeoutMs)

  const res = await http.get(API + '/api/download', {
    timeout: timeoutMs,
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

  const contentLength = Number(res.headers?.['content-length'] || 0)
  if (Number.isFinite(maxBytes) && maxBytes > 0 && contentLength > maxBytes) {
    res.data?.destroy?.()
    throw new Error(label + ' melebihi batas ukuran sumber ' + Math.round(maxBytes / 1024 / 1024) + ' MB.')
  }

  try {
    let received = 0
    const transferStartedAt = Date.now()
    let lastReportAt = 0
    let lastReportedPercent = -1
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length
        if (Number.isFinite(maxBytes) && maxBytes > 0 && received > maxBytes) {
          callback(new Error(label + ' melebihi batas ukuran sumber ' + Math.round(maxBytes / 1024 / 1024) + ' MB.'))
          return
        }
        if (typeof onProgress === 'function') {
          const now = Date.now()
          const percent = contentLength > 0 ? Math.min(99, received / contentLength * 100) : null
          const shouldReport = percent === null
            ? now - lastReportAt >= 2500
            : percent - lastReportedPercent >= 5 || now - lastReportAt >= 5000
          if (shouldReport) {
            const elapsedSeconds = Math.max((now - transferStartedAt) / 1000, 0.001)
            const speedBytesPerSecond = received / elapsedSeconds
            const speedText = (speedBytesPerSecond / 1024 / 1024).toFixed(2) + ' MB/s'
            const etaSeconds = contentLength > 0 && speedBytesPerSecond > 0
              ? Math.ceil(Math.max(0, contentLength - received) / speedBytesPerSecond)
              : null
            const etaText = etaSeconds === null
              ? ''
              : ' | ETA ' + Math.floor(etaSeconds / 60) + ':' + String(etaSeconds % 60).padStart(2, '0')
            const detail = '[download] ' + label + ': ' +
              (received / 1024 / 1024).toFixed(1) + ' MB' +
              (contentLength > 0 ? ' / ' + (contentLength / 1024 / 1024).toFixed(1) + ' MB (' + percent.toFixed(1) + '%)' : ' diterima') +
              ' | ' + speedText + etaText
            try { onProgress(percent, detail) } catch {}
            lastReportAt = now
            if (percent !== null) lastReportedPercent = percent
          }
        }
        callback(null, chunk)
      }
    })
    await pipeline(res.data, limiter, fs.createWriteStream(output))
    if (typeof onProgress === 'function') {
      try { onProgress(100, '[download] ' + label + ' selesai: ' + (received / 1024 / 1024).toFixed(1) + ' MB') } catch {}
    }

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
    if (label.toLowerCase().includes('video')) {
      const videoStream = await inspectVideoStream(output)
      if (!videoStream?.width || !videoStream?.height) {
        throw new Error(label + ' tidak memiliki stream video yang valid; file audio-only ditolak.')
      }
    }
    if (label.toLowerCase().includes('audio')) {
      const audioStream = await inspectAudioStream(output)
      if (!audioStream) throw new Error(label + ' tidak memiliki stream audio yang valid.')
    }

    return output
  } catch (error) {
    res.data?.destroy?.()
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

// Read the dimensions and frame rate of the downloaded output rather than
// reporting the requested ceiling (e.g. 2160p) as if it were the actual quality.
async function inspectVideoStream(filePath) {
  return new Promise(resolve => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const finish = result => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,bit_rate,pix_fmt,profile',
      '-of', 'json',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', () => finish(null))
    child.once('close', code => {
      if (code !== 0) {
        if (stderr.trim()) console.warn('[YouTube] ffprobe gagal:', stderr.trim().slice(-300))
        return finish(null)
      }
      try {
        const data = JSON.parse(stdout)
        const stream = (data.streams || []).find(item => item.height || item.width)
        if (!stream) return finish(null)
        const parseRate = value => {
          const [numerator, denominator = '1'] = String(value || '').split('/')
          const n = Number(numerator)
          const d = Number(denominator)
          const rate = n / d
          return Number.isFinite(rate) && rate > 0 ? rate : 0
        }
        const frameRate = parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate)
        finish({
          width: Number(stream.width) || null,
          height: Number(stream.height) || null,
          fps: frameRate ? Math.round(frameRate) : null,
          bitrate: Number(stream.bit_rate) || 0,
          pixelFormat: String(stream.pix_fmt || ''),
          profile: String(stream.profile || ''),
          codec: String(stream.codec_name || '')
        })
      } catch {
        finish(null)
      }
    })
  })
}

async function inspectAudioStream(filePath) {
  return new Promise(resolve => {
    let settled = false
    let stdout = ''
    const finish = result => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels',
      '-of', 'json',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.once('error', () => finish(null))
    child.once('close', code => {
      if (code !== 0) return finish(null)
      try {
        const stream = (JSON.parse(stdout).streams || []).find(item => item.codec_name)
        finish(stream ? {
          codec: String(stream.codec_name),
          sampleRate: Number(stream.sample_rate) || null,
          channels: Number(stream.channels) || null
        } : null)
      } catch {
        finish(null)
      }
    })
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
export async function downloadYoutubeVideoYtDlp(url, targetQuality = 360, onProgress = null, options = {}) {
  const normalizedUrl = normalizeYoutubeVideoUrl(url)
  const outputRoot = String(options?.outputRoot || '').trim()
  const outputDir = path.resolve(outputRoot || './downloads', crypto.randomBytes(4).toString('hex'))
  await fsp.mkdir(outputDir, { recursive: true })
  try {
    const binaryPath = (await ensureYtDlpPythonRunner()) || await ensureYtDlpBinary()
    const template = path.join(outputDir, '%(title).180B.%(ext)s')
    const requestBest = String(targetQuality).trim().toLowerCase() === 'best'
    const quality = requestBest
      ? null
      : Math.max(144, Math.min(2160, Math.floor(Number(targetQuality) || 360)))
    // For "best", do not apply a 360p/2160p ceiling. Ask yt-dlp for the best
    // separate video and audio streams, sorting resolution first and FPS second.
    const format = requestBest
      ? 'bestvideo+bestaudio/best'
      : 'bestvideo[height<=' + quality + ']+bestaudio/best[height<=' + quality + ']/best'
    const isTikTok = /(^|\.)tiktok\.com$/i.test(new URL(normalizedUrl).hostname)
    const userAgentArgs = isTikTok ? [
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      '--referer', 'https://www.tiktok.com/'
    ] : []
    if (typeof onProgress === 'function') onProgress(0, requestBest ? 'yt-dlp memilih resolusi dan FPS tertinggi' : 'yt-dlp siap; mengambil metadata')
    const formatArgs = ['-f', format]
    if (requestBest) formatArgs.push('--format-sort', 'res,fps')
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
      ...formatArgs,
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
    const streamInfo = await inspectVideoStream(outputPath)
    const actualQuality = streamInfo?.height || quality || 'Auto'
    return {
      path: outputPath,
      outputDir,
      title,
      quality: actualQuality,
      fps: streamInfo?.fps || null,
      width: streamInfo?.width || null,
      downloader: 'yt-dlp'
    }
  } catch (error) {
    await cleanupDownload(outputDir)
    throw error
  }
}

export async function downloadYoutubeVideoBest(url, onProgress = null) {
  const normalizedUrl = normalizeYoutubeVideoUrl(url)
  let ytDlpError

  // Primary path: yt-dlp reads YouTube's available formats directly, including
  // high frame-rate DASH streams that the third-party info API may omit.
  try {
    const result = await downloadYoutubeVideoYtDlp(normalizedUrl, 'best', onProgress)
    console.log(
      '[YouTube] Kualitas tertinggi berhasil diambil dengan yt-dlp:',
      result.quality ? result.quality + 'p' : 'Auto',
      result.fps ? result.fps + ' FPS' : ''
    )
    return result
  } catch (error) {
    ytDlpError = error
    console.warn('[YouTube] yt-dlp kualitas tertinggi gagal; mencoba API cadangan:', error?.message || error)
  }

  const sessionId = crypto.randomBytes(4).toString('hex')
  const outputDir = path.resolve('./downloads', sessionId)

  try {
    const info = await getYoutubeInfo(normalizedUrl)
    const videoFormat = pickBestVideo(info)
    const audioFormat = pickBestAudio(info)
    const title = cleanName(info.title || 'media')
    const reportedQuality = getHeight(videoFormat) || 'Auto'

    const videoTemp = await downloadFormat(normalizedUrl, info, videoFormat, 'video-best-temp', outputDir)
    let audioTemp
    try {
      audioTemp = await downloadFormat(normalizedUrl, info, audioFormat, 'audio-best-temp', outputDir)
      const mp4Path = path.join(outputDir, `${title}-${reportedQuality}p.mp4`)
      await mergeVideoAudio(videoTemp, audioTemp, mp4Path)
      const streamInfo = await inspectVideoStream(mp4Path)
      await fsp.unlink(videoTemp).catch(() => {})
      await fsp.unlink(audioTemp).catch(() => {})

      return {
        path: mp4Path,
        outputDir,
        title: info.title,
        quality: streamInfo?.height || reportedQuality,
        fps: streamInfo?.fps || getFps(videoFormat) || null,
        width: streamInfo?.width || null,
        downloader: 'api-fallback',
        sourceAudioBitrate: getAudioBitrate(audioFormat) || null
      }
    } catch (error) {
      await fsp.unlink(videoTemp).catch(() => {})
      if (audioTemp) await fsp.unlink(audioTemp).catch(() => {})
      throw error
    }
  } catch (apiError) {
    await cleanupDownload(outputDir)
    throw new Error(
      'Gagal mengunduh kualitas tertinggi. yt-dlp: ' +
      String(ytDlpError?.message || ytDlpError || 'gagal').replace(/[\\r\\n]+/g, ' ').slice(0, 220) +
      ' | API cadangan: ' +
      String(apiError?.message || apiError).replace(/[\\r\\n]+/g, ' ').slice(0, 220)
    )
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
async function ensureYtDlpBinary(timeoutMs = 120000) {
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

  const response = await fetch(binaryUrl, timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {})
  if (!response.ok) throw new Error('Gagal mengunduh fallback yt-dlp resmi (HTTP ' + response.status + ').')
  const binary = Buffer.from(await response.arrayBuffer())
  if (binary.length < 1024 * 1024) throw new Error('File fallback yt-dlp terlalu kecil atau tidak valid.')

  const tempPath = binaryPath + '.tmp'
  await fsp.writeFile(tempPath, binary, { mode: 0o755 })
  await fsp.chmod(tempPath, 0o755)
  await fsp.rename(tempPath, binaryPath)
  return binaryPath
}

async function ensureYtDlpPythonRunner(timeoutMs = 120000) {
  // Prefer the official Python script to avoid PyInstaller's one-file extraction
  // error (e.g. Cryptodome/_ARC4.abi3.so decompression failure on constrained panels).
  const candidates = ['python3', 'python']
  for (const command of candidates) {
    try {
      await new Promise((resolvePromise, reject) => {
        const child = spawn(command, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
        const timer = timeoutMs > 0
          ? setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Python version check timed out')) }, timeoutMs)
          : null
        child.once('error', error => { if (timer) clearTimeout(timer); reject(error) })
        child.once('close', code => { if (timer) clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(command + ' unavailable')) })
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
          ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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

function runYtDlp(binaryPath, args, timeoutMs = 180000, onProgress = null, runOptions = {}) {
  return new Promise((resolve, reject) => {
    const command = typeof binaryPath === 'string' ? binaryPath : binaryPath.command
    const prefix = typeof binaryPath === 'string' ? [] : (binaryPath.prefix || [])
    const killTree = Boolean(runOptions?.killTree && process.platform !== 'win32')
    let child
    try {
      child = spawn(command, [...prefix, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: killTree
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let pendingStdout = ''
    let pendingStderr = ''
    let settled = false
    let idleTimer = null
    let totalTimer = null

    function terminateProcess() {
      // Retained for callers that explicitly opt into a timeout; .clip now runs without one.
      if (killTree && Number(child.pid) > 0) {
        try { process.kill(-child.pid, 'SIGKILL'); return } catch {}
      }
      try { child.kill('SIGKILL') } catch {}
    }
    function finish(error, result) {
      if (settled) return
      settled = true
      clearTimeout(totalTimer)
      clearTimeout(idleTimer)
      if (error) reject(error)
      else resolve(result)
    }
    function resetIdleTimeout() {
      clearTimeout(idleTimer)
      const idleMs = Number(runOptions?.idleTimeoutMs || 0)
      if (!(idleMs > 0) || settled) return
      idleTimer = setTimeout(() => {
        terminateProcess()
        finish(new Error('yt-dlp tidak memberi respons selama ' +
          Math.ceil(idleMs / 1000) + ' detik; mencoba metode cadangan.'))
      }, idleMs)
    }

    const consumeProgress = (chunk, channel = 'stderr') => {
      const pendingText = (channel === 'stdout' ? pendingStdout : pendingStderr) + chunk.toString()
      const lines = pendingText.split(/[\r\n]+/)
      const tail = lines.pop() || ''
      if (channel === 'stdout') pendingStdout = tail
      else pendingStderr = tail
      for (const line of lines) {
        const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
        if (match && typeof onProgress === 'function') {
          try { onProgress(Number(match[1]), line.trim()) } catch {}
        }
      }
    }
    if (timeoutMs > 0) {
      totalTimer = setTimeout(() => {
        terminateProcess()
        finish(new Error('yt-dlp mencapai batas waktu ' +
          Math.ceil(timeoutMs / 60000) + ' menit; mencoba metode berikutnya.'))
      }, timeoutMs)
    }
    resetIdleTimeout()

    child.stdout?.on('data', chunk => {
      resetIdleTimeout()
      const value = chunk.toString()
      stdout = (stdout + value).slice(-2000000)
      if (typeof onProgress === 'function') consumeProgress(value, 'stdout')
    })
    child.stderr?.on('data', chunk => {
      resetIdleTimeout()
      const data = chunk.toString()
      stderr = (stderr + data).slice(-12000)
      consumeProgress(data, 'stderr')
    })
    child.once('error', error => finish(error))
    child.once('close', code => {
      if (settled) return
      if (pendingStdout) consumeProgress('\n', 'stdout')
      if (pendingStderr) consumeProgress('\n', 'stderr')
      if (code === 0) finish(null, { stdout: stdout.trim(), stderr: stderr.trim() })
      else finish(new Error('yt-dlp gagal code ' + code + ': ' + (stderr || stdout).slice(-1200)))
    })
  })
}
async function runYtDlpWithEjsFallback(runner, args, timeoutMs = 0, onProgress = null) {
  try {
    return await runYtDlp(runner, args, timeoutMs, onProgress)
  } catch (error) {
    if (isYoutubeVerificationError(error)) throw error
    const remoteIndex = args.indexOf('--remote-components')
    if (remoteIndex < 0 || args[remoteIndex + 1] !== 'ejs:github') throw error
    const fallbackArgs = args.slice()
    fallbackArgs.splice(remoteIndex, 2)
    console.warn('[YouTube Clip] EJS GitHub tidak tersedia saat download; mencoba format yang masih dapat diakses tanpa EJS:', error?.message || error)
    return runYtDlp(runner, fallbackArgs, timeoutMs, onProgress)
  }
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


/**
 * Download only a requested YouTube time range with yt-dlp + FFmpeg.
 * The output directory is isolated per request and is removed by the caller.
 */
function getYtDlpOutputPath(stdout, label) {
  const outputPath = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1)
  if (!outputPath || !path.isAbsolute(outputPath)) {
    throw new Error(label + ' tidak mengembalikan lokasi file hasil.')
  }
  return outputPath
}

function runClipFfmpeg(args, timeoutMs = 0, onProgress = null, durationSeconds = 0) {
  return new Promise((resolve, reject) => {
    const captureProgress = typeof onProgress === 'function'
    const ffmpegArgs = [
      '-hide_banner', '-loglevel', 'error',
      '-filter_threads', '2',
      ...(captureProgress ? ['-progress', 'pipe:1', '-nostats'] : []),
      ...args.slice(0, -1),
      // Cap local clip encoding on shared hosting; no change to other FFmpeg users.
      '-threads', '2', args.at(-1)
    ]
    const child = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', captureProgress ? 'pipe' : 'ignore', 'pipe']
    })
    let stderr = ''
    let pending = ''
    let latestSpeed = ''
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const report = (percent, detail) => {
      try { onProgress?.(percent, detail) } catch {}
    }
    const parseProgress = chunk => {
      pending += chunk.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() || ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (line.startsWith('speed=')) latestSpeed = line.slice(6)
        if (line.startsWith('out_time=')) {
          const value = line.slice(9)
          const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
          if (!match) continue
          const currentSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
          const percent = Number(durationSeconds) > 0 ? Math.min(99, Math.max(0, currentSeconds / Number(durationSeconds) * 100)) : null
          report(percent, '[ffmpeg] ' + (percent === null ? 'encoding' : percent.toFixed(1) + '%') +
            ' | time=' + value + (latestSpeed ? ' | speed=' + latestSpeed : ''))
        } else if (line === 'progress=end') {
          report(100, '[ffmpeg] encoding selesai')
        }
      }
    }
    const timer = timeoutMs > 0 ? setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(reject, new Error('FFmpeg timeout setelah ' + Math.round(timeoutMs / 60000) + ' menit.'))
    }, timeoutMs) : null
    if (captureProgress) child.stdout.on('data', parseProgress)
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000) })
    child.once('error', error => finish(reject, error))
    child.once('close', code => {
      if (code === 0) finish(resolve)
      else finish(reject, new Error('FFmpeg gagal code ' + code + ': ' + (stderr.trim() || 'tidak ada detail error').slice(-1200)))
    })
  })
}

async function assertClipHasVisibleVideo(filePath, durationSeconds) {
  const duration = Number(durationSeconds)
  if (!Number.isFinite(duration) || duration < 0.25) return

  // Reject a file that has an MP4 container/audio track but only black frames.
  // Requiring 90% of the requested clip to be black avoids rejecting ordinary
  // black intros/outros or a short dark scene.
  const blackThreshold = Math.max(0.2, duration * 0.9)
  await new Promise((resolve, reject) => {
    let stderr = ''
    const child = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'info',
      '-i', filePath,
      '-vf', 'blackdetect=d=' + blackThreshold.toFixed(3) + ':pix_th=0.10:pic_th=0.98',
      '-an',
      '-f', 'null',
      '-'
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000) })
    child.once('error', reject)
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error('FFmpeg gagal memvalidasi gambar video: ' + stderr.trim().slice(-700)))
        return
      }
      const blackDurations = [...stderr.matchAll(/black_duration:([0-9.]+)/g)]
        .map(match => Number(match[1]))
        .filter(Number.isFinite)
      if (blackDurations.some(value => value >= blackThreshold * 0.98)) {
        reject(new Error('Stream video hampir seluruhnya hitam; hasil ditolak dan metode berikutnya akan dicoba.'))
        return
      }
      resolve()
    })
  })
}

async function inspectClipOutput(outputPath, durationSeconds) {
  const stat = await fsp.stat(outputPath)
  const detected = await fileTypeFromFile(outputPath)
  if (!stat.size || !detected?.mime?.startsWith('video/')) {
    throw new Error('Hasil potongan bukan file video yang valid.')
  }
  const streamInfo = await inspectVideoStream(outputPath)
  if (!streamInfo?.width || !streamInfo?.height) {
    throw new Error('Hasil potongan tidak memiliki track video/gambar yang valid; file audio-only ditolak.')
  }
  await assertClipHasVisibleVideo(outputPath, durationSeconds)
  const measuredBitrate = durationSeconds > 0 ? Math.round(stat.size * 8 / durationSeconds / 1000) : 0
  return {
    size: stat.size,
    quality: streamInfo?.height || null,
    width: streamInfo?.width || null,
    fps: streamInfo?.fps || null,
    bitrate: streamInfo?.bitrate || measuredBitrate,
    codec: streamInfo?.codec || null,
    pixelFormat: streamInfo?.pixelFormat || null
  }
}

async function fitClipForWhatsApp(inputPath, outputDir, durationSeconds, maxBytes, onProgress = null) {
  try { onProgress?.(null, '[quality] Memeriksa ukuran, durasi, dan resolusi hasil clip.') } catch {}
  const original = await inspectClipOutput(inputPath, durationSeconds)
  if (!(maxBytes > 0) || original.size <= maxBytes) {
    try { onProgress?.(null, '[quality] File asli dipertahankan: ' + (original.size / 1024 / 1024).toFixed(1) + ' MB, tidak perlu encode ulang.') } catch {}
    return { path: inputPath, ...original, transcoded: false }
  }
  try { onProgress?.(null, '[quality] Ukuran ' + (original.size / 1024 / 1024).toFixed(1) + ' MB melebihi batas; mulai kompresi adaptif.') } catch {}

  const sourceHeight = Number(original.quality || 0)
  const audioKbps = durationSeconds >= 600 ? 48 : durationSeconds >= 180 ? 80 : 112
  const availableKbps = Math.floor((maxBytes * 8 / durationSeconds / 1000) * 0.78)
  const initialVideoKbps = Math.max(96, availableKbps - audioKbps)
  const retryRates = [...new Set([
    initialVideoKbps,
    Math.floor(initialVideoKbps * 0.85),
    Math.floor(initialVideoKbps * 0.70),
    Math.floor(initialVideoKbps * 0.55)
  ].filter(rate => rate >= 80))]

  const outputPath = path.join(outputDir, 'alvareth-clip-whatsapp.mp4')
  let lastSize = original.size

  for (let index = 0; index < retryRates.length; index++) {
    const videoKbps = retryRates[index]
    const targetHeight = videoKbps >= 4500 ? 1440
      : videoKbps >= 2200 ? 1080
        : videoKbps >= 1000 ? 720
          : videoKbps >= 550 ? 480
            : videoKbps >= 300 ? 360 : 240
    const effectiveHeight = sourceHeight > 0
      ? Math.min(sourceHeight, targetHeight)
      : targetHeight
    const scaleFilter = sourceHeight > effectiveHeight
      ? 'scale=-2:' + effectiveHeight + ':force_original_aspect_ratio=decrease,'
      : ''
    const audioRate = durationSeconds >= 600 ? 48 : durationSeconds >= 180 ? 80 : 112

    try { onProgress?.(null, '[quality] Percobaan kompresi ' + (index + 1) + '/' + retryRates.length + ': target ' + effectiveHeight + 'p.') } catch {}
    console.log(
      '[YouTube Clip] Optimasi ukuran ' + (index + 1) + '/' + retryRates.length +
      ': target ' + effectiveHeight + 'p, video ' + videoKbps + ' kbps.'
    )

    await fsp.unlink(outputPath).catch(() => {})
    await runClipFfmpeg([
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-sn',
      '-dn',
      '-t', String(durationSeconds),
      '-vf', scaleFilter + 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', videoKbps + 'k',
      '-maxrate', videoKbps + 'k',
      '-bufsize', Math.max(videoKbps * 2, 256) + 'k',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', audioRate + 'k',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath
    ], 0, onProgress, durationSeconds)

    const optimized = await inspectClipOutput(outputPath, durationSeconds)
    lastSize = optimized.size
    if (optimized.size <= maxBytes) {
      try { onProgress?.(100, '[quality] Optimasi selesai: ' + effectiveHeight + 'p, ' + (optimized.size / 1024 / 1024).toFixed(1) + ' MB.') } catch {}
      await fsp.unlink(inputPath).catch(() => {})
      return { path: outputPath, ...optimized, transcoded: true }
    }
  }

  await fsp.unlink(outputPath).catch(() => {})
  throw new Error(
    'Video sumber berhasil diambil, tetapi hasil tetap melebihi batas kirim WhatsApp ' +
    Math.round(maxBytes / 1024 / 1024) + ' MB setelah optimasi bertahap. Ukuran terakhir: ' +
    (lastSize / 1024 / 1024).toFixed(1) + ' MB.'
  )
}

function compareClipCandidates(a, b) {
  const metrics = candidate => {
    const width = Number(candidate.width || 0)
    const height = Number(candidate.quality || 0)
    return [
      width * height,
      height,
      width,
      Number(candidate.fps || 0),
      Number(candidate.bitrate || 0),
      Number(candidate.size || 0)
    ]
  }
  const left = metrics(a)
  const right = metrics(b)
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return right[index] - left[index]
  }
  return Number(a.methodIndex || 0) - Number(b.methodIndex || 0)
}

function safeClipError(error) {
  return String(error?.message || error || 'Kesalahan tidak diketahui')
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => {
      try {
        const url = new URL(value)
        url.search = ''
        url.hash = ''
        return url.toString()
      } catch {
        return '[URL disamarkan]'
      }
    })
    .replace(/\s+/g, ' ')
    .slice(0, 320)
}

async function downloadValidatedClipFormat(runner, url, outputDir, methodLabel, selection, buildArgs, finalize, onProgress = null, duration = 0) {
  const attemptedErrors = []
  const rankedCandidates = selection.attempts || [selection]
  const preferred = rankedCandidates[0]
  const candidates = preferred
    ? [preferred, ...rankedCandidates.slice(1)
      .filter(candidate =>
        getWidth(candidate.video) === getWidth(preferred.video) &&
        getHeight(candidate.video) === getHeight(preferred.video)
      ).slice(0, 1)]
    : []
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    const video = candidate.video
    const label = methodLabel + ' / format ' + candidate.selector + ' (' +
      getWidth(video) + 'x' + getHeight(video) + ' ' + String(video.protocol || '') + ')'
    try {
      try {
        onProgress?.(null, '[quality] Mencoba ' + (index + 1) + '/' + candidates.length +
          ' — ' + label)
      } catch {}
      const args = buildArgs(candidate)
      const { stdout } = await runYtDlpWithEjsFallback(runner, args, 0, onProgress)
      const inputPath = getYtDlpOutputPath(stdout, label)
      const sourceStream = await inspectVideoStream(inputPath)
      if (!sourceStream?.width || !sourceStream?.height) {
        throw new Error('File dari yt-dlp tidak memiliki stream gambar. Metadata mengiklankan ' +
          getHeight(video) + 'p, tetapi file yang diunduh hanya audio/tidak memiliki video.')
      }
      // Some YouTube formats are advertised as 1080p but their extracted
      // transport contains a different stream. Never accept this silently.
      if (sourceStream.height < getHeight(video) * 0.90) {
        throw new Error('Kualitas stream aktual ' + sourceStream.height + 'p, berbeda dari ' +
          getHeight(video) + 'p yang dijanjikan sumber.')
      }
      console.log('[YouTube Clip] Stream video sumber VALID: ' + label +
        ' -> ' + sourceStream.width + 'x' + sourceStream.height +
        ', ' + (sourceStream.fps || '?') + ' FPS.')
      const finalized = await finalize(inputPath, candidate)
      const finalPath = finalized?.path || inputPath
      const actual = await inspectVideoStream(finalPath)
      if (!actual?.width || !actual?.height) {
        throw new Error('FFmpeg menghasilkan file tanpa track video; mencoba format alternatif.')
      }
      if (actual.height < sourceStream.height * 0.90) {
        throw new Error('Resolusi turun dari ' + sourceStream.height + 'p ke ' +
          actual.height + 'p setelah FFmpeg; mencoba format lain.')
      }
      // Validate decoded frames too; a nominal video track may contain black
      // content only (common with broken HLS or incomplete seek downloads).
      await assertClipHasVisibleVideo(finalPath, duration)
      console.log('[YouTube Clip] Format berhasil dan gambar terverifikasi: ' + label +
        ' => ' + actual.width + 'x' + actual.height + '.')
      return { path: finalPath, sourceHeight: sourceStream.height, formatId: candidate.selector }
    } catch (error) {
      const detail = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 350)
      attemptedErrors.push(label + ': ' + detail)
      console.warn('[YouTube Clip] Format gagal, mencoba kualitas/codec lain: ' + label + ': ' + detail)
      try { onProgress?.(null, '[fallback] ' + label + ' gagal: ' + detail) } catch {}
      // Clear partial HLS/audio-only files before trying another format ID.
      // This directory is private to this method; never remove a shared cache.
      await fsp.rm(outputDir, { recursive: true, force: true }).catch(() => {})
      await fsp.mkdir(outputDir, { recursive: true })
    }
  }
  throw new Error(methodLabel + ': tidak ada format video yang benar-benar dapat dipotong. ' +
    attemptedErrors.slice(0, 8).join(' | '))
}

/**
 * Download a YouTube time range through ordered strategies.
 * Third-party projects are adapted as methods, not launched as separate apps:
 * they share yt-dlp/FFmpeg and are not independent extraction providers.
 */
export async function downloadYoutubeClip(url, startSeconds, endSeconds, options = {}) {
  const normalizedUrl = normalizeYoutubeVideoUrl(url)
  let parsedUrl
  try {
    parsedUrl = new URL(normalizedUrl)
  } catch {
    throw new Error('URL YouTube tidak valid.')
  }
  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '')
  if (!(host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com'))) {
    throw new Error('Sumber harus berupa URL YouTube atau youtu.be.')
  }

  const start = Number(startSeconds)
  const end = Number(endSeconds)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('Rentang waktu tidak valid. Waktu akhir harus lebih besar dari waktu awal.')
  }
  try { options?.onProgress?.(null, '[stage] Memeriksa metadata seluruh kualitas YouTube sebelum mengunduh.') } catch {}
  const outputRoot = path.resolve(String(options?.outputRoot || './downloads/clip'))
  const maxOutputBytes = Number(options?.maxOutputBytes || 0)
  const duration = end - start
  const startText = start.toFixed(3).replace(/\.?0+$/, '')
  const durationText = duration.toFixed(3).replace(/\.?0+$/, '')
  const section = '*' + startText + '-' + end.toFixed(3).replace(/\.?0+$/, '')
  const qbyteMaxBytes = Number(process.env.ALVARETH_CLIP_QBYTE_MAX_SOURCE_BYTES || 256 * 1024 * 1024)
  await fsp.mkdir(outputRoot, { recursive: true })

  let runnerPromise
  const getRunner = () => {
    if (!runnerPromise) {
      runnerPromise = (async () => (await ensureYtDlpPythonRunner(0)) || await ensureYtDlpBinary(0))()
    }
    return runnerPromise
  }

  // Metadata-only inventory: inspect the available player profiles and all
  // advertised resolutions first, then download just the top-ranked stream.
  let sharedSelectionPromise = null
  const getSharedSelection = (runner, label) => {
    if (!sharedSelectionPromise) {
      sharedSelectionPromise = probeYtDlpFormats(runner, normalizedUrl, label, options?.onProgress)
    }
    return sharedSelectionPromise
  }

  let ytDlpTopHeight = 0
  let qbyteTopHeight = 0
  let youtubeAccessError = null
  const failures = []

  const strategies = [
    {
      id: 'yt-dlp-best-quality',
      label: 'yt-dlp kualitas tertinggi',
      run: async outputDir => {
        const runner = await getRunner()
        const selection = await getSharedSelection(runner, 'yt-dlp metadata')
        ytDlpTopHeight = Number(selection.topHeight || 0)
        const best = selection.attempts?.[0] || selection
        try {
          options?.onProgress?.(null, '[quality] Resolusi tersedia: ' +
            (selection.availableQualities || []).map(item => item.resolution).join(', ') +
            '. Dipilih ' + getWidth(best.video) + 'x' + getHeight(best.video) + '.')
        } catch {}
        console.log('[YouTube Clip] Mengunduh satu kualitas tertinggi: ' + best.selector +
          ' (' + getWidth(best.video) + 'x' + getHeight(best.video) + ').')

        return downloadValidatedClipFormat(
          runner, normalizedUrl, outputDir, 'yt-dlp kualitas tertinggi', selection,
          candidate => [
            '--newline', '--no-playlist', '--no-warnings', '--no-part',
            '--js-runtimes', 'node',
            ...getClipCookiesArgs(),
            '--remote-components', 'ejs:github',
            ...candidate.extractorArgs,
            '--retries', '4', '--fragment-retries', '4',
            '--download-sections', section,
            '--format', candidate.selector,
            '--merge-output-format', 'mkv',
            '--print', 'after_move:filepath',
            '-o', path.join(outputDir, 'best-%(id)s-%(format_id)s.%(ext)s'),
            normalizedUrl
          ],
          async (inputPath, candidate) => {
            const outputPath = path.join(outputDir, 'alvareth-clip-best.mp4')
            const videoCodec = String(candidate.video?.vcodec || '').toLowerCase()
            const audioCodec = String(candidate.audio?.acodec || candidate.video?.acodec || '').toLowerCase()
            const width = getWidth(candidate.video)
            const height = getHeight(candidate.video)
            const canCopyVideo = /^(avc1|h264|avc)/.test(videoCodec) && width % 2 === 0 && height % 2 === 0
            const canCopyAudio = /^(mp4a|aac)/.test(audioCodec)
            const ffmpegArgs = [
              '-y', '-i', inputPath,
              '-map', '0:v:0', '-map', '0:a:0?',
              '-sn', '-dn',
              '-t', durationText
            ]
            if (canCopyVideo) {
              ffmpegArgs.push('-c:v', 'copy')
            } else {
              ffmpegArgs.push(
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
                '-pix_fmt', 'yuv420p'
              )
            }
            if (canCopyAudio) ffmpegArgs.push('-c:a', 'copy')
            else ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k')
            ffmpegArgs.push('-movflags', '+faststart', outputPath)

            console.log('[YouTube Clip] Finalisasi terpilih: video ' +
              (canCopyVideo ? 'stream-copy' : 'H.264 encode') + ', audio ' +
              (canCopyAudio ? 'stream-copy' : 'AAC encode') + '.')
            await runClipFfmpeg(ffmpegArgs, 0, options?.onProgress, duration)
            await fsp.unlink(inputPath).catch(() => {})
            return { path: outputPath }
          },
          options?.onProgress,
          duration
        )
      }
    },
    {
      id: 'qbyte-api-fallback',
      label: 'API cadangan Qbyte (hanya jika yt-dlp gagal)',
      run: async outputDir => {
        try { options?.onProgress?.(null, '[qbyte] yt-dlp gagal; memeriksa metadata API cadangan tanpa mengunduh.') } catch {}
        const info = await getClipYoutubeInfo(normalizedUrl, options?.onProgress)
        const videoFormats = getVideoFormats(info)
        const audioFormats = getAudioFormats(info)
        const videoFormat = pickBestVideo(info)
        const audioFormat = pickBestAudio(info)
        qbyteTopHeight = getHeight(videoFormat)
        const estimatedVideoBytes = Number(videoFormat.filesize || videoFormat.filesize_approx || 0)
        const estimatedAudioBytes = Number(audioFormat.filesize || audioFormat.filesize_approx || 0)

        console.log('[YouTube Clip] Inventaris kualitas Qbyte (metadata saja): ' + JSON.stringify({
          jumlahVideo: videoFormats.length,
          jumlahAudio: audioFormats.length,
          resolusiTersedia: [...new Set(videoFormats.map(format =>
            getWidth(format) + 'x' + getHeight(format)
          ))],
          formatTerpilih: {
            video: { id: getId(videoFormat), width: getWidth(videoFormat), height: qbyteTopHeight, codec: videoFormat.vcodec, ext: videoFormat.ext, estimatedBytes: estimatedVideoBytes || null },
            audio: { id: getId(audioFormat), codec: audioFormat.acodec, ext: audioFormat.ext, estimatedBytes: estimatedAudioBytes || null }
          }
        }))

        // Do not spend hundreds of MB on a lower-resolution API stream when
        // yt-dlp already advertised a better source format.
        if (ytDlpTopHeight > 0 && qbyteTopHeight < ytDlpTopHeight * 0.90) {
          throw new Error('API cadangan hanya menyediakan ' + qbyteTopHeight +
            'p, sedangkan metadata YouTube sebelumnya menemukan ' + ytDlpTopHeight +
            'p. Download fallback yang lebih rendah dibatalkan.')
        }
        if (estimatedVideoBytes > qbyteMaxBytes || estimatedAudioBytes > qbyteMaxBytes) {
          throw new Error('Ukuran sumber API cadangan melebihi batas aman ' +
            Math.round(qbyteMaxBytes / 1024 / 1024) + ' MB per stream; download dibatalkan.')
        }

        const videoId = getId(videoFormat)
        const audioId = getId(audioFormat)
        try { options?.onProgress?.(null, '[qbyte] Mengunduh hanya format tertinggi ' + qbyteTopHeight + 'p / ID ' + videoId + '.') } catch {}
        const videoPath = await downloadFormat(
          normalizedUrl, info, videoFormat, 'clip-api-video', outputDir, qbyteMaxBytes,
          (percent, line) => { try { options?.onProgress?.(percent, '[qbyte] ' + line) } catch {} }, 0
        )
        const actualStream = await inspectVideoStream(videoPath)
        if (!actualStream?.height || actualStream.height < qbyteTopHeight * 0.90) {
          throw new Error('API mengiklankan ' + qbyteTopHeight +
            'p, tetapi stream video aktual tidak valid atau lebih rendah.')
        }
        console.log('[YouTube Clip] Qbyte format tertinggi tervalidasi: ' + videoId +
          ' -> ' + actualStream.width + 'x' + actualStream.height + '.')

        try { options?.onProgress?.(null, '[qbyte] Mengunduh satu stream audio terbaik, bukan mencoba semua format.') } catch {}
        const audioPath = await downloadFormat(
          normalizedUrl, info, audioFormat, 'clip-api-audio', outputDir, qbyteMaxBytes,
          (percent, line) => { try { options?.onProgress?.(percent, '[qbyte] ' + line) } catch {} }, 0
        )
        const audioStream = await inspectAudioStream(audioPath)
        if (!audioStream) throw new Error('Track audio API cadangan tidak dapat dibaca FFprobe.')

        const outputPath = path.join(outputDir, 'alvareth-clip-qbyte.mp4')
        const videoCodec = String(videoFormat.vcodec || '').toLowerCase()
        const audioCodec = String(audioFormat.acodec || '').toLowerCase()
        const canCopyVideo = /^(avc1|h264|avc)/.test(videoCodec) &&
          getWidth(videoFormat) % 2 === 0 && qbyteTopHeight % 2 === 0
        const canCopyAudio = /^(mp4a|aac)/.test(audioCodec)
        const ffmpegArgs = [
          '-y',
          '-ss', startText, '-i', videoPath,
          '-ss', startText, '-i', audioPath,
          '-t', durationText,
          '-map', '0:v:0', '-map', '1:a:0',
          '-sn', '-dn'
        ]
        if (canCopyVideo) ffmpegArgs.push('-c:v', 'copy')
        else ffmpegArgs.push(
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
          '-pix_fmt', 'yuv420p'
        )
        if (canCopyAudio) ffmpegArgs.push('-c:a', 'copy')
        else ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k')
        ffmpegArgs.push('-shortest', '-movflags', '+faststart', outputPath)
        await runClipFfmpeg(ffmpegArgs, 0, options?.onProgress, duration)
        await fsp.unlink(videoPath).catch(() => {})
        await fsp.unlink(audioPath).catch(() => {})
        await assertClipHasVisibleVideo(outputPath, duration)
        return { path: outputPath, sourceHeight: actualStream.height, formatId: videoId + '+' + audioId }
      }
    }
  ]

  for (let index = 0; index < strategies.length; index++) {
    const strategy = strategies[index]
    const outputDir = path.join(outputRoot, 'clip-' + strategy.id + '-' + crypto.randomBytes(4).toString('hex'))
    await fsp.mkdir(outputDir, { recursive: true })
    try {
      console.log('[YouTube Clip] Strategi ' + (index + 1) + '/' + strategies.length + ': ' + strategy.label)
      try {
        options?.onProgress?.(null, index === 0
          ? '[stage] Memindai kualitas melalui metadata; belum ada file video yang diunduh.'
          : '[fallback] Kualitas tertinggi yt-dlp gagal; mencoba API cadangan satu kali.')
      } catch {}

      const result = await strategy.run(outputDir)
      const fitted = await fitClipForWhatsApp(
        result.path, outputDir, duration, maxOutputBytes, options?.onProgress
      )
      const sourceMaxQuality = Math.max(ytDlpTopHeight, qbyteTopHeight)
      const candidate = {
        ...result,
        outputDir,
        size: fitted.size,
        quality: fitted.quality,
        width: fitted.width,
        fps: fitted.fps,
        bitrate: fitted.bitrate,
        codec: fitted.codec,
        pixelFormat: fitted.pixelFormat,
        path: fitted.path,
        sourceMaxQuality,
        qualityDowngraded: sourceMaxQuality > Number(fitted.quality || 0) * 1.10,
        downloader: strategy.label
      }
      console.log('[YouTube Clip] Satu hasil terpilih: ' + candidate.width + 'x' +
        candidate.quality + ', ' + (candidate.fps || '?') + ' FPS, ' +
        (candidate.size / 1024 / 1024).toFixed(1) + ' MB. Tidak ada kandidat metode lain yang diunduh.')
      try {
        options?.onProgress?.(100, 'Kualitas tertinggi berhasil diproses: ' +
          candidate.width + 'x' + candidate.quality + '.')
        options?.onProgress?.(null, '[stage] Kualitas tertinggi terpilih; tidak membandingkan hasil download lain.')
      } catch {}
      return { ...candidate, duration }
    } catch (error) {
      if (error?.code === 'YOUTUBE_AUTH_REQUIRED' ||
          error?.code === 'YOUTUBE_COOKIES_INVALID' ||
          isYoutubeVerificationError(error)) {
        youtubeAccessError = error?.code === 'YOUTUBE_COOKIES_INVALID'
          ? 'YOUTUBE_COOKIES_INVALID'
          : 'YOUTUBE_AUTH_REQUIRED'
      }
      const detail = safeClipError(error)
      failures.push({ label: strategy.label, detail })
      console.warn('[YouTube Clip] Strategi gagal (' + strategy.label + '): ' + detail)
      await cleanupDownload(outputDir)
      if (index < strategies.length - 1) {
        try {
          options?.onProgress?.(null, '[fallback] Format tertinggi yt-dlp gagal; hanya satu API cadangan akan diperiksa.')
        } catch {}
      }
    }
  }

  if (youtubeAccessError) {
    const reason = youtubeAccessError === 'YOUTUBE_COOKIES_INVALID'
      ? 'File cookies YouTube server tidak tersedia, kosong, atau tidak dapat dibaca.'
      : 'YouTube menolak akses yt-dlp dan meminta verifikasi akun.'
    const fallback = failures.find(item => item.label.includes('Qbyte'))
    const message = reason + (fallback ? ' API cadangan juga gagal: ' + fallback.detail : '')
    const accessError = new Error(message)
    accessError.code = youtubeAccessError
    throw accessError
  }

  const allFailedError = new Error(
    'Kualitas tertinggi YouTube Clip gagal diproses; sistem tidak mengunduh semua kualitas atau mengulang lima metode.\\n' +
    failures.map((failure, index) =>
      (index + 1) + '. ' + failure.label + ': ' + failure.detail
    ).join('\\n')
  )
  allFailedError.code = 'YOUTUBE_CLIP_ALL_METHODS_FAILED'
  throw allFailedError
}
