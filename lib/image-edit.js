// Helper image gratis bersama untuk semua plugin kategori image.
// Backend edit gambar: Pollinations image (gratis, tanpa API key) dengan
// gambar referensi yang diunggah dulu ke tmp.malvryx.dev (gratis, tanpa API key).
// Backend upscale: Sharpify via @zenaveline/scraper (gratis, tanpa API key).
// Jangan tambahkan API key apa pun di sini.
//
// Akar bug .tooil (dan semua plugin image lama): deteksi gambar hanya dari
// `m.quoted.mimetype` / `(q.msg || q).mimetype`. MIME itu bisa tidak
// terbawa saat gambar dikirim dengan caption maupun saat direply, padahal
// tipe imageMessage-nya masih ada di payload Baileys mentah. Helper ini
// memakai getQuotedMediaInfo/downloadQuotedMedia dari lib/simple.js untuk
// reply, dan m.download()/conn.downloadM untuk gambar yang dikirim
// langsung dengan caption. Jangan membuat deteksi media terpisah di
// tiap plugin; pakai helper ini.

import axios from 'axios'
import FormData from 'form-data'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { buildPollinationsImageUrl, aiErrorMessage } from './ai-chat.js'
import { downloadQuotedMedia, getQuotedMediaInfo } from './simple.js'
import scraper from '@zenaveline/scraper'

export const IMAGE_EDIT_TIMEOUT_MS = 120000
export const IMAGE_UPLOAD_TIMEOUT_MS = 30000
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const IMAGE_UNAVAILABLE_MESSAGE =
  '❌ Layanan edit gambar gratis sedang tidak tersedia. Coba lagi beberapa saat lagi.'

export { aiErrorMessage }

function isHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(String(url), { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ambil buffer gambar dari pesan: reply ke gambar dulu, lalu gambar yang
 * dikirim langsung dengan caption perintah. Mengembalikan Buffer atau null
 * bila tidak ada gambar yang bisa diunduh. Jangan pernah menyimpulkan
 * "bukan gambar" hanya dari mimetype yang kosong.
 */
export async function getImageBuffer(m, conn = m?.conn) {
  // 1. Reply ke gambar: pakai helper bersama yang membaca payload mentah.
  try {
    const quoted = await downloadQuotedMedia(m, conn)
    if (Buffer.isBuffer(quoted) && quoted.length) return Buffer.from(quoted)
  } catch {}

  // 2. Gambar dikirim langsung dengan caption: pesan itu sendiri adalah gambar.
  try {
    const ownMime = String(m?.msg?.mimetype || m?.mimetype || '').toLowerCase()
    const ownType = String(m?.mtype || '')
    const isOwnImage =
      ownType === 'imageMessage' ||
      ownMime.startsWith('image/') ||
      (m?.msg && typeof m.msg === 'object' && 'imageMessage' in (m?.message || {}))
    if (isOwnImage) {
      if (typeof m?.download === 'function') {
        const buffer = await m.download()
        if (Buffer.isBuffer(buffer) && buffer.length) return Buffer.from(buffer)
      }
      if (conn && typeof conn.downloadM === 'function' && m?.msg) {
        const buffer = await conn.downloadM(m.msg, 'image')
        if (Buffer.isBuffer(buffer) && buffer.length) return Buffer.from(buffer)
      }
    }
  } catch {}

  // 3. Fallback terakhir: metode download bawaan serializer untuk reply.
  try {
    if (typeof m?.quoted?.download === 'function') {
      const buffer = await m.quoted.download()
      if (Buffer.isBuffer(buffer) && buffer.length) return Buffer.from(buffer)
    }
  } catch {}

  return null
}

/**
 * Unggah buffer gambar, mengembalikan URL publiknya.
 * Dipakai tmp.malvryx.dev (gratis, tanpa API key), sama seperti plugin
 * nano di kategori AI. uguu.se sempat dipakai, tapi upload-nya timeout
 * (>60 detik) saat diuji 2026-11-13, jadi tidak dipakai lagi.
 */
export async function uploadImageBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Gambar yang akan diunggah kosong.')
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Ukuran gambar melebihi batas 20 MB.')
  }
  const axiosImpl = options.axiosImpl || axios
  const form = new FormData()
  form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' })
  form.append('type', 'permanent')
  const { data } = await axiosImpl.post('https://tmp.malvryx.dev/upload', form, {
    headers: form.getHeaders(),
    timeout: IMAGE_UPLOAD_TIMEOUT_MS,
    maxBodyLength: MAX_IMAGE_BYTES + 1024 * 1024
  })
  const url = data?.cdnUrl || data?.directUrl
  if (!url || !isHttpUrl(url)) {
    throw new Error('Layanan upload tidak memberikan URL gambar yang valid.')
  }
  return url
}

/**
 * Edit gambar dengan Pollinations: unggah dulu, lalu minta gambar baru
 * dengan prompt + gambar referensi. Mengembalikan Buffer gambar hasil.
 * `uploadImpl`/`fetchImpl` bisa diinjeksi untuk tes.
 */
export async function editImageWithPollinations(buffer, prompt, options = {}) {
  const text = String(prompt ?? '').trim()
  if (!text) throw new Error('Prompt edit gambar tidak boleh kosong.')
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Gambar sumber kosong.')
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Ukuran gambar melebihi batas 20 MB.')
  }
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected?.mime?.startsWith('image/')) {
    throw new Error('Media yang dikirim bukan file gambar yang valid.')
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('Layanan edit gambar gratis sedang tidak tersedia.')
  }
  const uploadImpl = options.uploadImpl || uploadImageBuffer
  const imageUrl = await uploadImpl(buffer, options)
  const resultUrl = buildPollinationsImageUrl(text, {
    image: imageUrl,
    width: options.width || 1024,
    height: options.height || 1024
  })
  let response
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      resultUrl,
      { headers: { accept: 'image/*' } },
      options.timeoutMs || IMAGE_EDIT_TIMEOUT_MS
    )
  } catch (error) {
    throw new Error('Layanan edit gambar gratis sedang tidak tersedia. Coba lagi nanti.')
  }
  if (!response?.ok) {
    throw new Error('Layanan edit gambar mengembalikan HTTP ' + (response?.status ?? '?') + '.')
  }
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase()
  if (contentType && !contentType.startsWith('image/')) {
    const body = await response.text().catch(() => '')
    throw new Error('Layanan edit gambar mengembalikan respons bukan gambar: ' + body.slice(0, 200))
  }
  const result = Buffer.from(await response.arrayBuffer())
  if (!result.length) throw new Error('Layanan edit gambar mengembalikan hasil kosong.')
  const outputType = await fileTypeFromBuffer(result)
  if (!outputType?.mime?.startsWith('image/')) {
    throw new Error('Hasil edit gambar bukan file gambar yang valid.')
  }
  return result
}

/**
 * Upscale gambar dengan Sharpify (gratis, tanpa API key), dipakai .hd dan
 * .picsart. Mengembalikan Buffer gambar hasil.
 */
export async function upscaleImageBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Gambar sumber kosong.')
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Ukuran gambar melebihi batas 20 MB.')
  }
  const sharpify = options.sharpifyImpl || scraper.sharpify
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-upscale-'))
  const tmpFile = path.join(tmpDir, 'source.jpg')
  try {
    await fs.writeFile(tmpFile, buffer)
    const result = await sharpify(tmpFile, 'upscale')
    const url = result?.url
    if (!url || !isHttpUrl(url)) {
      throw new Error('Layanan upscale tidak menghasilkan URL gambar yang valid.')
    }
    const fetchImpl = options.fetchImpl || globalThis.fetch
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      { headers: { accept: 'image/*' } },
      options.timeoutMs || IMAGE_EDIT_TIMEOUT_MS
    )
    if (!response?.ok) {
      throw new Error('Gagal mengunduh hasil upscale (HTTP ' + (response?.status ?? '?') + ').')
    }
    const out = Buffer.from(await response.arrayBuffer())
    if (!out.length) throw new Error('Hasil upscale kosong.')
    const outputType = await fileTypeFromBuffer(out)
    if (!outputType?.mime?.startsWith('image/')) {
      throw new Error('Hasil upscale bukan file gambar yang valid.')
    }
    return out
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Alur lengkap satu perintah style image: ambil gambar (reply atau
 * kirim langsung dengan caption), edit dengan Pollinations, kirim hasil.
 * Limit harian hanya terpakai bila gambar berhasil dikirim.
 * Mengembalikan true bila berhasil, false bila gagal (pesan error sudah
 * dibalas ke chat).
 */
export async function runImageStyle(m, options = {}) {
  const { conn, command, prompt, usedPrefix = '.' } = options
  const style = String(command || '').toLowerCase()
  // Jangan potong limit untuk pesan pemakaian / kegagalan.
  m.skipLimit = true
  const usage = `Reply gambar dengan caption:\n${usedPrefix + style}\n\natau kirim gambar dengan caption ${usedPrefix + style}.`
  let buffer = null
  try {
    buffer = await getImageBuffer(m, conn)
  } catch (error) {
    console.error('[IMAGE] Gagal membaca gambar:', error?.message || error)
  }
  if (!buffer) {
    await m.reply(usage).catch(() => {})
    return false
  }
  try {
    await m.react('🕒').catch(() => {})
    const result = await editImageWithPollinations(buffer, prompt, options)
    const sent = await conn.sendMessage(
      m.chat,
      {
        image: result,
        caption: `✨ Berhasil mengubah gambar dengan style *${style}*.`
      },
      { quoted: m }
    )
    if (!sent?.key?.id) throw new Error('WhatsApp tidak mengonfirmasi pengiriman gambar.')
    m.skipLimit = false
    await m.react('✅').catch(() => {})
    return true
  } catch (error) {
    console.error('[IMAGE] Gagal memproses gambar:', error?.stack || error)
    await m.react('❌').catch(() => {})
    await m.reply(aiErrorMessage(error)).catch(() => {})
    return false
  }
}

/**
 * Alur lengkap satu perintah upscale (.hd / .picsart): ambil gambar,
 * upscale dengan Sharpify, kirim hasil.
 */
export async function runImageUpscale(m, options = {}) {
  const { conn, command, caption } = options
  const style = String(command || '').toLowerCase()
  m.skipLimit = true
  const usage = `Reply gambar dengan caption:\n.${style}\n\natau kirim gambar dengan caption .${style}.`
  let buffer = null
  try {
    buffer = await getImageBuffer(m, conn)
  } catch (error) {
    console.error('[IMAGE] Gagal membaca gambar:', error?.message || error)
  }
  if (!buffer) {
    await m.reply(usage).catch(() => {})
    return false
  }
  try {
    await m.react('🕒').catch(() => {})
    const result = await upscaleImageBuffer(buffer, options)
    const sent = await conn.sendMessage(
      m.chat,
      { image: result, caption: caption || '✨ Gambar berhasil ditingkatkan kualitasnya.' },
      { quoted: m }
    )
    if (!sent?.key?.id) throw new Error('WhatsApp tidak mengonfirmasi pengiriman gambar.')
    m.skipLimit = false
    await m.react('✅').catch(() => {})
    return true
  } catch (error) {
    console.error('[IMAGE] Gagal meningkatkan kualitas gambar:', error?.stack || error)
    await m.react('❌').catch(() => {})
    await m.reply(aiErrorMessage(error)).catch(() => {})
    return false
  }
}

// Dipakai tes: getQuotedMediaInfo harus mengenali reply gambar walau MIME kosong.
export { getQuotedMediaInfo }
