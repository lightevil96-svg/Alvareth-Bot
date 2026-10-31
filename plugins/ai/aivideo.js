/**
 * AI Video Generator — text-to-video dan image-to-video melalui model gratis FreeTheAI.
 *
 * Persyaratan:
 * - FREETHEAI_API_KEY: API key akun FreeTheAI.
 * - FREETHEAI_VIDEO_MODEL: ID model gratis dengan prefix fta/ yang mendukung video.
 *
 * Model gratis tetap memiliki kuota harian, antrean, dan batas provider.
 */
import fetch from 'node-fetch'
import { fileTypeFromBuffer } from 'file-type'

const API_BASE = 'https://api.freetheai.org'
const REQUEST_TIMEOUT_MS = 45000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_BYTES = 45 * 1024 * 1024
const MAX_GENERATION_MS = 15 * 60 * 1000
const POLL_INTERVAL_MS = 5000

function getConfig() {
  const apiKey = String(process.env.FREETHEAI_API_KEY || '').trim()
  const model = String(process.env.FREETHEAI_VIDEO_MODEL || '').trim()
  if (!apiKey) {
    throw new Error('API key belum dipasang. Tambahkan FREETHEAI_API_KEY di file .env.')
  }
  if (!model) {
    throw new Error('Model video belum dipilih. Tambahkan FREETHEAI_VIDEO_MODEL di .env dengan ID model gratis berawalan fta/.')
  }
  if (!model.startsWith('fta/')) {
    throw new Error('Model ditolak: fitur ini hanya mengizinkan model gratis FreeTheAI berawalan fta/.')
  }
  return { apiKey, model }
}

async function request(url, options = {}, label = 'FreeTheAI', timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: '*/*',
        ...(options.headers || {})
      }
    })
    return response
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new Error(label + ' timeout setelah ' + Math.round(timeout / 1000) + ' detik.')
    }
    throw new Error('Tidak dapat menghubungi ' + label + ': ' + (error?.message || error))
  } finally {
    clearTimeout(timer)
  }
}

async function readError(response) {
  const body = await response.text().catch(() => '')
  let message = body
  try {
    const json = JSON.parse(body)
    message = json?.error?.message || json?.message || body
  } catch { /* body bukan JSON */ }
  const status = response.status
  if (status === 401) return 'API key FreeTheAI tidak valid atau sudah dicabut.'
  if (status === 403) return 'Akses ditolak. Verifikasi email, lakukan daily check-in FreeTheAI hari ini, dan pastikan API key mengizinkan model tersebut.'
  if (status === 402) return 'Rute model meminta saldo berbayar. Pastikan FREETHEAI_VIDEO_MODEL benar-benar model gratis berawalan fta/.'
  if (status === 404) return 'Model atau task tidak ditemukan. Periksa ID model video di .env.'
  if (status === 413) return 'Ukuran gambar/request terlalu besar untuk gateway.'
  if (status === 429) return 'Kuota gratis atau batas antrean hari ini tercapai. Coba lagi setelah kuota tersedia.'
  if (status === 503) return 'Model sedang penuh atau layanan sementara tidak tersedia. Coba lagi nanti.'
  return 'FreeTheAI HTTP ' + status + ': ' + String(message).slice(0, 500)
}

async function apiJson(url, apiKey, options = {}, label = 'FreeTheAI') {
  const response = await request(url, {
    ...options,
    headers: {
      authorization: 'Bearer ' + apiKey,
      ...(options.headers || {})
    }
  }, label)
  if (!response.ok) throw new Error(await readError(response))
  try {
    return await response.json()
  } catch {
    throw new Error(label + ' mengirim respons JSON yang tidak valid.')
  }
}

function findImageMessage(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) return null
  seen.add(value)
  if (value.imageMessage) return value.imageMessage
  for (const key of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage', 'message']) {
    const child = value[key]
    if (!child) continue
    const found = findImageMessage(child.message || child, depth + 1, seen)
    if (found) return found
  }
  for (const [key, child] of Object.entries(value)) {
    if (['contextInfo', 'messageContextInfo', 'senderKeyDistributionMessage'].includes(key)) continue
    if (child && typeof child === 'object') {
      const found = findImageMessage(child, depth + 1, seen)
      if (found) return found
    }
  }
  return null
}

async function getImageData(m, conn) {
  const quoted = m.quoted || null
  const raw = m?.rawMessage?.message || m?.message
  const imageMessage = findImageMessage(raw) || findImageMessage(
    quoted?.mediaMessage || quoted?.message || quoted?.msg || quoted?.rawMessage || quoted
  )
  if (!imageMessage) return null

  let buffer = null
  if (typeof quoted?.download === 'function') {
    try { buffer = await quoted.download() } catch { /* coba downloader socket */ }
  }
  if ((!Buffer.isBuffer(buffer) || !buffer.length) && typeof conn.downloadM === 'function') {
    buffer = await conn.downloadM(imageMessage, 'image')
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Foto reply ditemukan, tetapi gagal diunduh dari WhatsApp.')
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Ukuran foto maksimal 5 MB untuk menjaga request tetap di bawah batas gateway gratis.')
  }
  const type = await fileTypeFromBuffer(buffer)
  if (!type?.mime?.startsWith('image/')) throw new Error('Media yang direply bukan file gambar valid.')
  return 'data:' + type.mime + ';base64,' + buffer.toString('base64')
}

async function waitForVideo(taskId, apiKey, m) {
  const deadline = Date.now() + MAX_GENERATION_MS
  let lastProgress = -1
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    const task = await apiJson(
      API_BASE + '/v1/videos/' + encodeURIComponent(taskId),
      apiKey,
      {},
      'status video'
    )
    const status = String(task?.status || '').toLowerCase()
    const progress = Number(task?.progress)
    if (Number.isFinite(progress) && progress !== lastProgress) {
      lastProgress = progress
      console.log('[AIVIDEO] task=' + taskId + ' status=' + status + ' progress=' + progress + '%')
    }
    if (status === 'failed' || status === 'error' || task?.error) {
      const detail = task?.error?.message || task?.error || 'Provider gagal membuat video.'
      throw new Error('Generasi video gagal: ' + String(detail).slice(0, 400))
    }
    if (status === 'completed' || status === 'succeeded' || status === 'success') return task
    if (!['queued', 'pending', 'in_progress', 'processing', 'running', ''].includes(status)) {
      throw new Error('Status task video tidak dikenal: ' + status)
    }
    if (m?.chat) {
      // Progress is logged to terminal to avoid flooding the WhatsApp chat.
    }
  }
  throw new Error('Generasi video melewati batas tunggu 15 menit. Task dihentikan dari sisi bot; cek status layanan dan coba lagi nanti.')
}

async function downloadVideo(taskId, apiKey, task) {
  const candidates = [
    API_BASE + '/v1/videos/' + encodeURIComponent(taskId) + '/content',
    task?.content_url
  ].filter(Boolean)
  let lastError
  for (const url of candidates) {
    try {
      const response = await request(url, {
        headers: { authorization: 'Bearer ' + apiKey }
      }, 'download hasil video', 90000)
      if (!response.ok) {
        lastError = await readError(response)
        continue
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) throw new Error('File video hasil kosong.')
      if (buffer.length > MAX_VIDEO_BYTES) {
        throw new Error('Ukuran video melebihi batas kirim WhatsApp 45 MB.')
      }
      const type = await fileTypeFromBuffer(buffer)
      const mime = type?.mime || String(response.headers.get('content-type') || '').split(';')[0]
      if (!mime.startsWith('video/')) throw new Error('Hasil provider bukan file video valid (' + (mime || 'unknown') + ').')
      return { buffer, mime, ext: type?.ext || 'mp4' }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Gagal mengunduh video hasil generasi.')
}

const handler = async (m, { conn, text, command }) => {
  const prompt = String(text || '').trim()
  if (!prompt) {
    return m.reply(
      '*🎬 AI VIDEO GENERATOR GRATIS*\n\n' +
      'Text-to-video:\n.aivideo seekor kucing berjalan di taman saat golden hour, cinematic\n\n' +
      'Image-to-video:\nReply foto dengan caption:\n.aivideo kamera bergerak perlahan, rambut dan pakaian tertiup angin\n\n' +
      'Durasi dan resolusi mengikuti model gratis yang dipilih. Maksimal prompt 2.000 karakter.'
    )
  }
  if (prompt.length > 2000) return m.reply('Prompt maksimal 2.000 karakter.')

  const { apiKey, model } = getConfig()
  const startedAt = Date.now()
  await m.react('🎬').catch(() => {})
  const image = await getImageData(m, conn)
  await m.reply(
    '⏳ *AI Video Generator dimulai*\n' +
    'Mode: ' + (image ? 'Image-to-Video' : 'Text-to-Video') + '\n' +
    'Model: ' + model + '\n' +
    'Proses dapat memerlukan beberapa menit karena memakai antrean GPU gratis.'
  )

  console.log('[AIVIDEO] start mode=' + (image ? 'image-to-video' : 'text-to-video') + ' model=' + model)
  const body = {
    model,
    prompt,
    seconds: '5',
    size: '720x1280'
  }
  if (image) body.input_reference = image

  const created = await apiJson(API_BASE + '/v1/videos', apiKey, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }, 'pembuatan task video')

  const taskId = String(created?.id || '')
  if (!taskId) throw new Error('Provider tidak mengembalikan ID task video.')
  console.log('[AIVIDEO] task created id=' + taskId + ' status=' + (created.status || 'unknown'))

  const completed = ['completed', 'succeeded', 'success'].includes(String(created.status || '').toLowerCase())
    ? created
    : await waitForVideo(taskId, apiKey, m)

  const output = await downloadVideo(taskId, apiKey, completed)
  await conn.sendMessage(m.chat, {
    video: output.buffer,
    mimetype: output.mime,
    fileName: 'Alvareth-AI-Video.' + output.ext,
    caption: '✅ *Video berhasil dibuat!*\nMode: ' + (image ? 'Image-to-Video' : 'Text-to-Video') +
      '\nModel: ' + model + '\nWaktu proses: ' + Math.ceil((Date.now() - startedAt) / 1000) + ' detik'
  }, { quoted: m })
  await m.react('✅').catch(() => {})
  console.log('[AIVIDEO] success task=' + taskId + ' bytes=' + output.buffer.length)
}

handler.help = ['aivideo <prompt>']
handler.tags = ['ai']
handler.command = /^(aivideo|text2video|img2video)$/i
handler.limit = false

export default handler
