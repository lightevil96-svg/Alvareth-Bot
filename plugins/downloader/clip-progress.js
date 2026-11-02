// Terminal-only progress reporter for the .clip command.
// This module intentionally has no WhatsApp/Baileys connection or chat API.
const MIN_PERCENT_DELTA = 5
const MIN_PROGRESS_INTERVAL_MS = 1_000
const DETAIL_INTERVAL_MS = 4_000

function elapsedSeconds(startedAt) {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
}

function clampPercent(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null
}

export function formatClipProgress({ jobId, percent, detail, startedAt = Date.now() }) {
  const numeric = clampPercent(percent)
  const elapsed = elapsedSeconds(startedAt)
  const prefix = '[CLIP:' + jobId + '] +' + elapsed + 's'
  if (numeric === null) return prefix + ' | ' + String(detail || '').trim()

  const filled = Math.max(0, Math.min(20, Math.round(numeric / 5)))
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
  return '[CLIP:' + jobId + '] [' + bar + '] ' + numeric.toFixed(1) +
    '% | +' + elapsed + 's | ' + String(detail || '').trim()
}

export function createClipProgress({ jobId, range = '', startedAt = Date.now(), logger = console }) {
  let lastPercent = -100
  let lastProgressAt = 0
  let lastSource = ''
  let lastStatus = ''

  function report(percent, detail, force = false) {
    const line = String(detail || '').trim()
    if (!line) return
    const now = Date.now()
    const numeric = clampPercent(percent)
    const transferMatch = line.match(/\\[(download|ffmpeg)\\]/i)

    if (transferMatch) {
      const source = transferMatch[1].toLowerCase()
      if (source !== lastSource || (numeric !== null && numeric < lastPercent)) {
        lastPercent = -100
        lastProgressAt = 0
        lastSource = source
      }

      if (numeric !== null) {
        if (!force && numeric < 100 &&
            numeric - lastPercent < MIN_PERCENT_DELTA &&
            now - lastProgressAt < MIN_PROGRESS_INTERVAL_MS) return
        logger.log(formatClipProgress({ jobId, percent: numeric, detail: line, startedAt }))
        lastPercent = numeric
        lastProgressAt = now
        return
      }

      if (!force && now - lastProgressAt < DETAIL_INTERVAL_MS) return
      logger.log(formatClipProgress({ jobId, percent: null, detail: line, startedAt }))
      lastProgressAt = now
      return
    }

    if (/\\[stage\\].*Metode\\s+\\d+\\/\\d+/i.test(line) ||
        /\\[quality\\].*Percobaan kompresi/i.test(line)) {
      lastPercent = -100
      lastProgressAt = 0
      lastSource = ''
    }

    if (!force && line === lastStatus) return
    logger.log(formatClipProgress({ jobId, percent: null, detail: line, startedAt }))
    lastStatus = line
  }

  return {
    start() {
      logger.log('[CLIP:' + jobId + '] Mulai YouTube Clip: ' + range)
    },
    report(percent, detail) {
      report(percent, detail)
    },
    stage(label) {
      report(null, '[stage] ' + String(label || 'Memproses'), true)
    },
    finish(outcome, message) {
      const status = outcome === 'success' ? '✓ Selesai' : '✗ Gagal'
      logger.log('[CLIP:' + jobId + '] ' + status + ' | +' +
        elapsedSeconds(startedAt) + 's | ' + String(message || '').trim())
    }
  }
}
