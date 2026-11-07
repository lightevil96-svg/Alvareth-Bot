const TWIMG_HOST_RE = /(?:^|\\.)twimg\\.com$/i
const MAX_MEDIA_ITEMS = 20

function normalizeCdnUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol) || !TWIMG_HOST_RE.test(url.hostname.toLowerCase())) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function inferMediaType(url) {
  const value = String(url || '').toLowerCase()
  if (/^https?:\\/\\/video\\.twimg\\.com\\//i.test(value) || /\\.(?:mp4|m4v|m3u8)(?:[?#]|$)/i.test(value)) return 'video'
  if (/^https?:\\/\\/pbs\\.twimg\\.com\\//i.test(value) || /\\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(value)) return 'image'
  return ''
}

function bestMp4Variant(item) {
  const variants = [
    ...(Array.isArray(item?.variants) ? item.variants : []),
    ...(Array.isArray(item?.video_info?.variants) ? item.video_info.variants : []),
    ...(Array.isArray(item?.videoInfo?.variants) ? item.videoInfo.variants : [])
  ]
  return variants
    .filter(variant => {
      const url = String(variant?.url || '').trim()
      const contentType = String(variant?.content_type || variant?.contentType || '').toLowerCase()
      return url && (contentType === 'video/mp4' || /\\.mp4(?:[?#]|$)/i.test(url))
    })
    .sort((a, b) => Number(b?.bitrate || 0) - Number(a?.bitrate || 0))[0]?.url || ''
}

function normalizeMediaItem(item, fallbackType = '') {
  if (typeof item === 'string') {
    const url = normalizeCdnUrl(item)
    return url ? { url, type: inferMediaType(url) } : null
  }
  if (!item || typeof item !== 'object') return null

  const rawType = String(item.type || item.media_type || item.mediaType || item.kind || fallbackType || '').toLowerCase()
  const type = /video|gif/.test(rawType)
    ? 'video'
    : /photo|image|mosaic/.test(rawType)
      ? 'image'
      : ''
  const rawUrl = (type === 'video' ? bestMp4Variant(item) : '') ||
    item.url || item.media_url_https || item.media_url || item.download_url || item.downloadUrl || item.src || ''
  const url = normalizeCdnUrl(rawUrl)
  if (!url) return null
  return { url, type: type || inferMediaType(url) }
}

/**
 * Normalizes media from FxTwitter v2/v1 and VXTwitter responses.
 * The returned URLs are restricted to X's own media CDN to avoid fetching
 * arbitrary hosts supplied by an upstream API.
 */
export function extractXMedia(payload) {
  const roots = [
    payload?.status,
    payload?.tweet,
    payload?.data?.status,
    payload?.data?.tweet,
    payload
  ]
  const root = roots.find(value => value && typeof value === 'object' &&
    (value.media || value.media_extended || value.mediaURLs))
  if (!root || root.type === 'tombstone') return []

  const media = root.media && typeof root.media === 'object' ? root.media : {}
  const collected = []
  const add = (item, fallbackType = '') => {
    const normalized = normalizeMediaItem(item, fallbackType)
    if (normalized) collected.push(normalized)
  }

  if (Array.isArray(media.all)) {
    for (const item of media.all) add(item)
  }
  if (!collected.length) {
    if (Array.isArray(media.photos)) for (const item of media.photos) add(item, 'photo')
    if (Array.isArray(media.videos)) for (const item of media.videos) add(item, 'video')
  }
  if (!collected.length && Array.isArray(root.media_extended)) {
    for (const item of root.media_extended) add(item)
  }
  if (!collected.length && Array.isArray(root.mediaURLs)) {
    for (const item of root.mediaURLs) add(item)
  }

  const seen = new Set()
  return collected.filter(item => {
    const key = item.url
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, MAX_MEDIA_ITEMS)
}

/**
 * Accepts public X/Twitter status permalinks and discards tracking parameters.
 */
export function parseXStatusUrl(input) {
  const raw = String(input || '').trim()
  const match = raw.match(/https?:\\/\\/[^\\s]+/i)
  let parsed
  try {
    parsed = new URL(match?.[0] || raw)
  } catch {
    throw new Error('Tautan X/Twitter tidak valid.')
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\\./, '')
  if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) {
    throw new Error('Gunakan tautan postingan dari x.com atau twitter.com.')
  }

  const parts = parsed.pathname.split('/').filter(Boolean)
  const statusIndex = parts.findIndex(part => part.toLowerCase() === 'status')
  const id = parts[statusIndex + 1] || ''
  const screenName = parts[statusIndex - 1] || ''
  if (statusIndex < 1 || !/^\\d+$/.test(id)) {
    throw new Error('ID postingan X tidak ditemukan pada tautan.')
  }

  return {
    id,
    screenName,
    url: 'https://x.com/' + encodeURIComponent(screenName) + '/status/' + id
  }
}
