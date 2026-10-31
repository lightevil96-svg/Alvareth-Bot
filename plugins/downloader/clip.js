import fs from 'node:fs/promises'
import {
  downloadYoutubeClip,
  cleanupDownload
} from '../../lib/scrape/youtube.js'

const MAX_CLIP_BYTES = 45 * 1024 * 1024
const MAX_CLIP_SECONDS = 15 * 60

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

function extractRequest(input) {
  const source = String(input || '').trim()
  const urlMatch = source.match(/https?:\/\/[^\s<>"']+/i)
  if (!urlMatch) return null

  const url = urlMatch[0].replace(/[),\].!?;:]+$/g, '')
  const rest = source.replace(urlMatch[0], ' ').trim()
  const times = rest.split(/\s+/).filter(Boolean)
  if (times.length !== 2) return null

  const start = parseTimestamp(times[0])
  const end = parseTimestamp(times[1])
  if (start === null || end === null) return null
  return { url, start, end }
}

function formatTimestamp(totalSeconds) {
  const seconds = Math.floor(totalSeconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours
    ? [hours, String(minutes).padStart(2, '0'), String(remainder).padStart(2, '0')].join(':')
    : [minutes, String(remainder).padStart(2, '0')].join(':')
}

const handler = async (m, { conn, text }) => {
  const request = extractRequest(text)
  if (!request) {
    return m.reply(
      '*✂️ YOUTUBE CLIPPER*\n\n' +
      'Format:\n.clip URL waktu_mulai waktu_akhir\n\n' +
      'Contoh:\n.clip https://youtu.be/VIDEO_ID 25:00 27:00\n\n' +
      'Format waktu: MM:SS atau HH:MM:SS. Durasi clip maksimal 15 menit.'
    )
  }

  const { url, start, end } = request
  if (end <= start) return m.reply('Waktu akhir harus lebih besar daripada waktu mulai.')
  if (end - start > MAX_CLIP_SECONDS) {
    return m.reply('Durasi clip maksimal 15 menit per permintaan.')
  }

  let outputDir = null
  const startedAt = Date.now()
  await m.react('✂️').catch(() => {})
  await m.reply(
    '⏳ *Sedang membuat YouTube Clip*\n' +
    'Mulai: ' + formatTimestamp(start) + '\n' +
    'Akhir: ' + formatTimestamp(end) + '\n' +
    'Durasi: ' + Math.ceil(end - start) + ' detik\n' +
    'Bot hanya meminta rentang waktu tersebut, bukan mengunduh seluruh video.'
  )

  try {
    const result = await downloadYoutubeClip(url, start, end, {
      outputRoot: './downloads/clip',
      onProgress: (percent, detail) => {
        if (percent === 0 || percent === 100) {
          console.log('[CLIP] ' + percent + '% ' + String(detail || '').slice(0, 180))
        }
      }
    })
    outputDir = result.outputDir

    if (result.size > MAX_CLIP_BYTES) {
      throw new Error('Ukuran hasil ' + (result.size / 1024 / 1024).toFixed(1) + ' MB melebihi batas pengiriman video WhatsApp 45 MB.')
    }

    const video = await fs.readFile(result.path)
    if (!video.length) throw new Error('File clip kosong setelah diunduh.')

    await conn.sendMessage(m.chat, {
      video,
      mimetype: 'video/mp4',
      fileName: 'Alvareth-Clip-' + formatTimestamp(start).replace(/:/g, '-') + '-' + formatTimestamp(end).replace(/:/g, '-') + '.mp4',
      caption:
        '✅ *YouTube Clip berhasil dibuat!*\n' +
        '⏱️ ' + formatTimestamp(start) + ' – ' + formatTimestamp(end) + '\n' +
        '📦 ' + (result.size / 1024 / 1024).toFixed(1) + ' MB' +
        (result.quality ? '\n🎞️ ' + result.quality + 'p' : '') +
        '\n⚙️ yt-dlp + FFmpeg' +
        '\n⏳ ' + Math.ceil((Date.now() - startedAt) / 1000) + ' detik'
    }, { quoted: m })

    await m.react('✅').catch(() => {})
    console.log('[CLIP] success start=' + start + ' end=' + end + ' bytes=' + result.size)
  } finally {
    if (outputDir) await cleanupDownload(outputDir)
  }
}

handler.help = ['clip <url> <waktu_mulai> <waktu_akhir>']
handler.tags = ['downloader']
handler.command = /^clip$/i

export default handler
