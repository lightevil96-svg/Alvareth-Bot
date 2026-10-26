import axios from 'axios'
import * as cheerio from 'cheerio'
import { fileTypeFromBuffer } from 'file-type'

const MAX_MEDIA_BYTES = 150 * 1024 * 1024
const MAX_INLINE_VIDEO_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_MEDIA_BYTES = 250 * 1024 * 1024
const MAX_MEDIA_ITEMS = 20
const API_TIMEOUT_MS = 9000
const MEDIA_TIMEOUT_MS = 60000
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'

const FALLBACK_PROVIDERS = [
  { name: 'TiklyDown', endpoint: 'https://api.tiklydown.eu.org/api/download/ig' },
  { name: 'SiputZX', endpoint: 'https://api.siputzx.my.id/api/d/igdl' },
  { name: 'FAA', endpoint: 'https://api.faa.my.id/api/download/instagram' },
  { name: 'Agatz', endpoint: 'https://api.agatz.xyz/api/instagram' },
  { name: 'Vreden', endpoint: 'https://api.vreden.my.id/api/igdownload' },
  { name: 'Widipe', endpoint: 'https://widipe.com/igdl' },
  { name: 'Ryzumi', endpoint: 'https://api.ryzumi.vip/api/downloader/igdl' }
]

const EXCLUDED_KEYS = /thumbnail|thumb|cover|poster|preview|avatar|profile|music|audio|song|icon|logo|author|username|caption|description|duration|likes?|comments?|views?|followers?|owner|user|watermark|artwork/i
const MEDIA_FIELD_ORDER = [
  'video_hd', 'video_url', 'videoUrl', 'video', 'hd_url', 'hdUrl', 'hdplay',
  'download_url', 'downloadUrl', 'media_url', 'mediaUrl', 'download', 'play',
  'url', 'link', 'src', 'original_url', 'original', 'image_url', 'imageUrl',
  'display_url', 'displayUrl', 'image', 'photo', 'url_list'
]

function isInstagramHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'instagram.com' ||
    host.endsWith('.instagram.com') ||
    host === 'instagr.am' ||
    host.endsWith('.instagr.am')
}

function isInstagramUrl(input) {
  try {
    const parsed = new URL(String(input || '').trim())
    return /^https?:$/.test(parsed.protocol) && isInstagramHost(parsed.hostname)
  } catch {
    return false
  }
}

function normalizeMediaType(value) {
  const type = String(value || '').toLowerCase()
  if (type === '2' || /video|mp4|reel|clip/.test(type)) return 'video'
  if (type === '1' || /image|photo|picture|jpeg|jpg|png|webp|still/.test(type)) return 'image'
  return ''
}

function inferTypeFromKey(key) {
  const value = String(key || '').toLowerCase()
  if (/video|mp4|reel|clip|hdplay|video_hd/.test(value)) return 'video'
  if (/image|photo|picture|display_url|image_url|url_list/.test(value)) return 'image'
  return ''
}

function isHttpMediaUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return false
  try {
    const parsed = new URL(value.trim())
    return /^https?:$/.test(parsed.protocol) &&
      !isInstagramHost(parsed.hostname) &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
  } catch {
    return false
  }
}

function firstUrl(value) {
  if (typeof value === 'string') return isHttpMediaUrl(value) ? value.trim() : ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item)
      if (found) return found
    }
    return ''
  }
  if (value && typeof value === 'object') {
    for (const key of ['url', 'src', 'download_url', 'downloadUrl', 'url_list']) {
      if (value[key] != null) {
        const found = firstUrl(value[key])
        if (found) return found
      }
    }
  }
  return ''
}

function collectMediaItems(payload) {
  const output = []
  const seen = new Set()

  function add(url, type) {
    if (!isHttpMediaUrl(url)) return
    const normalized = url.trim()
    if (seen.has(normalized)) return
    seen.add(normalized)
    output.push({ url: normalized, type: type || '' })
  }

  function walk(value, keyPath = [], depth = 0) {
    if (depth > 9 || value == null) return

    if (Array.isArray(value)) {
      for (const item of value) walk(item, keyPath, depth + 1)
      return
    }

    if (typeof value === 'string') {
      const lastKey = keyPath[keyPath.length - 1] || ''
      if (!EXCLUDED_KEYS.test(lastKey) && isHttpMediaUrl(value)) {
        add(value, inferTypeFromKey(keyPath.join('.')))
      }
      return
    }

    if (typeof value !== 'object') return

    const declaredType = normalizeMediaType(
      value.type || value.media_type || value.mediaType || value.mime_type || value.mimeType || value.kind
    )

    // Prefer collections of actual media over metadata/thumbnail fields.
    const preferredCollections = [
      'media', 'medias', 'items', 'videos', 'images', 'photos', 'downloads',
      'download_links', 'downloadLinks', 'url_list', 'urls', 'result', 'data'
    ]
    const beforeCollections = output.length
    for (const key of preferredCollections) {
      if (value[key] == null || EXCLUDED_KEYS.test(key)) continue
      if (Array.isArray(value[key]) || (value[key] && typeof value[key] === 'object')) {
        walk(value[key], [...keyPath, key], depth + 1)
      }
    }
    if (output.length > beforeCollections) return

    // API providers use different field names. Select one direct media URL per
    // item to avoid sending multiple quality variants of the same video.
    for (const key of MEDIA_FIELD_ORDER) {
      if (value[key] == null || EXCLUDED_KEYS.test(key)) continue
      const url = firstUrl(value[key])
      if (!url) continue
      const type = inferTypeFromKey(key) || declaredType || inferTypeFromKey(keyPath.join('.'))
      add(url, type)
      return
    }

    for (const [key, child] of Object.entries(value)) {
      if (EXCLUDED_KEYS.test(key)) continue
      if (child && typeof child === 'object') {
        walk(child, [...keyPath, key], depth + 1)
      } else if (typeof child === 'string' && isHttpMediaUrl(child) &&
          /url|link|src|video|image|photo|media|download|play|hd/i.test(key)) {
        add(child, inferTypeFromKey(key) || declaredType || inferTypeFromKey(keyPath.join('.')))
      }
    }
  }

  walk(payload)
  return output.slice(0, MAX_MEDIA_ITEMS)
}

function findMetadataText(root, acceptedKeys) {
  const visited = new Set()
  function walk(value, depth = 0) {
    if (depth > 7 || value == null) return ''
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1)
        if (found) return found
      }
      return ''
    }
    if (typeof value !== 'object') return ''
    if (visited.has(value)) return ''
    visited.add(value)

    for (const key of acceptedKeys) {
      const candidate = value[key]
      if (typeof candidate === 'string' && candidate.trim() &&
          candidate.length < 1200 && !/^https?:\/\//i.test(candidate.trim())) {
        return candidate.replace(/\s+/g, ' ').trim()
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (EXCLUDED_KEYS.test(key) && !acceptedKeys.includes(key)) continue
      const found = walk(child, depth + 1)
      if (found) return found
    }
    return ''
  }
  return walk(root)
}

function getMetadata(payload) {
  return {
    title: findMetadataText(payload, ['title', 'caption', 'description']) || '',
    username: findMetadataText(payload, ['username', 'author', 'creator', 'owner']) || ''
  }
}

function assertApiSuccess(payload, providerName) {
  if (payload == null || typeof payload !== 'object') {
    throw new Error(providerName + ' tidak mengembalikan JSON media yang valid.')
  }
  const status = payload.status
  const statusText = typeof status === 'string' ? status.toLowerCase() : ''
  if (payload.success === false || payload.ok === false || status === false ||
      /^(error|failed|failure|fail)$/.test(statusText) ||
      (typeof status === 'number' && status >= 400)) {
    throw new Error(String(payload.message || payload.msg || payload.error || providerName + ' menolak permintaan.'))
  }
}

function getProviders() {
  const providers = [...FALLBACK_PROVIDERS]
  const base = String(global.APIs?.nexray || 'https://api.nexray.eu.cc').replace(/\/+$/, '')
  // Keep NexRay as an additional source, not the only source; this endpoint has
  // been returning HTTP 500 in the user's live test.
  providers.push({
    name: 'NexRay',
    endpoint: base + '/downloader/v2/instagram'
  })
  return providers
}

async function getApiMedia(provider, inputUrl) {
  const response = await axios.get(provider.endpoint, {
    params: { url: inputUrl },
    timeout: API_TIMEOUT_MS,
    maxContentLength: 6 * 1024 * 1024,
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
      referer: 'https://www.instagram.com/'
    },
    validateStatus: status => status >= 200 && status < 300
  })

  let payload = response.data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      throw new Error(provider.name + ' mengembalikan halaman teks/HTML, bukan JSON media.')
    }
  }

  assertApiSuccess(payload, provider.name)
  const media = collectMediaItems(payload)
  if (!media.length) {
    throw new Error(provider.name + ' tidak menemukan tautan media yang bisa dipakai.')
  }
  return { media, metadata: getMetadata(payload) }
}

async function fetchValidatedMedia(item, index) {
  const response = await axios.get(item.url, {
    responseType: 'arraybuffer',
    timeout: MEDIA_TIMEOUT_MS,
    maxContentLength: MAX_MEDIA_BYTES,
    maxBodyLength: MAX_MEDIA_BYTES,
    headers: {
      accept: 'video/mp4,video/*,image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'user-agent': USER_AGENT,
      referer: 'https://www.instagram.com/'
    },
    validateStatus: status => status >= 200 && status < 300
  })

  const buffer = Buffer.from(response.data)
  if (!buffer.length) throw new Error('File media ke-' + index + ' kosong.')
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('File media ke-' + index + ' melebihi batas 150 MB.')

  const responseMime = String(response.headers?.['content-type'] || '')
    .split(';')[0].trim().toLowerCase()
  if (responseMime.includes('text/html') || responseMime.includes('application/json') ||
      responseMime.includes('text/plain')) {
    throw new Error('URL media ke-' + index + ' mengembalikan halaman web, bukan file media.')
  }

  const detected = await fileTypeFromBuffer(buffer)
  let mime = String(detected?.mime || responseMime).toLowerCase()
  if (!mime.startsWith('video/') && !mime.startsWith('image/')) {
    throw new Error('Format media ke-' + index + ' tidak dikenali (' + (mime || 'unknown') + ').')
  }

  const type = mime.startsWith('video/') ? 'video' : 'image'
  // Always trust the downloaded file's actual type, not the API's label. This
  // blocks posters/promotional graphics from being sent as a successful Reel.
  if (item.type && item.type !== type) {
    console.warn('[IG Downloader] Provider mislabeled media:', {
      declaredType: item.type,
      actualType: type,
      urlHost: new URL(item.url).hostname
    })
  }

  return {
    buffer,
    mime,
    ext: detected?.ext || (type === 'video' ? 'mp4' : 'jpg'),
    type
  }
}

function normalizeEscapedUrl(value) {
  return String(value || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim()
}

async function getInstagramPageFallback(inputUrl, requireVideo) {
  const parsed = new URL(inputUrl)
  const match = parsed.pathname.match(/^\/(reel|reels|p|tv)\/([^/]+)/i)
  if (!match) throw new Error('URL Instagram tidak cocok dengan format postingan publik yang didukung.')

  const pageUrl = 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/embed/captioned/'
  const response = await axios.get(pageUrl, {
    timeout: API_TIMEOUT_MS,
    maxContentLength: 8 * 1024 * 1024,
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': USER_AGENT,
      referer: 'https://www.instagram.com/'
    },
    validateStatus: status => status >= 200 && status < 300
  })

  const html = String(response.data || '')
  if (!html || /login to instagram|log in to instagram/i.test(html.slice(0, 8000))) {
    throw new Error('Instagram menampilkan halaman login, bukan data media publik.')
  }

  const $ = cheerio.load(html)
  const candidates = []
  const seen = new Set()
  const add = (value, type) => {
    const url = normalizeEscapedUrl(value)
    if (!isHttpMediaUrl(url) || seen.has(url)) return
    seen.add(url)
    candidates.push({ url, type })
  }

  add($('meta[property="og:video"]').attr('content'), 'video')
  add($('meta[property="og:video:secure_url"]').attr('content'), 'video')

  const cleanedHtml = normalizeEscapedUrl(html)
  const videoRegex = /"(?:video_url|videoUrl|contentUrl)"\s*:\s*"([^"]+?\.mp4[^"]*)"/gi
  for (const found of cleanedHtml.matchAll(videoRegex)) add(found[1], 'video')
  const videoTagRegex = /<video[^>]+src=["']([^"']+)["']/gi
  for (const found of cleanedHtml.matchAll(videoTagRegex)) add(found[1], 'video')

  if (!requireVideo) {
    add($('meta[property="og:image"]').attr('content'), 'image')
    const imageRegex = /"(?:display_url|image_url|imageUrl)"\s*:\s*"([^"]+)"/gi
    for (const found of cleanedHtml.matchAll(imageRegex)) add(found[1], 'image')
  }

  if (!candidates.length) {
    throw new Error('Halaman publik Instagram tidak menyediakan URL media langsung.')
  }
  return {
    media: candidates.slice(0, MAX_MEDIA_ITEMS),
    metadata: {
      title: $('meta[property="og:title"]').attr('content') || '',
      username: ''
    }
  }
}

function isReelUrl(inputUrl) {
  try {
    return /^\/(?:reel|reels|tv)\//i.test(new URL(inputUrl).pathname)
  } catch {
    return false
  }
}

async function tryProvider(provider, inputUrl, requireVideo) {
  const result = await getApiMedia(provider, inputUrl)
  let candidates = result.media
  if (requireVideo) {
    // A Reel must result in a real video payload; don't accept its cover image.
    candidates = candidates.filter(item => item.type !== 'image')
    candidates.sort((a, b) => Number(b.type === 'video') - Number(a.type === 'video'))
    if (!candidates.length) {
      throw new Error(provider.name + ' hanya mengembalikan gambar/thumbnail untuk sebuah Reel.')
    }

    const failures = []
    for (const candidate of candidates) {
      try {
        const file = await fetchValidatedMedia(candidate, 1)
        if (file.type !== 'video') {
          throw new Error('Hasilnya gambar, padahal tautan ini adalah Reel video.')
        }
        return { files: [file], metadata: result.metadata, provider: provider.name }
      } catch (error) {
        failures.push(String(error?.message || error))
      }
    }
    throw new Error(provider.name + ': ' + failures.slice(0, 2).join('; '))
  }

  const files = []
  let totalBytes = 0
  for (let i = 0; i < candidates.length; i++) {
    const file = await fetchValidatedMedia(candidates[i], i + 1)
    totalBytes += file.buffer.length
    if (totalBytes > MAX_TOTAL_MEDIA_BYTES) {
      throw new Error('Total media melebihi batas pengiriman 250 MB.')
    }
    files.push(file)
  }
  if (!files.length) throw new Error(provider.name + ' tidak menghasilkan file media.')
  return { files, metadata: result.metadata, provider: provider.name }
}

async function resolveInstagramMedia(inputUrl) {
  const requireVideo = isReelUrl(inputUrl)
  const failures = []

  for (const provider of getProviders()) {
    try {
      const result = await tryProvider(provider, inputUrl, requireVideo)
      console.log('[IG Downloader] Resolver berhasil:', provider.name, result.files.length + ' media')
      return result
    } catch (error) {
      const message = String(error?.message || error)
      failures.push(provider.name + ': ' + message)
      console.warn('[IG Downloader] Resolver gagal (' + provider.name + '): ' + message.slice(0, 240))
    }
  }

  // Last resort: parse Instagram's public embed page directly. This fallback
  // also validates actual file signatures before any WhatsApp send happens.
  try {
    const result = await getInstagramPageFallback(inputUrl, requireVideo)
    const files = []
    for (let i = 0; i < result.media.length; i++) {
      try {
        const file = await fetchValidatedMedia(result.media[i], i + 1)
        if (requireVideo && file.type !== 'video') continue
        files.push(file)
        if (requireVideo) break
      } catch (error) {
        failures.push('Instagram embed: ' + String(error?.message || error))
      }
    }
    if (files.length) {
      console.log('[IG Downloader] Resolver berhasil: Instagram public embed')
      return { files, metadata: result.metadata, provider: 'Instagram public embed' }
    }
    throw new Error('Embed tidak menghasilkan file media yang valid.')
  } catch (error) {
    failures.push('Instagram embed: ' + String(error?.message || error))
  }

  const summary = failures.slice(0, 5).join(' | ').slice(0, 900)
  throw new Error('Semua sumber unduhan Instagram gagal. Pastikan postingan bersifat publik dan bisa dibuka. Detail sumber: ' + summary)
}

let handler = async (m, { conn, args, text, command }) => {
  const input = String(text || args?.[0] || '').trim()
  if (!input) {
    return conn.sendMessage(m.chat, {
      text: 'Contoh: .' + command + ' https://www.instagram.com/reel/xxxx/'
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
    const result = await resolveInstagramMedia(parsedUrl.toString())
    let sentCount = 0

    for (let i = 0; i < result.files.length; i++) {
      const media = result.files[i]
      const safeBase = 'instagram-' + Date.now() + '-' + (i + 1)
      const parts = [
        '✅ *Instagram Downloader*',
        '',
        result.metadata.username ? '👤 *Kreator:* ' + result.metadata.username : '',
        result.metadata.title ? '📝 *Judul:* ' + result.metadata.title.replace(/\s+/g, ' ').slice(0, 300) : '',
        '📦 *Media:* ' + (i + 1) + ' dari ' + result.files.length
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
    console.log('[IG Downloader] Berhasil mengirim ' + sentCount + '/' + result.files.length +
      ' media ke ' + m.chat + ' melalui ' + result.provider)
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
