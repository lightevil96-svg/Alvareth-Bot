import axios from 'axios'

const API_URL = 'https://www.tikwm.com/api/feed/search'
const headers = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  referer: 'https://www.tikwm.com/',
  origin: 'https://www.tikwm.com'
}

async function resolveUrl(url) {
  try {
    const res = await axios.head(url, { maxRedirects: 5, headers, timeout: 10000 })
    return res.request?.res?.responseUrl || url
  } catch {
    return url
  }
}

function unwrapVideoList(payload) {
  const candidates = [
    payload?.data?.videos,
    payload?.data?.data?.videos,
    payload?.videos,
    payload?.data?.items,
    payload?.data?.list,
    payload?.aweme_list
  ]
  return candidates.find(Array.isArray) || []
}

function normalizeVideo(v) {
  if (!v || typeof v !== 'object') return null
  const id = v.video_id || v.aweme_id || v.id
  const authorInfo = v.author || v.author_info || v.user || {}
  const username = authorInfo.unique_id || authorInfo.uniqueId || authorInfo.username || authorInfo.sec_uid || ''
  const author = authorInfo.nickname || authorInfo.nick_name || username || 'Unknown'
  const title = String(v.title || v.desc || v.description || v.video_description || 'TikTok Video').trim()
  const url = v.web_video_url || v.share_url || v.url ||
    (id && username ? `https://www.tiktok.com/@${username}/video/${id}` : '')
  if (!url || !/^https?:\/\//i.test(url)) return null
  return {
    id: String(id || ''),
    title: title || 'TikTok Video',
    author: String(author),
    url,
    cover: v.cover || v.origin_cover || v.dynamic_cover || '',
    raw: v
  }
}

async function requestTikTokSearch(query, method = 'get') {
  const common = { keywords: query, count: 30, cursor: 0, web: 1, hd: 1 }
  const options = {
    timeout: 18000,
    headers,
    maxContentLength: 5 * 1024 * 1024,
    validateStatus: status => status >= 200 && status < 500
  }

  const response = method === 'post'
    ? await axios.post(API_URL, new URLSearchParams(Object.entries(common).map(([k, v]) => [k, String(v)])), {
        ...options,
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
      })
    : await axios.get(API_URL, { ...options, params: common })

  if (response.status >= 400) throw new Error(`TikWM HTTP ${response.status}`)
  const payload = response.data
  const code = payload?.code
  const message = payload?.msg || payload?.message || payload?.status_msg || ''
  const videos = unwrapVideoList(payload).map(normalizeVideo).filter(Boolean)

  if (videos.length) return videos
  if (code !== undefined && Number(code) !== 0) {
    throw new Error(`TikWM code ${code}: ${String(message || 'request tidak berhasil').slice(0, 180)}`)
  }
  return []
}

export async function tiktokSearch(query) {
  const original = String(query || '').trim()
  if (!original) return []

  // First try GET, the normal TikWM search method. If it returns empty/fails,
  // retry as form POST; some deployments/proxies respond differently.
  const variants = [original]
  // Anime titles are often written with punctuation/spacing differently on TikTok.
  const compact = original.replace(/\s+/g, '')
  const simple = original.replace(/[：:：_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^re\s*zero$/i.test(compact) || /^re\s*zero$/i.test(simple.replace(/\s+/g, ''))) {
    variants.push('Re:Zero', 'Re:Zero anime', 'Re Zero anime')
  } else if (simple.toLowerCase() !== original.toLowerCase()) {
    variants.push(simple)
  }

  const errors = []
  for (const term of [...new Set(variants)]) {
    for (const method of ['get', 'post']) {
      try {
        const found = await requestTikTokSearch(term, method)
        if (found.length) {
          const seen = new Set()
          const unique = found.filter(video => {
            const key = video.id || video.url
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          console.log(`[TikTok Search] ${unique.length} hasil untuk "${term}" via ${method.toUpperCase()}.`)
          return unique
        }
      } catch (error) {
        errors.push(`${method.toUpperCase()} "${term}": ${error.message}`)
      }
    }
  }

  console.warn('[TikTok Search] Semua percobaan gagal:', errors.join(' | ') || 'TikWM tidak mengembalikan hasil.')
  return []
}

export async function tiktokScrape(url) {
  try {
    url = await resolveUrl(url)

    const { data } = await axios.get(
      'https://www.tikwm.com/api/',
      {
        params: { url, hd: 1 },
        headers,
        timeout: 20000
      }
    )

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
