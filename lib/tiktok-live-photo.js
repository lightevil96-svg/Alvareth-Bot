function firstVideoUrl(value, depth = 0) {
  if (depth > 7 || value == null) return ''
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
    'playAddr', 'play_addr', 'playAddrH264', 'play_addr_h264',
    'playAddrBytevc1', 'play_addr_bytevc1',
    'h264PlayAddr', 'downloadAddr', 'download_addr',
    'newDownloadAddr', 'new_download_addr',
    'urlList', 'url_list', 'url', 'uri'
  ]
  for (const key of preferred) {
    if (!(key in value)) continue
    const found = firstVideoUrl(value[key], depth + 1)
    if (found) return found
  }
  return ''
}

// TikTok exposes the motion clip either through live_photo_info.live_photo
// (the official LivePhotoStruct -> Video model) or directly on image.video
// in some photo-post payload variants.
export function extractTikTokLivePhotoVideoUrl(image) {
  if (!image || typeof image !== 'object') return null

  const livePhoto = image.livePhotoInfo || image.live_photo_info ||
    image.livePhotoStruct || image.live_photo_struct
  const liveFlag = livePhoto?.isLivePhoto ?? livePhoto?.is_live_photo
  const clipType = image.clipType ?? image.clip_type

  // clip_type=2 explicitly marks a still image. Do not mistake its other
  // metadata for motion, and never override an explicit non-Live flag.
  if (liveFlag === false || clipType === 2) return null

  const candidates = [
    livePhoto?.videoModel,
    livePhoto?.video_model,
    livePhoto?.livePhoto,
    livePhoto?.live_photo,
    livePhoto?.video,
    image.videoModel,
    image.video_model,
    image.video
  ]
  for (const candidate of candidates) {
    const url = firstVideoUrl(candidate)
    if (url) return url
  }
  return null
}
