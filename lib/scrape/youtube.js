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

export async function downloadYoutubeVideo(url, targetQuality = 720) {
  const sessionId = crypto.randomBytes(4).toString('hex')
  const outputDir = path.join('./downloads', sessionId)

  const info = await getYoutubeInfo(url)
  const videoFormat = pickVideo(info, targetQuality)
  const audioFormat = pickBestAudio(info)
  const title = cleanName(info.title || 'media')
  const quality = getHeight(videoFormat) || targetQuality

  const videoTemp = await downloadFormat(url, info, videoFormat, 'video-temp', outputDir)
  const audioTemp = await downloadFormat(url, info, audioFormat, 'audio-temp', outputDir)

  const mp4Path = path.join(outputDir, `${title}-${quality}p.mp4`)
  await mergeVideoAudio(videoTemp, audioTemp, mp4Path)

  await fsp.unlink(videoTemp).catch(() => {})
  await fsp.unlink(audioTemp).catch(() => {})

  return { path: mp4Path, outputDir, title: info.title, quality }
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