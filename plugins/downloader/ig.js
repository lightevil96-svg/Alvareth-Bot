import axios from 'axios'
import { fileTypeFromBuffer } from 'file-type'

const MAX_MEDIA_BYTES = 150 * 1024 * 1024
const MAX_INLINE_VIDEO_BYTES = 50 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 90000

function isInstagramUrl(input) {
  try {
    const parsed = new URL(String(input || '').trim())
    return /^https?:$/.test(parsed.protocol) &&
      /^(?:[a-z0-9-]+\.)*instagram\.com$|^(?:[a-z0-9-]+\.)*instagr\.am$/i.test(parsed.hostname)
  } catch {
    return false
  }
}

function getApiBase() {
  return String(global.APIs?.nexray || 'https://api.nexray.eu.cc').replace(/\/+$/, '')
}

// Use the same documented NexRay v2 media schema already used by .ig3.
// Do not scrape SnapInsta's HTML: it started returning promotional graphics as
// apparent download links, which were then incorrectly sent as the "video".
async function getInstagramMedia(inputUrl) {
  const apiBase = getApiBase()
  const response = await axios.get(apiBase + '/downloader/v2/instagram', {
    params: { url: inputUrl },
    timeout: 45000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36'
    },
    validateStatus: status => status >= 200 && status < 300
  })

  const payload = response.data
  const result = payload?.result
  const mediaList = result?.media

  if (!payload?.status || !Array.isArray(mediaList) || mediaList.length === 0) {
    const message = payload?.message || payload?.msg || payload?.error
    throw new Error(String(message || 'API Instagram tidak menemukan media untuk tautan ini.'))
  }

  const media = mediaList.map((item, index) => {
    const url = String(item?.url || item?.download_url || item?.downloadUrl || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('API Instagram mengembalikan tautan media ke-' + (index + 1) + ' yang tidak valid.')
    }

    const declaredType = String(item?.type || '').toLowerCase()
    const type = declaredType === 'mp4' || declaredType.includes('video')
      ? 'video'
      : declaredType.startsWith('image') || declaredType === 'jpg' || declaredType === 'jpeg' || declaredType === 'png' || declaredType === 'webp'
        ? 'image'
        : ''

    if (!type) {
      throw new Error('Jenis media Instagram ke-' + (index + 1) + ' tidak dikenali oleh API.')
    }

    return { url, type }
  })

  return {
    media,
    username: String(result.username || result.author || '-'),
    title: String(result.title || result.caption || '')
  }
}

async function fetchValidatedMedia(item, index) {
  const response = await axios.get(item.url, {
    responseType: 'arraybuffer',
    timeout: REQUEST_TIMEOUT_MS,
    maxContentLength: MAX_MEDIA_BYTES,
    maxBodyLength: MAX_MEDIA_BYTES,
    headers: {
      accept: item.type === 'video'
        ? 'video/mp4,video/*,application/octet-stream,*/*;q=0.8'
        : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36',
      referer: 'https://www.instagram.com/'
    },
    validateStatus: status => status >= 200 && status < 300
  })

  const buffer = Buffer.from(response.data)
  if (buffer.length === 0) throw new Error('File media ke-' + index + ' kosong.')
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('File media ke-' + index + ' melebihi batas 150 MB.')

  const responseMime = String(response.headers?.['content-type'] || '')
    .split(';')[0].trim().toLowerCase()
  if (responseMime.includes('text/html') || responseMime.includes('application/json')) {
    throw new Error('URL media ke-' + index + ' mengembalikan halaman web, bukan file media.')
  }

  const detected = await fileTypeFromBuffer(buffer)
  const mime = String(detected?.mime || responseMime).toLowerCase()
  const expectedPrefix = item.type === 'video' ? 'video/' : 'image/'
  if (!mime.startsWith(expectedPrefix)) {
    throw new Error(
      'Media ke-' + index + ' seharusnya ' + item.type +
      ', tetapi server mengembalikan ' + (mime || 'format tak dikenal') + '.'
    )
  }

  return {
    buffer,
    mime,
    ext: detected?.ext || (item.type === 'video' ? 'mp4' : 'jpg'),
    type: item.type
  }
}

let handler = async (m, { conn, args, text, command }) => {
  const input = String(text || args?.[0] || '').trim()
  if (!input) {
    return conn.sendMessage(m.chat, {
      text: 'Contoh: .' + command + ' https://www.instagram.com/reel/xxxx/',
    }, { quoted: m, noAlvarethPreview: true })
  }

  if (!isInstagramUrl(input)) {
    return conn.sendMessage(m.chat, {
      text: '❌ Tautan Instagram tidak valid. Kirim tautan postingan atau Reel Instagram yang lengkap.'
    }, { quoted: m, noAlvarethPreview: true })
  }

  await m.react('🕒')
  try {
    const parsedUrl = new URL(input)
    const result = await getInstagramMedia(parsedUrl.toString())
    let sentCount = 0

    for (let i = 0; i < result.media.length; i++) {
      const item = result.media[i]
      const media = await fetchValidatedMedia(item, i + 1)
      const safeBase = 'instagram-' + Date.now() + '-' + (i + 1)
      const parts = [
        '✅ *Instagram Downloader*',
        '',
        result.username !== '-' ? '👤 *Kreator:* ' + result.username : '',
        result.title ? '📝 *Judul:* ' + result.title.replace(/\s+/g, ' ').slice(0, 300) : '',
        '📦 *Media:* ' + (i + 1) + ' dari ' + result.media.length
      ].filter(Boolean)
      const caption = parts.join('\n')

      let message
      if (media.type === 'video') {
        message = media.buffer.length > MAX_INLINE_VIDEO_BYTES
          ? {
              document: media.buffer,
              mimetype: media.mime,
              fileName: safeBase + '.' + media.ext,
              caption
            }
          : {
              video: media.buffer,
              mimetype: media.mime,
              fileName: safeBase + '.' + media.ext,
              caption
            }
      } else {
        message = {
          image: media.buffer,
          mimetype: media.mime,
          fileName: safeBase + '.' + media.ext,
          caption
        }
      }

      const sent = await conn.sendMessage(m.chat, message, {
        quoted: m,
        noAlvarethPreview: true
      })
      if (!sent?.key?.id) {
        throw new Error('WhatsApp tidak mengonfirmasi pembuatan pesan untuk media ke-' + (i + 1) + '.')
      }

      sentCount++
    }

    await m.react('✅')
    console.log('[IG Downloader] Berhasil mengirim ' + sentCount + '/' + result.media.length + ' media ke ' + m.chat)
  } catch (error) {
    console.error('[IG Downloader]', error?.stack || error)
    await m.react('❌')
    return conn.sendMessage(m.chat, {
      text: '❌ Gagal mengunduh Instagram: ' + String(error?.message || error)
    }, { quoted: m, noAlvarethPreview: true })
  }
}

handler.help = ['igdl', 'ig', 'instagram']
handler.command = ['igdl', 'ig', 'instagram']
handler.tags = ['downloader']
handler.limit = true

export default handler
