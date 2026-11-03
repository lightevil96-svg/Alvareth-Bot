import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClipProgress } from './clip-progress.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import {
  downloadYoutubeClip,
  cleanupDownload
} from '../../lib/scrape/youtube.js'


export function parseTimestamp(value) {
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
  const say = async message => {
    // A closed Baileys socket rejects sendMessage with 428 / Connection Closed.
    // Never let a secondary notification error hide the actual clip failure.
    if (conn?.ws?.readyState !== undefined && conn.ws.readyState !== 1) {
      console.warn('[CLIP] Pesan WhatsApp tidak dikirim karena socket tidak terbuka (readyState=' + conn.ws.readyState + ').')
      return null
    }
    try {
      return await conn.sendMessage(m.chat, { text: message })
    } catch (sendError) {
      console.error('[CLIP] Gagal mengirim pesan WhatsApp; detail utama tetap dicatat di terminal:', sendError?.stack || sendError)
      return null
    }
  }
  const request = extractRequest(text)
  if (!request) {
    return say(
      '*✂️ YOUTUBE CLIPPER*\n\n' +
      'Format:\n.clip URL waktu_mulai waktu_akhir\n\n' +
      'Contoh:\n.clip https://youtu.be/VIDEO_ID 25:00 27:00\n\n' +
      'Waktu: MM:SS atau HH:MM:SS. Tidak ada batas durasi dari bot.'
    )
  }

  const { url, start, end } = request
  if (end <= start) {
    return say(
      '❌ Rentang waktu tidak valid. Waktu akhir harus lebih besar daripada waktu mulai.\n\n' +
      'Bot membaca waktu mulai sebagai *' + formatTimestamp(start) + '* dan waktu akhir sebagai *' + formatTimestamp(end) + '*.' +
      '\nPeriksa penulisan timestamp. Gunakan HH:MM:SS untuk durasi lebih dari satu jam.\\n' +
      'Contoh: .clip URL 2:03:15 2:09:34'
    )
  }
  const startedAt = Date.now()
  const jobId = randomUUID().slice(0, 8)
  const range = formatTimestamp(start) + ' – ' + formatTimestamp(end)
  const progress = createClipProgress({ jobId, range, startedAt })
  const reportProgress = (percent, detail) => progress.report(percent, detail)

  // Progress is written to the process terminal only; no WhatsApp status message is sent.
  progress.start()
  let outputDir = null
  let savedPath = null
  let phase = 'download/crop'
  try {
    const downloadRoot = path.resolve(process.env.ALVARETH_DOWNLOAD_DIR || './downloads')
    const clipRoot = path.join(downloadRoot, 'clip')
    await fs.mkdir(clipRoot, { recursive: true })
    console.log('[CLIP:' + jobId + '] [stage] Download dimulai: ' + url.replace(/[?&](?:si|feature)=[^&]*/gi, ''))
    progress.stage('⬇️ Mengunduh dan memotong video dari YouTube')
    const result = await downloadYoutubeClip(url, start, end, {
      outputRoot: clipRoot,
      onProgress: reportProgress
    })
    outputDir = result.outputDir
    console.log('[CLIP:' + jobId + '] [stage] Download/crop selesai; hasil kandidat ' + (result.size / 1024 / 1024).toFixed(1) + ' MB.')
    phase = 'filesystem-validation'
    progress.stage('📂 Memvalidasi dan menyimpan file ke downloads/clip')
    const fileName = 'Alvareth-Clip-' +
      formatTimestamp(start).replace(/:/g, '-') + '-' +
      formatTimestamp(end).replace(/:/g, '-') + '-' + jobId + '.mp4'
    const destinationPath = path.join(clipRoot, fileName)
    await fs.rename(result.path, destinationPath)
    savedPath = destinationPath
    const stats = await fs.stat(savedPath)
    if (!stats.isFile() || stats.size < 1) throw new Error('File hasil clip kosong atau tidak ditemukan.')
    console.log('[CLIP:' + jobId + '] [stage] File tervalidasi: ' + savedPath + ' (' + (stats.size / 1024 / 1024).toFixed(1) + ' MB).')
    const configuredInlineLimit = Number(process.env.ALVARETH_WA_INLINE_VIDEO_MAX_BYTES)
    const inlineVideoLimit = Number.isSafeInteger(configuredInlineLimit) && configuredInlineLimit > 0
      ? configuredInlineLimit
      : 64 * 1024 * 1024
    const caption =
      '✅ *YouTube Clip berhasil dibuat!*\n' +
      '⏱️ ' + range + '\n' +
      '📦 ' + (stats.size / 1024 / 1024).toFixed(1) + ' MB' +
      (result.quality ? '\n🎞️ ' + result.quality + 'p' + (result.fps ? ' @ ' + result.fps + ' FPS' : '') : '') +
      (result.qualityDowngraded ? '\n⚠️ Format ' + result.sourceMaxQuality + 'p ditemukan, tetapi tidak berhasil diekstrak sebagai video valid. Ini kualitas terbaik yang berhasil diproses.' : '') +
      '\n⚙️ ' + String(result.downloader || 'yt-dlp + FFmpeg') +
      '\n⌛ ' + Math.ceil((Date.now() - startedAt) / 1000) + ' detik'
    // Large MP4 files are sent as documents from disk. This avoids the
    // inline-video endpoint for very large clips and preserves the best source
    // quality. Baileys streams the local path; the whole file is not read into RAM.
    phase = 'whatsapp-upload'
    await progress.stage('📤 Mengirim file ke WhatsApp melalui Baileys (upload disk-streaming)')
    const delivery = await sendLocalFile(conn, m.chat, savedPath, {
      jobId,
      mimetype: 'video/mp4',
      caption: stats.size > inlineVideoLimit
        ? caption + '\n📎 MP4 berukuran besar dikirim sebagai dokumen agar kualitas asli tetap terjaga.'
        : caption,
      seconds: result.duration,
      quoted: m
    })

    progress.finish('success',
      delivery.mediaType === 'document'
        ? 'MP4 berhasil dikirim sebagai dokumen. File asli tetap tersedia di downloads/clip.'
        : 'Video berhasil dikirim dan dapat diputar langsung di chat.')
    try { await m.react('✅') } catch {}
    console.log('[CLIP:' + jobId + '] [stage] WhatsApp upload berhasil; messageId=' +
      delivery.messageId + '; mediaType=' + delivery.mediaType + '; file=' + savedPath)
  } catch (error) {
    const detail = String(error?.message || error || 'Kesalahan tidak diketahui')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[tautan]')
      .slice(0, 1100)
    console.error('[CLIP:' + jobId + '] Gagal:', error?.stack || error)
    progress.finish('error', detail)
    const accessProblem = error?.code === 'YOUTUBE_AUTH_REQUIRED' || error?.code === 'YOUTUBE_COOKIES_INVALID'
    const savedStats = savedPath ? await fs.stat(savedPath).catch(() => null) : null
    const response = savedStats
      ? '⚠️ Clip berhasil dibuat dan disimpan, tetapi pengiriman WhatsApp gagal pada tahap ' +
        String(error?.stage || phase) + '.\n📁 File tetap tersimpan: downloads/clip/' + path.basename(savedPath) +
        '\n📦 ' + (savedStats.size / 1024 / 1024).toFixed(1) + ' MB' +
        '\nKetik .download untuk mencoba mengirim file tersebut lagi setelah memperbaiki koneksi/ruang sementara.\nDetail: ' + detail
      : accessProblem
        ? (error.code === 'YOUTUBE_COOKIES_INVALID'
          ? '❌ File autentikasi YouTube di server tidak dapat dibaca. Periksa YTDLP_COOKIES_FILE pada pengaturan server TokoPanel, lalu restart bot. Jangan mengirim cookies melalui chat.'
          : '❌ YouTube meminta verifikasi akun dan menolak akses downloader dari server. API cadangan juga tidak berhasil. Atur file cookies dari akun YouTube milikmu sendiri secara privat di TokoPanel (YTDLP_COOKIES_FILE), lalu coba lagi. Jangan mengirim cookies melalui WhatsApp atau GitHub.')
        : '❌ YouTube Clip gagal pada tahap ' + String(error?.stage || phase) + '. Detail: ' + detail
    await say(response)
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
