import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createClipProgress } from './clip-progress.js'
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
  // Every response is a plain WhatsApp message without a GitHub link preview.
  const say = message => conn.sendMessage(m.chat, { text: message })
  const request = extractRequest(text)
  if (!request) {
    return say(
      '*✂️ YOUTUBE CLIPPER*\n\n' +
      'Format:\n.clip URL waktu_mulai waktu_akhir\n\n' +
      'Contoh:\n.clip https://youtu.be/VIDEO_ID 25:00 27:00\n\n' +
      'Waktu: MM:SS atau HH:MM:SS. Durasi maksimal 15 menit.'
    )
  }

  const { url, start, end } = request
  if (end <= start) return say('Waktu akhir harus lebih besar daripada waktu mulai.')
  if (end - start > MAX_CLIP_SECONDS) return say('Durasi clip maksimal 15 menit per permintaan.')

  const startedAt = Date.now()
  const jobId = randomUUID().slice(0, 8)
  const range = formatTimestamp(start) + ' – ' + formatTimestamp(end)
  const progress = createClipProgress({ jobId, range, startedAt })
  const reportProgress = (percent, detail) => progress.report(percent, detail)

  // Progress is written to the process terminal only; no WhatsApp status message is sent.
  progress.start()
  let outputDir = null
  try {
    const result = await downloadYoutubeClip(url, start, end, {
      outputRoot: './downloads/clip',
      maxOutputBytes: MAX_CLIP_BYTES,
      onProgress: reportProgress
    })
    outputDir = result.outputDir
    console.log('[CLIP:' + jobId + '] Hasil tervalidasi: ' + (result.size / 1024 / 1024).toFixed(1) + ' MB.')

    progress.stage('📂 Memeriksa file hasil')
    const stats = await fs.stat(result.path)
    if (!stats.isFile() || stats.size < 1) throw new Error('File hasil clip kosong atau tidak ditemukan.')
    if (stats.size > MAX_CLIP_BYTES) {
      throw new Error('Video ' + (stats.size / 1024 / 1024).toFixed(1) + ' MB melebihi batas 45 MB.')
    }

    const caption =
      '✅ *YouTube Clip berhasil dibuat!*\n' +
      '⏱️ ' + range + '\n' +
      '📦 ' + (stats.size / 1024 / 1024).toFixed(1) + ' MB' +
      (result.quality ? '\n🎞️ ' + result.quality + 'p' : '') +
      '\n⚙️ ' + String(result.downloader || 'yt-dlp + FFmpeg') +
      '\n⌛ ' + Math.ceil((Date.now() - startedAt) / 1000) + ' detik'
    const fileName = 'Alvareth-Clip-' +
      formatTimestamp(start).replace(/:/g, '-') + '-' +
      formatTimestamp(end).replace(/:/g, '-') + '.mp4'

    // Baileys can stream a local file path: less RAM than holding a 45MB Buffer.
    // If the fork cannot handle a path, use a Buffer as a one-time fallback.
    await progress.stage('📤 Mengirim video ke WhatsApp (persentase upload tidak tersedia)')
    const content = { video: { url: result.path }, mimetype: 'video/mp4', fileName, caption }
    try {
      await conn.sendMessage(m.chat, content)
    } catch (sendError) {
      console.warn('[CLIP:' + jobId + '] Pengiriman file path gagal, mencoba buffer:', sendError?.message || sendError)
      await progress.stage('📤 Mengirim video melalui buffer cadangan')
      const video = await fs.readFile(result.path)
      await conn.sendMessage(m.chat, { video, mimetype: 'video/mp4', fileName, caption })
    }

    progress.finish('success', 'Video berhasil dikirim. Silakan cek media di chat.')
    try { await m.react('✅') } catch {}
    console.log('[CLIP:' + jobId + '] Selesai; file telah dikirim ke WhatsApp.')
  } catch (error) {
    const detail = String(error?.message || error || 'Kesalahan tidak diketahui')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[tautan]')
      .slice(0, 1100)
    console.error('[CLIP:' + jobId + '] Gagal:', error?.stack || error)
    progress.finish('error', detail)
    await say('❌ YouTube Clip gagal dibuat. Detail proses tercatat di terminal.')
    try { await m.react('❌') } catch {}
  } finally {
    if (outputDir) {
      try {
        await cleanupDownload(outputDir)
        console.log('[CLIP:' + jobId + '] File sementara dibersihkan.')
      } catch (error) {
        console.warn('[CLIP:' + jobId + '] Cleanup gagal:', error?.message || error)
      }
    }
  }
}

handler.help = ['clip <url> <waktu_mulai> <waktu_akhir>']
handler.tags = ['downloader']
handler.command = /^clip$/i

export default handler
