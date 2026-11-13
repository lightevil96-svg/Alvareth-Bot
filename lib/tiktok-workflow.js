const STANDARD_TIKTOK_QUALITIES = [2160, 1440, 1080, 720, 480, 360]

export function getTikTokOutputQualities(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return []
  const nativeResolution = Math.floor(Math.min(w, h))
  if (nativeResolution < 1) return []
  return [...new Set([
    nativeResolution,
    ...STANDARD_TIKTOK_QUALITIES.filter(value => value < nativeResolution)
  ])].sort((a, b) => b - a)
}

export function getTikTokScaleFilter(width, height, targetResolution) {
  const w = Number(width)
  const h = Number(height)
  const target = Number(targetResolution)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new TypeError('Dimensi video sumber tidak valid.')
  }
  if (!Number.isFinite(target) || target <= 0) {
    throw new TypeError('Resolusi output TikTok tidak valid.')
  }
  const selected = Math.min(Math.floor(target), Math.floor(Math.min(w, h)))
  if (selected < 1) throw new RangeError('Resolusi output TikTok terlalu kecil.')
  return "scale=w='if(gte(iw,ih),-2,min(iw," + selected + "))':h='if(gte(iw,ih),min(ih," + selected + "),-2)',setsar=1,format=yuv420p"
}

// Tombol "Salin Caption" di hasil .tiktok: caption asli video disalin ke
// clipboard lewat tombol cta_copy, jadi pengguna tidak perlu memblokir
// teks manual. Teks salinan dipertahankan apa adanya (hanya trim dan
// batas aman 4000 karakter); tampilan dipotong di 2000 karakter.
const TIKTOK_CAPTION_COPY_MAX_CHARS = 4000
const TIKTOK_CAPTION_DISPLAY_MAX_CHARS = 2000

export function buildTikTokCaptionCopy(title) {
  const text = String(title || '').trim()
  if (!text) return null
  const copyText = text.length > TIKTOK_CAPTION_COPY_MAX_CHARS
    ? text.slice(0, TIKTOK_CAPTION_COPY_MAX_CHARS - 3).trimEnd() + '...'
    : text
  const displayText = text.length > TIKTOK_CAPTION_DISPLAY_MAX_CHARS
    ? text.slice(0, TIKTOK_CAPTION_DISPLAY_MAX_CHARS - 3).trimEnd() + '...'
    : text
  return { displayText, copyText }
}

export function buildTikTokCaptionCopyButton(copyText) {
  return {
    name: 'cta_copy',
    buttonParamsJson: JSON.stringify({
      display_text: '📋 Salin Caption',
      copy_code: String(copyText || '')
    })
  }
}

export function buildTikTokVideoMenuButtons({ url, usedPrefix, sourceInfo, caption }) {
  const qualities = getTikTokOutputQualities(sourceInfo?.width, sourceInfo?.height)
  if (!qualities.length) return []

  const rows = qualities.map((resolution, index) => ({
    header: '',
    title: resolution + 'p' + (index === 0 ? ' • Tertinggi' : ''),
    description: 'Render ulang MP4 pada resolusi ' + resolution + 'p',
    id: usedPrefix + 'ttquality ' + url + ' ' + resolution
  }))
  const buttons = [{
    text: 'Pilih Kualitas',
    sections: [{ title: 'Resolusi tersedia', rows }],
    icon: 'video'
  }]
  const captionCopy = buildTikTokCaptionCopy(caption)
  if (captionCopy) buttons.push(buildTikTokCaptionCopyButton(captionCopy.copyText))
  return buttons
}

export function parseTikTokSlideDurations(value, imageCount) {
  if (!Number.isInteger(imageCount) || imageCount < 1) {
    throw new RangeError('Jumlah foto slideshow tidak valid.')
  }
  const entries = Array.isArray(value)
    ? value
    : String(value ?? '').trim().split(/[,\s;]+/).filter(Boolean)
  if (entries.length !== imageCount) {
    throw new RangeError('Jumlah durasi harus sama dengan jumlah foto (' + imageCount + ').')
  }
  const durations = entries.map(entry => Number(entry))
  if (durations.some(value => !Number.isInteger(value) || value < 1 || value > 60)) {
    throw new RangeError('Setiap durasi foto harus berupa bilangan bulat 1–60 detik.')
  }
  const total = durations.reduce((sum, value) => sum + value, 0)
  if (total > 300) {
    throw new RangeError('Total durasi slideshow maksimal 300 detik.')
  }
  return durations
}