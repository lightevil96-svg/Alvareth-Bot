// Helper AI gratis bersama untuk semua plugin kategori AI.
// Backend utama: Pollinations text (gratis, tanpa API key).
// Cadangan: Nexray Claude (gratis, tanpa API key).
// Jangan tambahkan API key apa pun di sini.

export const AI_TIMEOUT_MS = 20000
export const AI_UNAVAILABLE_MESSAGE =
  '❌ Layanan AI gratis sedang tidak tersedia. Coba lagi beberapa saat lagi.'

export function aiErrorMessage(error) {
  const message = String(error?.message || error || '').trim()
  if (!message) return AI_UNAVAILABLE_MESSAGE
  if (/tidak tersedia|timeout|timed out|abort|network|fetch failed|EAI_AGAIN|ECONNRESET|ENOTFOUND/i.test(message)) {
    return AI_UNAVAILABLE_MESSAGE
  }
  return '❌ Gagal mendapatkan jawaban AI.\n' + message.slice(0, 300)
}

function buildPollinationsUrl(prompt, system) {
  const url = new URL('https://text.pollinations.ai/' + encodeURIComponent(prompt))
  if (system && String(system).trim()) {
    url.searchParams.set('system', String(system))
  }
  return url
}

function extractNexrayResult(json) {
  if (!json || typeof json !== 'object') return ''
  const result = json.result ?? json.answer ?? json.response ?? json.text ?? ''
  return typeof result === 'string' ? result.trim() : ''
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(String(url), { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tanyakan ke AI gratis. Mencoba Pollinations dulu, lalu Nexray Claude
 * bila Pollinations gagal atau mengembalikan jawaban kosong.
 * `system` dipakai sebagai system prompt di Pollinations; di Nexray yang
 * tidak punya parameter system, system prompt digabung ke teks.
 * Melempar Error bila kedua backend gagal.
 */
export async function askFreeAi(prompt, options = {}) {
  const text = String(prompt ?? '').trim()
  if (!text) throw new Error('Teks untuk AI tidak boleh kosong.')
  const system = typeof options.system === 'string' ? options.system.trim() : ''
  const timeoutMs = Number(options.timeoutMs) || AI_TIMEOUT_MS
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('Layanan AI gratis sedang tidak tersedia.')
  }

  const errors = []

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      buildPollinationsUrl(text, system),
      timeoutMs
    )
    if (response?.ok) {
      const answer = String(await response.text() || '').trim()
      if (answer) return answer
      errors.push(new Error('Pollinations mengembalikan jawaban kosong.'))
    } else {
      errors.push(new Error('Pollinations gagal (HTTP ' + (response?.status ?? '?') + ').'))
    }
  } catch (error) {
    errors.push(error)
  }

  try {
    const fallbackPrompt = system ? system + '\n\n' + text : text
    const url = new URL('https://api.nexray.eu.cc/ai/claude')
    url.searchParams.set('text', fallbackPrompt)
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs)
    if (response?.ok) {
      const json = await response.json().catch(() => null)
      const answer = extractNexrayResult(json)
      if (answer) return answer
      errors.push(new Error('Nexray mengembalikan jawaban kosong.'))
    } else {
      errors.push(new Error('Nexray gagal (HTTP ' + (response?.status ?? '?') + ').'))
    }
  } catch (error) {
    errors.push(error)
  }

  console.error('[AI] Semua backend AI gratis gagal:', errors.map(e => String(e?.message || e)).join(' | '))
  throw new Error('Layanan AI gratis sedang tidak tersedia. Coba lagi nanti.')
}

/** Bangun URL gambar Pollinations (gratis, tanpa API key). */
export function buildPollinationsImageUrl(prompt, options = {}) {
  const text = String(prompt ?? '').trim()
  if (!text) throw new Error('Prompt gambar tidak boleh kosong.')
  const url = new URL('https://image.pollinations.ai/prompt/' + encodeURIComponent(text))
  url.searchParams.set('width', String(Number(options.width) || 1024))
  url.searchParams.set('height', String(Number(options.height) || 1024))
  url.searchParams.set('model', String(options.model || 'flux'))
  url.searchParams.set('nologo', 'true')
  if (options.enhance !== false) url.searchParams.set('enhance', 'true')
  if (options.seed !== undefined && options.seed !== null && options.seed !== '') {
    url.searchParams.set('seed', String(options.seed))
  }
  if (options.image) url.searchParams.set('image', String(options.image))
  return String(url)
}
