import axios from 'axios'
import { fileTypeFromBuffer } from 'file-type'
import { extractXMedia, parseXStatusUrl } from '../../lib/scrape/twitter.js'

const API_TIMEOUT_MS = 12000
const MEDIA_TIMEOUT_MS = 60000
const MAX_MEDIA_BYTES = 150 * 1024 * 1024
const MAX_TOTAL_MEDIA_BYTES = 250 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'

async function downloadXMedia(item, index, allowSaveTwitter = false) {
  const mediaUrl = new URL(item.url)
  const isXMediaHost = /(?:^|\.)twimg\.com$/i.test(mediaUrl.hostname)
  const isSaveTwitterHost = allowSaveTwitter && mediaUrl.hostname.toLowerCase() === 'dl.snapcdn.app'
  if (!isXMediaHost && !isSaveTwitterHost) {
    throw new Error('Host media X tidak diizinkan.')
  }

  const response = await axios.get(item.url, {
    responseType: 'arraybuffer',
    timeout: MEDIA_TIMEOUT_MS,
    maxContentLength: MAX_MEDIA_BYTES,
    maxBodyLength: MAX_MEDIA_BYTES,
    headers: {
      accept: 'video/mp4,video/*,image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'user-agent': USER_AGENT,
      referer: allowSaveTwitter ? 'https://savetwitter.net/id3' : 'https://x.com/'
    },
    validateStatus: status => status >= 200 && status < 300
  })

  const buffer = Buffer.from(response.data)
  if (!buffer.length) throw new Error('Media ke-' + index + ' kosong.')
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('Media ke-' + index + ' melebihi batas 150 MB.')

  const responseMime = String(response.headers?.['content-type'] || '')
    .split(';')[0].trim().toLowerCase()
  const detected = await fileTypeFromBuffer(buffer)
  const mime = String(detected?.mime || responseMime).toLowerCase()
  if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
    throw new Error('Media ke-' + index + ' bukan foto/video yang valid (' + (mime || 'unknown') + ').')
  }

  return {
    buffer,
    mime,
    ext: detected?.ext || (mime.startsWith('video/') ? 'mp4' : 'jpg'),
    type: mime.startsWith('video/') ? 'video' : 'image'
  }
}

function getPostMetadata(payload) {
  const post = payload?.status || payload?.tweet || payload?.data?.status || payload?.data?.tweet || payload || {}
  const author = post.author || {}
  return {
    text: String(post.text || payload?.text || '').replace(/\s+/g, ' ').trim(),
    author: String(author.name || author.screen_name || post.user_name || post.user_screen_name || '').trim()
  }
}

async function resolveXMedia(status) {
  const providers = [
    {
      name: 'FxTwitter API v2',
      url: 'https://api.fxtwitter.com/2/status/' + encodeURIComponent(status.id)
    },
    {
      name: 'FxTwitter legacy',
      url: 'https://api.fxtwitter.com/' + encodeURIComponent(status.screenName) + '/status/' + encodeURIComponent(status.id)
    },
    {
      name: 'VXTwitter',
      url: 'https://api.vxtwitter.com/' + encodeURIComponent(status.screenName) + '/status/' + encodeURIComponent(status.id)
    }
  ]
  const failures = []

  for (const provider of providers) {
    try {
      const response = await axios.get(provider.url, {
        timeout: API_TIMEOUT_MS,
        maxContentLength: 4 * 1024 * 1024,
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
          referer: 'https://x.com/'
        },
        validateStatus: code => code >= 200 && code < 300
      })
      let payload = response.data
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload) } catch {
          throw new Error(provider.name + ' mengembalikan respons non-JSON.')
        }
      }
      const apiCode = Number(payload?.code)
      if (Number.isFinite(apiCode) && apiCode >= 400) {
        throw new Error(provider.name + ' menolak permintaan dengan kode ' + apiCode + '.')
      }

      const media = extractXMedia(payload)
      if (!media.length) {
        const message = String(payload?.message || payload?.status?.message || '')
        throw new Error(provider.name + ' tidak mengembalikan media foto/video.' + (message ? ' ' + message : ''))
      }

      const files = []
      const itemFailures = []
      let totalBytes = 0
      for (let i = 0; i < media.length; i++) {
        try {
          const file = await downloadXMedia(media[i], i + 1)
          totalBytes += file.buffer.length
          if (totalBytes > MAX_TOTAL_MEDIA_BYTES) {
            throw new Error('Total media melebihi batas 250 MB.')
          }
          files.push(file)
        } catch (error) {
          itemFailures.push(String(error?.message || error))
        }
      }
      if (!files.length) {
        throw new Error(itemFailures.slice(0, 3).join(' | ') || 'Tidak ada media yang berhasil diunduh.')
      }

      return {
        files,
        mediaCount: media.length,
        skipped: itemFailures.length,
        metadata: getPostMetadata(payload),
        provider: provider.name
      }
    } catch (error) {
      const message = String(error?.message || error)
      failures.push(provider.name + ': ' + message)
      console.warn('[X Downloader] Provider gagal (' + provider.name + '): ' + message.slice(0, 220))
    }
  }


  // Preserve the previous SaveTwitter MP4 route as a last-resort video-only
  // fallback. Photo posts are resolved by FxTwitter/VXTwitter above.
  try {
    const body = new URLSearchParams({
      q: status.url,
      lang: 'id',
      cftoken: ''
    })
    const response = await axios.post('https://savetwitter.net/api/ajaxSearch', body, {
      timeout: API_TIMEOUT_MS,
      maxContentLength: 4 * 1024 * 1024,
      headers: {
        'user-agent': USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest',
        origin: 'https://savetwitter.net',
        referer: 'https://savetwitter.net/id3'
      },
      validateStatus: code => code >= 200 && code < 300
    })
    let payload = response.data
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload) } catch {}
    }
    const html = String(payload?.data || '')
    const best = [...html.matchAll(/href="(https:\/\/dl\.snapcdn\.app\/get\?token=[^"]+)".*?MP4\s*\(([^)]+)\)/g)][0]
    if (!best?.[1]) throw new Error('SaveTwitter tidak menyediakan file MP4 untuk postingan ini.')
    const file = await downloadXMedia({ type: 'video', url: best[1] }, 1, true)
    const title = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]
      ?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || ''
    return {
      files: [file],
      mediaCount: 1,
      skipped: 0,
      metadata: { text: title, author: '' },
      provider: 'SaveTwitter legacy'
    }
  } catch (error) {
    failures.push('SaveTwitter legacy: ' + String(error?.message || error))
  }

  throw new Error('Semua sumber unduhan X gagal. Pastikan postingan bersifat publik. Detail sumber: ' + failures.join(' | ').slice(0, 700))
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const input = String(text || '').trim()
  if (!input) {
    return m.reply('*Contoh: ' + usedPrefix + command + ' https://x.com/username/status/123456789*')
  }

  await m.react('⏳')
  try {
    const status = parseXStatusUrl(input)
    const result = await resolveXMedia(status)
    let sentCount = 0

    for (let i = 0; i < result.files.length; i++) {
      const media = result.files[i]
      const parts = [
        '*🐦 X Downloader*',
        result.metadata.author ? '👤 *Kreator:* ' + result.metadata.author : '',
        i === 0 && result.metadata.text ? '📝 *Teks:* ' + result.metadata.text.slice(0, 300) : '',
        '📦 *Media:* ' + (i + 1) + ' dari ' + (result.mediaCount || result.files.length) +
          (result.skipped ? ' (' + result.skipped + ' gagal diambil)' : '')
      ].filter(Boolean)
      const caption = parts.join('\n')
      const fileName = 'x-' + status.id + '-' + (i + 1) + '.' + media.ext
      const message = media.type === 'video'
        ? { video: media.buffer, mimetype: media.mime, fileName, caption }
        : { image: media.buffer, mimetype: media.mime, fileName, caption }

      const sent = await conn.sendMessage(m.chat, message, {
        quoted: m,
        noAlvarethPreview: true
      })
      if (!sent?.key?.id) {
        throw new Error('WhatsApp tidak mengonfirmasi pengiriman media X ke-' + (i + 1) + '.')
      }
      sentCount++
    }

    await m.react('✅')
    console.log('[X Downloader] Berhasil mengirim ' + sentCount + '/' + result.files.length +
      ' media melalui ' + result.provider)
  } catch (error) {
    console.error('[X Downloader]', error?.stack || error)
    await m.react('❌')
    await m.reply('❌ Gagal mengunduh X: ' + String(error?.message || error))
  } finally {
    try {
      await conn.sendMessage(m.chat, { react: { text: '', key: m.key } })
    } catch {}
  }
}

handler.help = ['twitter']
handler.tags = ['downloader']
handler.command = /^(twitter|tw|xdl)$/i
handler.limit = true
handler.register = false

export default handler
