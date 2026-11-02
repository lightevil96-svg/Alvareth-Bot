// Dedicated WhatsApp progress reporter for .clip only. Uses the same message
// when Baileys supports edits and throttled plain-text fallbacks otherwise.
const MIN_UPDATE_MS = 4_000
const FALLBACK_UPDATE_MS = 25_000
const MAX_FALLBACK_MESSAGES = 8

function sanitizeDetail(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[tautan]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 170)
}

function clampPercent(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null
}

function parsePhase(percent, detail, currentMethod) {
  const text = sanitizeDetail(detail)
  const method = text.match(/^\[stage\]\s*Metode\s+(\d+\/\d+)\s*:\s*(.*)$/i)
  if (method) return { phase: 'Mencoba metode', method: method[1] + ' — ' + method[2], percent: null, detail: text, urgent: true }
  if (/^\[fallback\]/i.test(text)) return { phase: 'Mencoba metode cadangan', method: currentMethod, percent: null, detail: text, urgent: true }
  const tags = [...text.matchAll(/\[([a-z-]+)\]/gi)].map(m => m[1].toLowerCase())
  const phase = tags.includes('ffmpeg') ? 'Memotong / mengode video'
    : tags.includes('quality') ? 'Optimasi ukuran video'
    : tags.includes('download') ? 'Mengunduh video'
    : tags.includes('qbyte') ? 'Mengunduh melalui API cadangan'
    : tags.includes('stage') ? 'Persiapan / validasi'
    : /^Berhasil dengan /i.test(text) ? 'Video sudah diproses'
    : 'Memproses video'
  return {
    phase,
    method: currentMethod,
    percent: clampPercent(percent),
    detail: text.replace(/^(?:\[[a-z-]+\]\s*)+/gi, ''),
    urgent: tags.includes('stage') || tags.includes('quality') || /^Berhasil dengan /i.test(text)
  }
}

export function formatClipProgress({ jobId, range, method, phase, percent, detail, startedAt, outcome = 'running' }) {
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const time = Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 'd'
  const numeric = clampPercent(percent)
  const bar = numeric === null ? '⏳ Menunggu data persentase...' :
    '▓'.repeat(Math.round(numeric / 5)) + '░'.repeat(20 - Math.round(numeric / 5))
  const heading = outcome === 'success' ? '✅ *YOUTUBE CLIP SELESAI*'
    : outcome === 'error' ? '❌ *YOUTUBE CLIP GAGAL*'
    : '✂️ *YOUTUBE CLIP — PROGRES*'
  return [
    heading,
    '🆔 Job: ' + jobId,
    '⏱️ Potongan: ' + range,
    method ? '🔄 Metode: ' + method : null,
    '⚙️ Tahap: ' + phase,
    bar,
    numeric === null ? '📊 Persentase tahap belum tersedia' : '📊 Progres tahap: *' + numeric.toFixed(1) + '%*',
    detail ? '📝 ' + sanitizeDetail(detail) : null,
    '⌛ Waktu berjalan: ' + time,
    outcome === 'running' ? '_Persentase hanya untuk tahap aktif, bukan keseluruhan atau upload WhatsApp._' : null
  ].filter(Boolean).join('\n')
}

export function createClipProgress({ conn, chat, jobId, range, startedAt = Date.now(), updateIntervalMs = MIN_UPDATE_MS }) {
  let method = ''
  let phase = 'Memulai pemrosesan'
  let percent = null
  let detail = 'Memvalidasi permintaan dan menyiapkan downloader'
  let messageKey = null
  let lastSentAt = 0
  let lastPlainAt = 0
  let lastSentText = ''
  let editingAvailable = true
  let fallbackCount = 0
  let pending = null
  let sending = null
  let closed = false
  let finishing = false

  const render = outcome => formatClipProgress({
    jobId, range, method, phase, percent, detail, startedAt, outcome
  })

  function pump() {
    if (sending) return sending
    sending = (async () => {
      while (pending !== null) {
        const text = pending
        pending = null
        if (text === lastSentText) continue
        if (messageKey && editingAvailable) {
          try {
            await conn.sendMessage(chat, { text, edit: messageKey })
            lastSentText = text
            continue
          } catch (error) {
            editingAvailable = false
            console.warn('[CLIP:' + jobId + '] Edit pesan progres tidak didukung:', error?.message || error)
          }
        }
        if (messageKey && !finishing && (fallbackCount >= MAX_FALLBACK_MESSAGES ||
            Date.now() - lastPlainAt < FALLBACK_UPDATE_MS)) continue
        try {
          const sent = await conn.sendMessage(chat, { text })
          if (sent?.key?.id) messageKey = sent.key
          lastPlainAt = Date.now()
          if (lastSentText) fallbackCount++
          lastSentText = text
        } catch (error) {
          console.warn('[CLIP:' + jobId + '] Gagal mengirim pesan progres:', error?.message || error)
        }
      }
    })().finally(() => {
      sending = null
      if (pending !== null) void pump()
    })
    return sending
  }

  function publish(force = false, outcome = 'running') {
    if (closed) return Promise.resolve()
    const now = Date.now()
    if (!force && now - lastSentAt < updateIntervalMs) return sending || Promise.resolve()
    lastSentAt = now
    pending = render(outcome)
    return pump()
  }

  return {
    async start() {
      await publish(true)
    },
    report(value, message) {
      if (closed || finishing) return
      const next = parsePhase(value, message, method)
      if (next.method !== method) method = next.method
      phase = next.phase
      percent = next.percent
      detail = next.detail
      void publish(next.urgent)
    },
    async stage(label) {
      if (closed || finishing) return
      phase = String(label || 'Memproses')
      detail = ''
      percent = null
      await publish(true)
    },
    async finish(outcome, message) {
      if (closed) return
      finishing = true
      phase = outcome === 'success' ? 'Video berhasil dikirim ke WhatsApp' : 'Proses dihentikan'
      percent = outcome === 'success' ? 100 : null
      detail = sanitizeDetail(message)
      await publish(true, outcome === 'success' ? 'success' : 'error')
      // The publish may have been queued while another edit was in flight.
      if (sending) await sending
      closed = true
    }
  }
}
