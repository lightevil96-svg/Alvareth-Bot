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