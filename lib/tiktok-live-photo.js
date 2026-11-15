function firstVideoUrl(value, depth = 0) {
  if (depth > 6 || value == null) return ''
  if (typeof value === 'string') {
    const candidate = value.trim()
    return /^https?:\/\//i.test(candidate) ? candidate : ''
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstVideoUrl(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  const preferred = [
    'downloadNoWatermarkAddr', 'download_no_watermark_addr',
    'playAddr', 'play_addr',
    'h264PlayAddr', 'play_addr_h264',
    'downloadAddr', 'download_addr',
    'urlList', 'url_list', 'url', 'uri'
  ]
  for (const key of preferred) {
    if (!(key in value)) continue
    const found = firstVideoUrl(value[key], depth + 1)
    if (found) return found
  }
  return ''
}

// A TikTok Live Photo keeps its motion clip separately from the still image.
export function extractTikTokLivePhotoVideoUrl(image) {
  const livePhoto = image?.livePhotoInfo || image?.live_photo_info ||
    image?.livePhotoStruct || image?.live_photo_struct
  if (!livePhoto || typeof livePhoto !== 'object') return null
  if (livePhoto.isLivePhoto === false || livePhoto.is_live_photo === false) return null

  const videoModel = livePhoto.videoModel || livePhoto.video_model ||
    livePhoto.livePhoto || livePhoto.live_photo || livePhoto.video
  return firstVideoUrl(videoModel) || null
}
