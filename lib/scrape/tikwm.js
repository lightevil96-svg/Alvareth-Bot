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
  try {
    const res = await axios.head(url, { maxRedirects: 5, headers, timeout: 10000 })
    return res.request?.res?.responseUrl || url
  } catch {
    return url
  }
}

export async function tiktokScrape(url) {
  try {
    url = await resolveUrl(url)
    const { data } = await axios.get('https://www.tikwm.com/api/', {
      params: { url, hd: 1 },
      headers,
      timeout: 20000
    })
    const r = data?.data
    if (!r) return null

    const video = r.hdplay || r.play || r.wmplay || null
    const images = Array.isArray(r.images)
      ? r.images.map(image => typeof image === 'string' ? image : image?.url || image?.display_image?.url_list?.[0]).filter(Boolean)
      : []
    const audio = r.music || r.music_info?.play || r.music_info?.url || r.music_info?.play_url || null

    return {
      type: images.length ? 'image' : 'video',
      video,
      audio,
      images,
      title: r.title || 'TikTok Video',
      author: r.author?.nickname || r.author?.unique_id || 'Unknown'
    }
  } catch (error) {
    console.error('[TikTok Scrape Error]', error?.response?.status || error?.message || error)
    return null
  }
}
