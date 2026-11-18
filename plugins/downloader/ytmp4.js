import fs from 'node:fs/promises'
import yts from 'yt-search'
import {
  downloadYoutubeVideo,
  downloadYoutubeVideoBest,
  renderYoutubeVideoForWhatsApp,
  cleanupDownload
} from '../../lib/scrape/youtube.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'

const ALLOWED_QUALITIES = new Set([144, 240, 360, 480, 720, 1080, 1440, 2160])

function cleanFilename(value) {
  return String(value || 'video')
    .replace(/[\\\\/:*?"<>|]/g, '')
    .replace(/[\\r\\n]+/g, ' ')
    .trim()
    .slice(0, 160) || 'video'
}

async function resolveYoutubeUrl(query) {
  if (/^https?:\\/\\//i.test(query)) return query
  const search = await yts(query)
  const video = search.videos?.[0]
  if (!video?.url) throw new Error('Video tidak ditemukan.')
  return video.url
}

async function sendQualityMenu(m, conn, url, usedPrefix, command) {
  const prefix = usedPrefix || '.'
  const commandName = command || 'ytmp4'
  const bestId = `${prefix}${commandName} ${url}|best`
  const economyId = `${prefix}${commandName} ${url}|360`
  const menu = await conn.sendMessage(m.chat, {
    text: [
      '🎬 *PILIH KUALITAS VIDEO*',
      '',
      '✨ Kualitas tertinggi: resolusi maksimum yang tersedia (HD/4K jika tersedia).',
      '📦 Hemat data: target 360p.',
      '',
      '⚙️ Semua hasil dirender ulang menjadi MP4 H.264 + AAC agar kompatibel dengan pemutar WhatsApp.'
    ].join('\\n'),
    footer: 'Alvareth Bot • YouTube Downloader',
    optionText: 'Pilih Kualitas',
    optionTitle: 'Kualitas Video',
    nativeFlow: [{
      text: 'Pilih kualitas video',
      sections: [{
        title: '🎬 VIDEO MP4',
        rows: [
          {
            title: '✨ Kualitas Tertinggi (HD)',
            description: 'Resolusi maksimum yang tersedia • H.264/AAC',
            id: bestId
          },
          {
            title: '📦 Hemat Data (360p)',
            description: 'Lebih ringan untuk kuota • H.264/AAC',
            id: economyId
          }
        ]
      }]
    }],
    interactiveAsTemplate: false
  }, { quoted: m, noAlvarethPreview: true })

  if (!menu?.key?.id) throw new Error('WhatsApp tidak mengembalikan ID menu kualitas.')
  return menu
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const rawInput = String(text || '').trim()
  if (!rawInput) {
    throw `Contoh:
${usedPrefix || '.'}${command} https://youtu.be/dQw4w9WgXcQ
${usedPrefix || '.'}${command} https://youtu.be/dQw4w9WgXcQ|best
${usedPrefix || '.'}${command} https://youtu.be/dQw4w9WgXcQ|360

Tanpa pilihan kualitas, bot menampilkan tombol kualitas tertinggi dan hemat data.`
  }

  const separator = rawInput.indexOf('|')
  const query = String(separator >= 0 ? rawInput.slice(0, separator) : rawInput).trim()
  const qualityToken = String(separator >= 0 ? rawInput.slice(separator + 1) : '').trim().toLowerCase()
  const hasExplicitQuality = separator >= 0
  const useBest = ['best', 'max', 'highest', 'hd'].includes(qualityToken)
  const numericQuality = Number(qualityToken || '360')
  const targetQuality = ALLOWED_QUALITIES.has(numericQuality) ? numericQuality : 360
  if (!query) throw new Error('Judul video atau URL YouTube tidak boleh kosong.')
  if (hasExplicitQuality && !useBest && !ALLOWED_QUALITIES.has(numericQuality)) {
    throw new Error('Kualitas tidak dikenal. Gunakan |best atau resolusi 144, 240, 360, 480, 720, 1080, 1440, atau 2160.')
  }

  let result
  let videoSent = false

  try {
    const url = await resolveYoutubeUrl(query)

    // A plain .ytmp4 request opens the quality picker. Interactive selections
    // call this same command with |best or |360 and continue to the downloader.
    if (!hasExplicitQuality) {
      await sendQualityMenu(m, conn, url, usedPrefix, command)
      await m.react('🎚️').catch(() => {})
      return
    }

    await m.react('🕒').catch(() => {})
    result = useBest
      ? await downloadYoutubeVideoBest(url)
      : await downloadYoutubeVideo(url, targetQuality)

    // Always transcode the selected source before WhatsApp upload. This removes
    // unsupported VP9/AV1 streams and prevents large files becoming documents.
    result = await renderYoutubeVideoForWhatsApp(result)
    const stats = await fs.stat(result.path)
    if (!stats.isFile() || stats.size <= 0) throw new Error('File video hasil render kosong.')

    const actualQuality = result.quality || (useBest ? 'Auto' : targetQuality)
    const qualityLabel = typeof actualQuality === 'number' && actualQuality > 0
      ? actualQuality + 'p'
      : String(actualQuality)
    const caption = [
      '🎬 *' + cleanFilename(result.title || 'Video YouTube') + '*',
      '📺 Kualitas: ' + qualityLabel,
      result.fps ? '🎞️ Frame rate: ' + result.fps + ' FPS' : '',
      useBest ? '✨ Mode: kualitas tertinggi yang tersedia' : '📦 Mode: hemat data',
      result.downloader === 'api-fallback' ? '📡 Sumber: API cadangan' : '',
      '⚙️ Render: H.264 + AAC',
      '📁 Format: MP4 kompatibel WhatsApp'
    ].filter(Boolean).join('\\n')

    const qualitySuffix = typeof actualQuality === 'number' && actualQuality > 0
      ? '-' + actualQuality + 'p'
      : ''
    const fileName = cleanFilename(result.title) + qualitySuffix + '.mp4'
    const delivery = await sendLocalFile(conn, m.chat, result.path, {
      jobId: String(m.key?.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24),
      mimetype: 'video/mp4',
      fileName,
      caption,
      seconds: result.duration,
      quoted: m
    })

    if (!delivery?.messageId) throw new Error('WhatsApp tidak mengonfirmasi pengiriman video.')
    videoSent = true
    await m.react('✅').catch(() => {})
    console.log('[YTMP4] Video kompatibel WhatsApp terkirim ke', m.chat,
      '| kualitas', actualQuality, '| best=', useBest, '| codec H.264/AAC')
  } catch (error) {
    console.error('[YTMP4]', error?.stack || error)
    if (!videoSent) {
      await m.react('❌').catch(() => {})
      await conn.sendMessage(m.chat, {
        text: '❌ Gagal mengunduh, merender, atau mengirim video: ' +
          String(error?.message || error).replace(/[\\r\\n]+/g, ' ').slice(0, 600)
      }, { quoted: m, noAlvarethPreview: true }).catch(sendError => {
        console.error('[YTMP4] Gagal mengirim notifikasi error:', sendError?.message || sendError)
      })
    }
  } finally {
    if (result?.outputDir) await cleanupDownload(result.outputDir).catch(() => {})
  }
}

handler.help = ['playvid', 'ytmp4']
handler.tags = ['downloader']
handler.command = /^(playvid|ytmp4)$/i
handler.limit = true

export default handler
