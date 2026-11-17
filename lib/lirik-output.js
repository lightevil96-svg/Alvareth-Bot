const SOURCE_LABELS = {
  AUDIO: 'AUDIO',
  ON_SCREEN: 'LAYAR'
}

function cleanText(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export function formatLirikTimestamp(value) {
  const totalMs = Math.max(0, Math.round((Number(value) || 0) * 1000))
  const hours = Math.floor(totalMs / 3600000)
  const minutes = Math.floor((totalMs % 3600000) / 60000)
  const seconds = Math.floor((totalMs % 60000) / 1000)
  const milliseconds = totalMs % 1000
  return String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + ',' +
    String(milliseconds).padStart(3, '0')
}

export function normalizeLirikResult(result) {
  const source = Array.isArray(result?.segments) ? result.segments : []
  const segments = source.map(item => {
    const start = Number(item?.start)
    const end = Number(item?.end)
    const text = cleanText(item?.text)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !text) return null
    const sourceType = item?.source === 'ON_SCREEN' ? 'ON_SCREEN' : 'AUDIO'
    return { start, end, text, source: sourceType }
  }).filter(Boolean).sort((a, b) => a.start - b.start || a.end - b.end)

  return {
    language: cleanText(result?.language) || 'tidak terdeteksi',
    model: cleanText(result?.model) || 'faster-whisper',
    duration: result?.duration !== null && result?.duration !== undefined &&
      Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
    segments,
    ocrError: cleanText(result?.ocr_error),
    audioError: cleanText(result?.audio_error)
  }
}

export function buildLirikText(result) {
  const normalized = normalizeLirikResult(result)
  const lines = [
    'ALVARETH — HASIL TRANSKRIP LIRIK',
    'Bahasa: ' + normalized.language,
    'Model: ' + normalized.model,
    '',
    ...normalized.segments.map(item =>
      '[' + formatLirikTimestamp(item.start).slice(0, 8) + '] [' +
      SOURCE_LABELS[item.source] + '] ' + item.text
    )
  ]
  if (!normalized.segments.length) lines.push('Tidak ada teks yang berhasil dikenali.')
  if (normalized.ocrError) lines.push('', 'Catatan OCR: ' + normalized.ocrError)
  if (normalized.audioError) lines.push('', 'Catatan audio: ' + normalized.audioError)
  return lines.join('\n') + '\n'
}

export function buildLirikSrt(result) {
  const normalized = normalizeLirikResult(result)
  return normalized.segments.map((item, index) =>
    (index + 1) + '\n' +
    formatLirikTimestamp(item.start) + ' --> ' +
    formatLirikTimestamp(item.end) + '\n' +
    '[' + SOURCE_LABELS[item.source] + '] ' + item.text
  ).join('\n\n') + (normalized.segments.length ? '\n' : '')
}
