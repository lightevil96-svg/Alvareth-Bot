import fs from 'node:fs'
import yts from 'yt-search'
import {
  downloadYoutubeVideo,
  downloadYoutubeVideoBest,
  cleanupDownload
} from '../../lib/scrape/youtube.js'

const MAX_INLINE_VIDEO_BYTES = 50 * 1024 * 1024
const ALLOWED_QUALITIES = new Set([144, 240, 360, 480, 720, 1080, 1440, 2160])

function cleanFilename(value) {
  return String(value || 'video')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 160) || 'video'
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const rawInput = String(text || '').trim()
  if (!rawInput) {
    throw `Contoh:
${usedPrefix || '.'}${command} https://youtu.be/dQw4w9WgXcQ|best
${usedPrefix || '.'}${command} https://youtu.be/dQw4w9WgXcQ|360

Kualitas: |best = resolusi tertinggi yang tersedia, |360 = hemat data.`
  }

  const [queryPart, qualityPart = '360'] = rawInput.split('|')
  const query = String(queryPart || '').trim()
  const qualityToken = String(qualityPart || '360').trim().toLowerCase()
  const useBest = ['best', 'max', 'highest', 'hd'].includes(qualityToken)
  const numericQuality = Number(qualityToken)
  const targetQuality = ALLOWED_QUALITIES.has(numericQuality) ? numericQuality : 360
  if (!query) throw new Error('Judul video atau URL YouTube tidak boleh kosong.')

  await m.react('🕒')
  let result

  try {
    let url = query
    if (!/^https?:\/\//i.test(query)) {
      const search = await yts(query)
      const video = search.videos?.[0]
      if (!video) throw new Error('Video tidak ditemukan.')
      url = video.url
    }

    // Use format metadata to choose the actual highest available resolution.
    // "best" is not translated to a guessed 720p/1080p target.
    result = useBest
      ? await downloadYoutubeVideoBest(url)
      : await downloadYoutubeVideo(url, targetQuality)

    const buffer = fs.readFileSync(result.path)
    if (!buffer.length) throw new Error('File video hasil unduhan kosong.')
    const size = fs.statSync(result.path).size
    const actualQuality = result.quality || targetQuality
    const caption = [
      '🎬 *' + cleanFilename(result.title || 'Video YouTube') + '*',
      '📺 Kualitas: ' + actualQuality + (typeof actualQuality === 'number' ? 'p' : ''),
      useBest ? '✨ Mode: kualitas tertinggi yang tersedia' : '📦 Mode: hemat data',
      '📁 Format: MP4'
    ].join('\n')

    const fileName = cleanFilename(result.title) + '-' + actualQuality + 'p.mp4'
    const sent = size > MAX_INLINE_VIDEO_BYTES
      ? await conn.sendMessage(m.chat, {
          document: buffer,
          mimetype: 'video/mp4',
          fileName,
          caption
        }, { quoted: m, noAlvarethPreview: true })
      : await conn.sendMessage(m.chat, {
          video: buffer,
          mimetype: 'video/mp4',
          fileName,
          caption
        }, { quoted: m, noAlvarethPreview: true })

    if (!sent?.key?.id) throw new Error('WhatsApp tidak mengembalikan ID pesan video.')
    await m.react('✅')
    console.log('[YTMP4] Terkirim ke', m.chat, '| kualitas', actualQuality, '| best=', useBest)
  } catch (error) {
    console.error('[YTMP4]', error?.stack || error)
    await m.react('❌')
    await conn.sendMessage(m.chat, {
      text: '❌ Gagal mengunduh/mengirim video: ' + String(error?.message || error)
    }, { quoted: m, noAlvarethPreview: true })
  } finally {
    if (result?.outputDir) await cleanupDownload(result.outputDir).catch(() => {})
  }
}

handler.help = ['playvid', 'ytmp4']
handler.tags = ['downloader']
handler.command = /^(playvid|ytmp4)$/i
handler.limit = true

export default handler
