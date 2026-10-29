import axios from 'axios'

const TIKWM_API_URL = 'https://www.tikwm.com/api/feed/search'
const DEFAULT_NEXRAY_API_URL = 'https://api.nexray.eu.cc'
const headers = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  referer: 'https://www.tikwm.com/',
  origin: 'https://www.tikwm.com'
}

const VIDEO_ARRAY_KEYS = [
  'videos', 'items', 'results', 'result', 'data', 'aweme_list', 'awemeList',
  'item_list', 'itemList', 'search_item_list', 'video_list', 'videoList',
  'list', 'searchList', 'search_list', 'feed', 'item', 'aweme_info',
  'awemeInfo', 'item_info', 'itemInfo', 'video_info', 'videoInfo'
]

function pickText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function dedupeVideos(videos) {
  const seen = new Set()
  return videos.filter(video => {
    const key = String(video.id || video.url || '').trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isTikTokPermalink(candidate) {
  if (typeof candidate !== 'string' || !/^https?:\/\//i.test(candidate.trim())) return false
  try {
    const url = new URL(candidate.trim())
    const host = url.hostname.toLowerCase()
    const isTikTokHost = host === 'tiktok.com' || host.endsWith('.tiktok.com')
    const isShortTikTokHost = host === 'vm.tiktok.com' || host === 'vt.tiktok.com'
    return (isTikTokHost && /\/video\/\d+/i.test(url.pathname)) || isShortTikTokHost
  } catch {
    return false
  }
}

function toTikTokPermalink(candidates, id, username) {
  for (const candidate of candidates) {
    if (isTikTokPermalink(candidate)) return new URL(candidate.trim()).toString()
  }

  if (id) {
    const handle = String(username || 'tiktok').replace(/^@/, '').trim()
    return 'https://www.tiktok.com/@' + (handle || 'tiktok') + '/video/' + encodeURIComponent(String(id))
  }
  return ''
}

function normalizeVideo(input) {
  if (!input || typeof input !== 'object') return null

  // Different providers wrap the same video in different object names.
  const wrapped = input.aweme_info || input.awemeInfo ||
    input.item_info?.item_struct || input.itemInfo?.itemStruct ||
    input.item || input.item_struct || input.itemStruct
  const video = wrapped && typeof wrapped === 'object' ? wrapped : input

  const authorInfo = video.author || video.author_info || video.authorInfo ||
    video.user || video.owner || video.creator || {}
  const authorObject = authorInfo && typeof authorInfo === 'object' ? authorInfo : {}
  const username = pickText(
    authorObject.unique_id, authorObject.uniqueId, authorObject.uniqueID,
    authorObject.username, authorObject.user_name, authorObject.handle,
    video.author_name, video.username, video.unique_id
  )
  const author = pickText(
    authorObject.nickname, authorObject.nick_name, authorObject.display_name,
    authorObject.name, authorInfo, video.author_name, username
  ) || 'Unknown'

  const specificVideoId = pickText(
    video.video_id, video.aweme_id, video.awemeId, video.aweme_id_str,
    video.item_id, video.itemId
  )
  const id = pickText(specificVideoId, video.id, video.id_str)
  const rawTitle = pickText(
    video.title, video.desc, video.description, video.video_description,
    video.share_info?.share_title, video.text, input.title, input.desc
  )
  const title = rawTitle || 'TikTok Video'
  const urlCandidates = [
    video.share_url, video.shareUrl, video.share_info?.share_url,
    video.web_video_url, video.webVideoUrl, video.tiktok_url,
    video.tiktokUrl, video.aweme_url, video.awemeUrl, video.link, video.url,
    input.share_url, input.shareUrl, input.web_video_url, input.tiktok_url,
    input.link, input.url
  ]

  // Do not interpret API metadata such as { id: 0, data: [...] } as a video.
  // A generic id is accepted only when accompanied by actual video metadata.
  const hasExplicitPermalink = urlCandidates.some(isTikTokPermalink)
  const hasVideoMetadata = Boolean(
    specificVideoId || rawTitle || username ||
    pickText(authorObject.nickname, authorObject.nick_name, authorObject.name, authorInfo, video.author_name) ||
    video.video || video.play_count !== undefined || video.stats
  )
  if (!hasExplicitPermalink && !hasVideoMetadata) return null

  const url = toTikTokPermalink(urlCandidates, id, username)
  if (!url) return null

  const videoInfo = video.video && typeof video.video === 'object' ? video.video : {}
  const cover = pickText(
    video.cover, video.origin_cover, video.dynamic_cover,
    videoInfo.cover, videoInfo.origin_cover, videoInfo.dynamic_cover,
    video.thumbnail, video.thumbnail_url
  )

  return {
    id,
    title,
    author,
    url,
    cover,
    raw: video
  }
}

function extractVideos(payload) {
  const queue = [{ value: payload, depth: 0 }]
  const candidates = []
  const visited = new Set()
  let scanned = 0

  while (queue.length && scanned < 1800) {
    const current = queue.shift()
    const value = current?.value
    const depth = current?.depth || 0
    if (!value || typeof value !== 'object' || visited.has(value)) continue
    visited.add(value)
    scanned++

    if (Array.isArray(value)) {
      const normalized = dedupeVideos(value.map(normalizeVideo).filter(Boolean))
      if (normalized.length) candidates.push(normalized)
      if (depth < 5) {
        for (const item of value.slice(0, 50)) {
          if (item && typeof item === 'object') queue.push({ value: item, depth: depth + 1 })
        }
      }
      continue
    }

    const single = normalizeVideo(value)
    if (single) candidates.push([single])

    if (depth < 6) {
      // Visit common response containers first, then any additional nested result objects.
      const keys = [
        ...VIDEO_ARRAY_KEYS,
        ...Object.keys(value).filter(key => !VIDEO_ARRAY_KEYS.includes(key))
      ]
      for (const key of keys) {
        const child = value[key]
        if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 })
      }
    }
  }

  candidates.sort((a, b) => b.length - a.length)
  return dedupeVideos(candidates[0] || [])
}

function parsePayload(payload, provider) {
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      throw new Error(provider + ' mengembalikan respons non-JSON.')
    }
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(provider + ' mengembalikan respons kosong/tidak valid.')
  }

  const videos = extractVideos(payload)
  if (videos.length) return videos

  const failed = payload.success === false || payload.status === false
  const code = payload.code
  const codeString = code === undefined || code === null ? '' : String(code).toLowerCase()
  const badCode = codeString && !['0', '200', 'success', 'ok', 'true'].includes(codeString)
  if (failed || badCode) {
    const message = pickText(payload.msg, payload.message, payload.error, payload.status_msg)
    throw new Error(provider + ': ' + (message || ('kode respons ' + codeString)).slice(0, 180))
  }
  return []
}

async function requestTikWMSearch(query, method = 'get') {
  const params = { keywords: query, count: 30, cursor: 0, web: 1, hd: 1 }
  const options = {
    timeout: 10000,
    headers,
    maxContentLength: 5 * 1024 * 1024,
    validateStatus: status => status >= 200 && status < 500
  }

  const response = method === 'post'
    ? await axios.post(
        TIKWM_API_URL,
        new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])),
        {
          ...options,
          headers: {
            ...headers,
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
          }
        }
      )
    : await axios.get(TIKWM_API_URL, { ...options, params })

  if (response.status >= 400) throw new Error('TikWM HTTP ' + response.status)
  return parsePayload(response.data, 'TikWM')
}

async function requestNexRaySearch(query) {
  const base = String(globalThis.APIs?.nexray || DEFAULT_NEXRAY_API_URL).replace(/\/+$/, '')
  const response = await axios.get(base + '/search/tiktok', {
    params: { q: query },
    timeout: 10000,
    headers: {
      ...headers,
      referer: base + '/category/search'
    },
    maxContentLength: 5 * 1024 * 1024,
    validateStatus: status => status >= 200 && status < 500
  })

  if (response.status >= 400) throw new Error('NexRay HTTP ' + response.status)
  return parsePayload(response.data, 'NexRay TikTok Search')
}

function buildSearchVariants(query) {
  const original = String(query || '').trim()
  if (!original) return []

  const variants = [original]
  const normalized = original
    .replace(/[：:：_—–-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s#@]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized && normalized.toLowerCase() !== original.toLowerCase()) {
    variants.push(normalized)
  }

  const compact = original.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
  if (compact === 'rezero' || compact === 'rezeroanime') {
    variants.push(
      'Re:Zero',
      'Re:Zero anime',
      'Re Zero anime',
      'ReZero anime',
      'Re:Zero edit',
      'Re:Zero AMV',
      'Re:Zero kara Hajimeru Isekai Seikatsu'
    )
  }

  return [...new Set(variants.filter(Boolean))]
}

async function safeAttempt(provider, term, request, errors) {
  try {
    return await request(term)
  } catch (error) {
    errors.push(provider + ' "' + term + '": ' + (error?.message || String(error)))
    return []
  }
}

export async function tiktokSearch(query) {
  const original = String(query || '').trim()
  if (!original) return []

  const variants = buildSearchVariants(original)
  const errors = []

  // Query two independent sources at once so a slow or broken provider does not
  // prevent the other source from finding a popular title.
  const primary = await Promise.all([
    safeAttempt('NexRay', original, requestNexRaySearch, errors),
    safeAttempt('TikWM GET', original, term => requestTikWMSearch(term, 'get'), errors),
    safeAttempt('TikWM POST', original, term => requestTikWMSearch(term, 'post'), errors)
  ])
  let found = dedupeVideos(primary.flat())
  if (found.length) {
    console.log('[TikTok Search] ' + found.length + ' hasil ditemukan untuk "' + original + '" melalui sumber utama.')
    return found
  }

  // Try alternate spelling/query forms only when the original search has no usable results.
  for (const term of variants.slice(1)) {
    const fallback = await Promise.all([
      safeAttempt('NexRay', term, requestNexRaySearch, errors),
      safeAttempt('TikWM GET', term, value => requestTikWMSearch(value, 'get'), errors)
    ])
    found = dedupeVideos(fallback.flat())
    if (found.length) {
      console.log('[TikTok Search] ' + found.length + ' hasil ditemukan untuk "' + term + '" melalui kueri alternatif.')
      return found
    }
  }

  if (errors.length) {
    console.warn('[TikTok Search] Semua sumber bermasalah:', errors.slice(0, 6).join(' | '))
    throw new Error(
      'Layanan pencarian TikTok sedang gagal merespons. Detail: ' +
      errors.slice(0, 2).join(' | ').slice(0, 260)
    )
  }

  console.log('[TikTok Search] Tidak ada hasil untuk "' + original + '".')
  return []
}

async function resolveUrl(url) {
  // Some TikTok short-link hosts reject HEAD requests. Try GET as a fallback so
  // the resolved /photo/ vs /video/ path is preserved for the downloader.
  for (const method of ['head', 'get']) {
    try {
      const options = {
        maxRedirects: 5,
        headers: {
          ...headers,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
        },
        timeout: method === 'head' ? 10000 : 15000,
        maxContentLength: 2 * 1024 * 1024,
        validateStatus: status => status >= 200 && status < 400
      }
      const res = method === 'head'
        ? await axios.head(url, options)
        : await axios.get(url, { ...options, responseType: 'text' })
      const finalUrl = res.request?.res?.responseUrl ||
        res.request?._redirectable?._currentUrl ||
        url
      if (finalUrl) return String(finalUrl)
    } catch {
      // Try the next method; short-link endpoints may reject HEAD but permit GET.
    }
  }
  return url
}

function firstImageUrl(value, depth = 0) {
  if (depth > 5 || value == null) return ''
  if (typeof value === 'string') {
    const candidate = value.trim()
    return /^https?:\/\//i.test(candidate) ? candidate : ''
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageUrl(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  const preferred = [
    'imageURL', 'imageUrl', 'image_url', 'displayImage', 'display_image',
    'originImage', 'origin_image', 'ownerWatermarkImage', 'urlList', 'url_list',
    'originURLList', 'originUrlList', 'origin_url_list', 'downloadUrl', 'download_url',
    'url', 'src', 'uri'
  ]
  for (const key of preferred) {
    if (!(key in value)) continue
    const found = firstImageUrl(value[key], depth + 1)
    if (found) return found
  }
  return ''
}

function findPhotoImageArray(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) return []

  const keys = [
    'images', 'image_list', 'imageList', 'photo_images', 'photoImages',
    'image_urls', 'imageUrls', 'image_post_images', 'imagePostImages'
  ]
  for (const key of keys) {
    if (Array.isArray(value[key]) && value[key].length) return value[key]
  }

  const preferredNested = [
    'image_post_info', 'imagePostInfo', 'imagePost', 'image_post',
    'aweme_detail', 'awemeDetail', 'aweme_info', 'awemeInfo',
    'item_struct', 'itemStruct', 'item', 'data', 'itemInfo'
  ]
  for (const key of preferredNested) {
    const found = findPhotoImageArray(value[key], depth + 1, seen)
    if (found.length) return found
  }
  for (const [key, child] of Object.entries(value)) {
    if (preferredNested.includes(key) || keys.includes(key)) continue
    const found = findPhotoImageArray(child, depth + 1, seen)
    if (found.length) return found
  }
  return []
}

function extractPhotoImages(value) {
  const array = findPhotoImageArray(value)
  const images = array.map(entry => firstImageUrl(entry)).filter(Boolean)
  return [...new Set(images)]
}

function hasPhotoPostMarker(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return false
  seen.add(value)
  if (findPhotoImageArray(value).length) return true
  for (const key of ['imagePost', 'image_post', 'imagePostInfo', 'image_post_info']) {
    if (value[key] && typeof value[key] === 'object') return true
  }
  for (const key of ['aweme_type', 'awemeType', 'media_type', 'mediaType', 'post_type', 'postType', 'type']) {
    const marker = value[key]
    if (typeof marker === 'number' && marker === 150) return true
    if (typeof marker === 'string' && /^(photo|image|images|slideshow)$/i.test(marker.trim())) return true
  }
  return Object.values(value).some(child =>
    child && typeof child === 'object' && hasPhotoPostMarker(child, depth + 1, seen)
  )
}

function parseTikTokScriptState(html, scriptId) {
  // Both script IDs used here contain only letters, underscores and dashes.
  const pattern = "<script[^>]*id=[\"']" + scriptId + "[\"'][^>]*>([\\s\\S]*?)<\\/script>"
  const match = String(html || '').match(new RegExp(pattern, 'i'))
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}
function getTikTokItemFromHtml(html) {
  const universal = parseTikTokScriptState(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__')
  const detail = universal?.__DEFAULT_SCOPE__?.['webapp.video-detail']
  const item = detail?.itemInfo?.itemStruct
  if (item && typeof item === 'object') return item

  const sigi = parseTikTokScriptState(html, 'SIGI_STATE')
  const itemModule = sigi?.ItemModule
  if (itemModule && typeof itemModule === 'object') {
    const entries = Object.values(itemModule).filter(item => item && typeof item === 'object')
    return entries.find(entry => entry.imagePost || entry.image_post || entry.aweme_type === 150) || entries[0] || null
  }
  return null
}

// Direct-page fallback is used when TikWM omits photo metadata or returns a
// video-like URL for a slideshow. It only returns photo media when the page or
// embedded item data identifies a genuine image post.
export async function getTikTokPhotoPost(url) {
  const initial = await resolveUrl(String(url || '').trim())
  if (!/^https?:\/\//i.test(initial)) return null

  const targets = [initial]
  // TikTok sometimes gates the /photo/ web route while its video-detail page
  // still embeds the same itemStruct, including imagePost.images.
  const photoRoute = initial.match(/^(https?:\/\/www\.tiktok\.com\/@[^/?#]+)\/photo\/(\d+)/i)
  if (photoRoute) targets.push(photoRoute[1] + '/video/' + photoRoute[2])

  let lastError = null
  for (const target of [...new Set(targets)]) {
    try {
      const response = await axios.get(target, {
        timeout: 12000,
        maxRedirects: 5,
        maxContentLength: 12 * 1024 * 1024,
        responseType: 'text',
        validateStatus: status => status >= 200 && status < 400,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
          referer: 'https://www.tiktok.com/'
        }
      })
      const finalUrl = response.request?.res?.responseUrl ||
        response.request?._redirectable?._currentUrl ||
        target
      const html = typeof response.data === 'string' ? response.data : ''
      const item = getTikTokItemFromHtml(html)
      const images = extractPhotoImages(item)
      const isPhotoPost = /\/photo\/\d+/i.test(String(finalUrl)) ||
        /\/photo\/\d+/i.test(target) ||
        hasPhotoPostMarker(item)

      if (!isPhotoPost) continue
      const music = item?.music || item?.musicInfo || item?.music_info || {}
      const author = item?.author || item?.authorInfo || item?.author_info || {}
      return {
        isPhotoPost: true,
        type: 'image',
        sourceUrl: String(finalUrl || target),
        videoId: pickText(item?.aweme_id, item?.awemeId, item?.id),
        title: pickText(item?.desc, item?.title, detailCaptionFromHtml(html)) || 'TikTok Photo Post',
        authorId: pickText(author?.uniqueId, author?.unique_id, author?.username),
        author: pickText(author?.nickname, author?.nickName, author?.uniqueId, author?.unique_id) || 'Unknown',
        images,
        audio: pickText(music?.playUrl, music?.play_url, music?.play, music?.url) || null
      }
    } catch (error) {
      lastError = error
      // Try the /video/ item page if the photo page is gated or temporarily unavailable.
    }
  }
  if (lastError) throw lastError
  return null
}
function detailCaptionFromHtml(html) {
  const match = String(html || '').match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
  return match?.[1]?.replace(/&amp;/g, '&').trim() || ''
}

export async function tiktokScrape(inputUrl) {
  const resolvedUrl = await resolveUrl(String(inputUrl || '').trim())
  let r = null
  let providerError = null

  try {
    const response = await axios.get('https://www.tikwm.com/api/', {
      params: { url: resolvedUrl, hd: 1 },
      headers,
      timeout: 20000,
      maxContentLength: 8 * 1024 * 1024
    })
    r = response.data?.data || null
    if (!r) providerError = new Error('TikWM tidak mengembalikan data media.')
  } catch (error) {
    providerError = error
  }

  let images = extractPhotoImages(r)
  let isPhotoPost = hasPhotoPostMarker(r) ||
    /\/photo\/\d+/i.test(resolvedUrl) ||
    /\/photo\/\d+/i.test(String(inputUrl || ''))

  // A photo/slideshow post is a list of image URLs, not a video stream. If the
  // provider's schema changed or omitted images, inspect TikTok's embedded page
  // data before deciding whether to enter the video/FFmpeg/yt-dlp path.
  if (!images.length && (isPhotoPost || !r || providerError)) {
    try {
      const photoPage = await getTikTokPhotoPost(resolvedUrl || inputUrl)
      if (photoPage?.isPhotoPost) {
        images = photoPage.images || []
        isPhotoPost = true
        if (images.length) {
          return {
            ...photoPage,
            video: null,
            videoCandidates: [],
            audio: photoPage.audio || null
          }
        }
        // Preserve the detected media type; caller will show a photo-specific error
        // rather than trying to decode an image-post URL as H.264 video.
        return {
          ...photoPage,
          video: null,
          videoCandidates: [],
          images: []
        }
      }
    } catch (error) {
      console.warn('[TikTok] Fallback halaman foto tidak tersedia:', error?.response?.status || error?.message || error)
    }
  }

  if (!r) {
    console.error('[TikTok Scrape Error]', providerError?.response?.status || providerError?.message || providerError || 'unknown error')
    return null
  }

  // TikWM stores slideshow images in different shapes across API versions.
  // Extract from imagePost/image_post_info as well as legacy top-level images.
  const rawCandidates = [
    { label: 'HD', url: r.hdplay },
    { label: 'Standard', url: r.play },
    { label: 'Watermark fallback', url: r.wmplay }
  ]
  const seenVideoUrls = new Set()
  const videoCandidates = rawCandidates.filter(candidate => {
    if (typeof candidate.url !== 'string' || !/^https?:\/\//i.test(candidate.url)) return false
    if (seenVideoUrls.has(candidate.url)) return false
    seenVideoUrls.add(candidate.url)
    return true
  })
  const video = videoCandidates[0]?.url || null
  const audio = pickText(r.music, r.music_info?.play, r.music_info?.url, r.music_info?.play_url) || null
  const authorInfo = r.author || r.author_info || r.authorInfo || {}
  const authorId = pickText(authorInfo.unique_id, authorInfo.uniqueId, authorInfo.username).replace(/^@/, '')
  const videoId = pickText(r.id, r.aweme_id, r.awemeId, r.video_id, r.videoId)

  return {
    sourceUrl: resolvedUrl,
    authorId,
    videoId,
    type: images.length || isPhotoPost ? 'image' : 'video',
    isPhotoPost: Boolean(images.length || isPhotoPost),
    video: images.length || isPhotoPost ? null : video,
    videoCandidates: images.length || isPhotoPost ? [] : videoCandidates,
    audio,
    images,
    title: pickText(r.title, r.desc) || (isPhotoPost ? 'TikTok Photo Post' : 'TikTok Video'),
    author: pickText(authorInfo.nickname, authorInfo.unique_id, authorInfo.uniqueId) || 'Unknown'
  }
}
