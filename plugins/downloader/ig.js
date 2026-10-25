import axios from 'axios'
import FormData from 'form-data'
import * as cheerio from 'cheerio'
import { fileTypeFromBuffer } from 'file-type'

const MAX_MEDIA_BYTES = 150 * 1024 * 1024
const MAX_INLINE_VIDEO_BYTES = 50 * 1024 * 1024

async function igdl(url) {
  const form = new FormData()
  form.append('url', url)
  form.append('action', 'post')

  const res = await axios.post('https://snapinsta.top/action.php', form, {
    timeout: 45000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
      ...form.getHeaders(),
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
      accept: '*/*',
      origin: 'https://snapinsta.top',
      referer: 'https://snapinsta.top/'
    }
  })

  const $ = cheerio.load(res.data)
  const downloads = []

  $('.download-items__btn a').each((_, el) => {
    let link = $(el).attr('href')
    if (!link) return
    if (!/^https?:\/\//i.test(link)) link = new URL(link, 'https://snapinsta.top').toString()
    if (!downloads.includes(link)) downloads.push(link)
  })

  return { status: downloads.length ? 200 : 404, download: downloads }
}

async function fetchInstagramMedia(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: MAX_MEDIA_BYTES,
    maxBodyLength: MAX_MEDIA_BYTES,
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36',
      accept: 'video/mp4,video/*,image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      referer: 'https://snapinsta.top/'
    },
    validateStatus: status => status >= 200 && status < 300
  })

  const buffer = Buffer.from(response.data)
  if (!buffer.length) throw new Error('Server Instagram mengembalikan file kosong.')
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('Media Instagram melebihi batas 150 MB.')

  const responseMime = String(response.headers?.['content-type'] || '')
    .split(';')[0].trim().toLowerCase()
  if (responseMime.includes('text/html') || responseMime.includes('application/json')) {
    throw new Error('Tautan unduhan Instagram mengembalikan halaman web, bukan file media.')
  }

  const detected = await fileTypeFromBuffer(buffer)
  const mime = detected?.mime || responseMime
  if (!mime || (!mime.startsWith('video/') && !mime.startsWith('image/'))) {
    throw new Error('Format media Instagram tidak dikenali (' + (mime || 'unknown') + ').')
  }

  return { buffer, mime, ext: detected?.ext || (mime.startsWith('video/') ? 'mp4' : 'jpg') }
}

let handler = async (m, { conn, args, text, command }) => {
  const input = String(text || args?.[0] || '').trim()
  if (!input) return m.reply(`*Contoh:* .${command} https://www.instagram.com/reel/xxxx/`)

  let parsed
  try {
    parsed = new URL(input)
  } catch {
    return conn.sendMessage(m.chat, { text: '❌ Tautan Instagram tidak valid.' }, { quoted: m, noAlvarethPreview: true })
  }
  if (!/^(?:[a-z0-9-]+\.)*instagram\.com$|^(?:[a-z0-9-]+\.)*instagr\.am$/i.test(parsed.hostname)) {
    return conn.sendMessage(m.chat, { text: '❌ Kirim tautan dari Instagram yang valid.' }, { quoted: m, noAlvarethPreview: true })
  }

  await m.react('🕒')
  try {
    const result = await igdl(parsed.toString())
    if (!result.download.length) throw new Error('Media tidak ditemukan atau tautan Instagram tidak dapat diakses.')

    let sentCount = 0
    for (let i = 0; i < result.download.length; i++) {
      const media = await fetchInstagramMedia(result.download[i])
      const baseName = `instagram-${Date.now()}-${i + 1}`
      const caption = `✅ *Instagram Downloader*
Media ${i + 1} dari ${result.download.length}`
      let message

      if (media.mime.startsWith('video/')) {
        message = media.buffer.length > MAX_INLINE_VIDEO_BYTES
          ? {
              document: media.buffer,
              mimetype: media.mime,
              fileName: `${baseName}.${media.ext}`,
              caption
            }
          : {
              video: media.buffer,
              mimetype: media.mime,
              fileName: `${baseName}.${media.ext}`,
              caption
            }
      } else {
        message = {
          image: media.buffer,
          mimetype: media.mime,
          fileName: `${baseName}.${media.ext}`,
          caption
        }
      }

      const sent = await conn.sendMessage(m.chat, message, {
        quoted: m,
        noAlvarethPreview: true
      })
      if (!sent?.key?.id) throw new Error('WhatsApp tidak mengembalikan ID pesan untuk media ke-' + (i + 1) + '.')
      sentCount++
    }

    await m.react('✅')
    console.log(`[IG Downloader] Berhasil mengirim ${sentCount}/${result.download.length} media ke ${m.chat}`)
  } catch (error) {
    console.error('[IG Downloader]', error?.stack || error)
    await m.react('❌')
    return conn.sendMessage(m.chat, { text: '❌ Gagal mengunduh/mengirim media Instagram: ' + String(error?.message || error) }, { quoted: m, noAlvarethPreview: true })
  }
}

handler.help = ['igdl', 'ig', 'instagram']
handler.command = ['igdl', 'ig', 'instagram']
handler.tags = ['downloader']
handler.limit = true

export default handler
