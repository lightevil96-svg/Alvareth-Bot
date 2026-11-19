// TikTok Live Photo motion clips live in several payload shapes. The
// canonical one is the official LivePhotoStruct:
//
//   live_photo_info: {
//     is_live_photo: true,
//     live_photo: {
//       video: { play_addr: { url_list: [...] }, download_addr: {...} }
//       image: { ...still image, must NOT be mistaken for the clip... }
//     }
//   }
//
// Older/flatter variants expose the Video model directly on
// live_photo_info.live_photo, or on image.video / image.videoModel.
// The extractor therefore searches the whole live_photo subtree (not only
// a fixed key list) and accepts a URL as a motion clip only when it does
// not point at a still image: TikTok CDN stills carry an image extension
// (.jpeg/.png/.webp/...), while video URLs are usually extensionless or
// end in .mp4/.mov. An image URL must never be returned as a "video" —
// feeding it to the renderer produced a still MP4 labelled as moving.

const IMAGE_URL_PATTERN = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)(\?|#|$)/i

// Subtrees that only ever hold a still image (cover, thumbnail, display
// image). They are skipped in the generic walk: a still URL without an
// image extension must not win over the real clip just because its key
// comes first in the object. The motion clip itself is never stored
// under one of these keys.
const IMAGE_ONLY_KEYS = new Set([
  'image', 'display_image', 'displayImage', 'full_size_image', 'fullSizeImage',
  'origin_image', 'originImage', 'cover', 'origin_cover', 'originCover',
  'dynamic_cover', 'ai_dynamic_cover', 'thumbnail', 'thumb', 'jpegThumbnail',
  'imageURL', 'imageUrl', 'image_url'
])

// Address fields that hold a playable/downloadable media URL, in preference
// order. These are checked before a generic walk so a no-watermark clip
// wins over a watermarked play address when both exist.
const VIDEO_ADDRESS_KEYS = [
  'downloadNoWatermarkAddr', 'download_no_watermark_addr',
  'playAddr', 'play_addr', 'playAddrH264', 'play_addr_h264',
  'playAddrBytevc1', 'play_addr_bytevc1',
  'h264PlayAddr', 'h264_play_addr', 'downloadAddr', 'download_addr',
  'newDownloadAddr', 'new_download_addr',
  'urlList', 'url_list', 'url', 'uri'
]

function isVideoUrlCandidate(value) {
  if (typeof value !== 'string') return false
  const candidate = value.trim()
  if (!/^https?:\/\//i.test(candidate)) return false
  // A still image is not motion, even when it sits inside a video object
  // (cover / display image / thumbnail fields).
  if (IMAGE_URL_PATTERN.test(candidate)) return false
  return true
}

function firstVideoUrl(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value == null || seen.has(value)) return ''
  if (typeof value === 'string') {
    return isVideoUrlCandidate(value) ? value.trim() : ''
  }
  if (Array.isArray(value)) {
    seen.add(value)
    for (const item of value) {
      const found = firstVideoUrl(item, depth + 1, seen)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''
  seen.add(value)

  // Preferred address keys first, then every other key in insertion order,
  // so nested shapes such as live_photo.video.play_addr.url_list are found
  // even though no fixed key path names them. Still-image subtrees are
  // skipped so an extensionless still URL cannot win over the clip.
  const keys = Object.keys(value)
  const orderedKeys = [
    ...VIDEO_ADDRESS_KEYS.filter(key => keys.includes(key)),
    ...keys.filter(key => !VIDEO_ADDRESS_KEYS.includes(key) && !IMAGE_ONLY_KEYS.has(key))
  ]
  for (const key of orderedKeys) {
    const found = firstVideoUrl(value[key], depth + 1, seen)
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
    // The whole live_photo_info subtree: covers live_photo.video.play_addr,
    // live_photo.video.download_no_watermark_addr and any other nesting
    // TikTok uses for the clip, without naming each path.
    livePhoto,
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
