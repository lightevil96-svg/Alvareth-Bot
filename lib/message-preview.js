const REPOSITORY_URL_PATTERN = /https?:\/\/(?:www\.)?github\.com\/lightevil96-svg\/Alvareth-Bot(?:\.git)?(?:\/[^\s<>"']*)?/gi

function isRepositoryUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value.trim())
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase()
    if ((hostname === 'github.com' || hostname === 'www.github.com') &&
        pathname === '/lightevil96-svg/alvareth-bot') return true
    return hostname === 'raw.githubusercontent.com' &&
      pathname.includes('/lightevil96-svg/alvareth-bot/')
  } catch {
    return /github\.com\/lightevil96-svg\/alvareth-bot/i.test(value) ||
      /raw\.githubusercontent\.com\/lightevil96-svg\/alvareth-bot/i.test(value)
  }
}

function cleanRepositoryText(value) {
  return value.replace(REPOSITORY_URL_PATTERN, '').replace(/[ \t]{2,}/g, ' ').trimStart()
}

function cloneAndSanitize(value, seen) {
  if (typeof value === 'string') return cleanRepositoryText(value)
  if (!value || typeof value !== 'object') return value
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value
  if (seen.has(value)) return seen.get(value)

  if (Array.isArray(value)) {
    const result = []
    seen.set(value, result)
    for (const item of value) result.push(cloneAndSanitize(item, seen))
    return result
  }

  const result = Object.assign(Object.create(Object.getPrototypeOf(value)), value)
  seen.set(value, result)

  if (typeof result.text === 'string') result.text = cleanRepositoryText(result.text)
  if (typeof result.caption === 'string') result.caption = cleanRepositoryText(result.caption)

  const originalContext = value.contextInfo
  if (originalContext && typeof originalContext === 'object') {
    const ad = originalContext.externalAdReply
    const isRepositoryPreview = ad && [
      ad.sourceUrl,
      ad.mediaUrl,
      ad.thumbnailUrl
    ].some(isRepositoryUrl)
    const context = cloneAndSanitize(originalContext, seen)
    if (isRepositoryPreview) delete context.externalAdReply
    result.contextInfo = context
  }

  const originalAd = value.externalAdReply
  if (originalAd && [
    originalAd.sourceUrl,
    originalAd.mediaUrl,
    originalAd.thumbnailUrl
  ].some(isRepositoryUrl)) {
    delete result.externalAdReply
  }

  for (const key of Object.keys(result)) {
    if (key === 'text' || key === 'caption' || key === 'contextInfo' || key === 'externalAdReply') continue
    const item = result[key]
    if (item && typeof item === 'object') result[key] = cloneAndSanitize(item, seen)
    else if (typeof item === 'string') result[key] = cleanRepositoryText(item)
  }
  return result
}

export function sanitizeBotRepositoryPreview(value) {
  return cloneAndSanitize(value, new WeakMap())
}
