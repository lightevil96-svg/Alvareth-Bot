// Build a safe metadata-only handoff when TikWM cannot provide media URLs.
// The downloader can use the canonical permalink with its embed/yt-dlp fallbacks.
function hasCanonicalTikTokMediaRoute(value) {
  try {
    const url = new URL(String(value || '').trim())
    const host = url.hostname.toLowerCase()
    return (host === 'tiktok.com' || host.endsWith('.tiktok.com')) &&
      /\/(?:video|photo)\/\d{10,25}(?:\/|$)/i.test(url.pathname)
  } catch {
    return false
  }
}

export function buildTikTokProviderFallback(sourceUrl) {
  let parsed
  try {
    parsed = new URL(String(sourceUrl || '').trim())
  } catch {
    return null
  }

  if (!hasCanonicalTikTokMediaRoute(parsed.toString())) return null
  const match = parsed.pathname.match(/\/(video|photo)\/(\d{10,25})(?:\/|$)/i)
  if (!match) return null

  const isPhotoPost = match[1].toLowerCase() === 'photo'
  return {
    sourceUrl: parsed.toString(),
    videoId: match[2],
    title: isPhotoPost ? 'TikTok Photo Post' : 'TikTok Video',
    author: 'Unknown',
    caption: '',
    type: isPhotoPost ? 'image' : 'video',
    isPhotoPost,
    video: null,
    videoCandidates: [],
    audio: null,
    images: [],
    liveVideos: [],
    providerFallback: true
  }
}
