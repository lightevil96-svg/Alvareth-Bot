// Helper image gratis bersama untuk semua plugin kategori image.
// Backend edit gambar: AI Horde img2img (gratis, tanpa API key, tanpa
// daftar — kunci anonim 0000000000). Backend upscale: Sharpify via
// @zenaveline/scraper (gratis, tanpa API key).
// Jangan tambahkan API key apa pun di sini.
//
// KENAPA BUKAN POLLINATIONS: Pollinations image di API gratis (Classic)
// BUKAN edit gambar sungguhan. Parameter `image` diabaikan: lima model
// berbeda (gptimage, klein, sana, turbo, zimage) mengembalikan byte
// IDENTIK untuk prompt yang sama, dan model edit sungguhan (kontext,
// seedream, nanobanana) mengembalikan 403 "bukan bagian dari Classic API,
// pakai pollen key". Akibatnya `.tooil` menghasilkan gambar baru dari
// prompt saja — subjek, pose, dan pakaian asli hilang, bahkan bisa
// berubah jadi telanjang — plus watermark pollinations.ai (nologo hanya
// untuk pengguna terdaftar). Jangan kembalikan Pollinations untuk edit.
//
// Akar bug .tooil (dan semua plugin image lama): deteksi gambar hanya dari
// `m.quoted.mimetype` / `(q.msg || q).mimetype`. MIME itu bisa tidak
// terbawa saat gambar dikirim dengan caption maupun saat direply, padahal
// tipe imageMessage-nya masih ada di payload Baileys mentah. Helper ini
// memakai getQuotedMediaInfo/downloadQuotedMedia dari lib/simple.js untuk
// reply, dan m.download()/conn.downloadM untuk gambar yang dikirim
// langsung dengan caption. Jangan membuat deteksi media terpisah di
// tiap plugin; pakai helper ini.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import { aiErrorMessage } from './ai-chat.js'
import { downloadQuotedMedia, getQuotedMediaInfo } from './simple.js'
import scraper from '@zenaveline/scraper'

export const IMAGE_EDIT_TIMEOUT_MS = 120000
export const IMAGE_HORDE_TIMEOUT_MS = 300000
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const IMAGE_UNAVAILABLE_MESSAGE =
  '❌ Layanan edit gambar gratis sedang tidak tersedia. Coba lagi beberapa saat lagi.'

export { aiErrorMessage }

const HORDE_API = 'https://aihorde.net/api/v2'
const HORDE_HEADERS = {
  'Content-Type': 'application/json',
  apikey: '0000000000',
  'Client-Agent': 'Alvareth-Bot:1.0:light',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36'
}

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

// AI Horde anonim dibatasi 512px (maks 580px saat ramai) dan ukuran harus
// kelipatan 64. Kecilkan sumber ke JPEG max 512px dengan rasio dipertahankan.
async function prepareSourceImage(buffer, options = {}) {
  if (options.prepareImpl) return options.prepareImpl(buffer)
  const meta = await sharp(buffer).metadata()
  const width = Number(meta.width) || 512
  const height = Number(meta.height) || 512
  const scale = Math.min(1, 512 / Math.max(width, height))
  const round64 = (value) => Math.max(64, Math.round((value * scale) / 64) * 64)
  const targetWidth = round64(width)
  const targetHeight = round64(height)
  const resized = await sharp(buffer)
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .jpeg({ quality: 85 })
    .toBuffer()
  return { buffer: resized, width: targetWidth, height: targetHeight }
}

/**
 * Edit gambar dengan AI Horde img2img: gambar sumber benar-benar dipakai
 * sebagai dasar, jadi subjek, pose, dan pakaian asli dipertahankan —
 * beda dengan Pollinations yang menggambar ulang dari prompt saja.
 * denoising 0.35 dipilih dari uji A/B 2026-11-13: SD1.5 denoising 0.5
 * mengubah wajah karakter anime jadi orang lain (wajah semi-realistis),
 * dan model anime 526Mix-Animated denoising 0.45 juga mengubah wajah
 * (mata lebih tajam, bibir merah) plus gaya terlalu kuat; SD1.5
 * denoising 0.35 + negative prompt paling setia pada karakter asli
 * dengan gaya lukisan yang masih terlihat. Mengembalikan Buffer JPEG
 * hasil. `fetchImpl` bisa diinjeksi untuk tes.
 *
 * Soal nsfw: true / censor_nsfw: false — classifier NSFW di worker SFW
 * AI Horde memberi false positive pada potret (2 dari 2 uji: potret
 * wanita berpakaian dan anime girl disensor sebagai NSFW), sehingga
 * fitur ini tidak bisa dipakai bila censor aktif. img2img dengan
 * denoising 0.5 tetap dekat dengan gambar sumber milik pengguna sendiri,
 * dan prompt tidak pernah meminta ketelanjangan — selalu ditambah
 * "fully clothed". Jangan pernah mengirim prompt yang meminta NSFW.
 */
export async function editImageWithAiHorde(buffer, prompt, options = {}) {
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
  const fullPrompt =
    text +
    ', keep the same subject, face, character design and art style, same pose, outfit and composition as the input image, the person stays fully clothed'
  const negativePrompt =
    'different person, different face, different character, realistic face, photorealistic, 3d render, western cartoon, blurry, deformed, extra limbs'
  const source = await prepareSourceImage(buffer, options)
  const timeoutMs = options.timeoutMs || IMAGE_HORDE_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? 10000

  let submit
  try {
    submit = await fetchWithTimeout(
      fetchImpl,
      HORDE_API + '/generate/async',
      {
        method: 'POST',
        headers: HORDE_HEADERS,
        body: JSON.stringify({
          prompt: fullPrompt,
          params: {
            width: source.width,
            height: source.height,
            steps: 25,
            cfg_scale: 7,
            denoising_strength: 0.35,
            sampler_name: 'k_euler_a',
            n: 1,
            negative_prompt: negativePrompt
          },
          source_image: source.buffer.toString('base64'),
          source_processing: 'img2img',
          models: ['stable_diffusion'],
          nsfw: true,
          censor_nsfw: false,
          r2: true
        })
      },
      60000
    )
  } catch (error) {
    throw new Error('Layanan edit gambar gratis sedang tidak tersedia. Coba lagi nanti.')
  }
  if (!submit?.ok) {
    const body = await submit?.text?.().catch(() => '')
    throw new Error(
      'Layanan edit gambar mengembalikan HTTP ' +
        (submit?.status ?? '?') +
        ': ' +
        String(body || '').slice(0, 200)
    )
  }
  const job = await submit.json().catch(() => null)
  const jobId = job?.id
  if (!jobId) throw new Error('Layanan edit gambar tidak memberikan ID pekerjaan.')

  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs)
    let check
    try {
      check = await fetchWithTimeout(
        fetchImpl,
        HORDE_API + '/generate/check/' + jobId,
        { headers: HORDE_HEADERS },
        30000
      )
    } catch {
      continue
    }
    if (!check?.ok) continue
    const status = await check.json().catch(() => null)
    if (!status) continue
    if (status.faulted) throw new Error('Layanan edit gambar gagal memproses gambar.')
    if (status.done) break
  }

  let result
  try {
    result = await fetchWithTimeout(
      fetchImpl,
      HORDE_API + '/generate/status/' + jobId,
      { headers: HORDE_HEADERS },
      30000
    )
  } catch (error) {
    throw new Error('Layanan edit gambar gratis sedang tidak tersedia. Coba lagi nanti.')
  }
  if (!result?.ok) {
    throw new Error('Layanan edit gambar mengembalikan HTTP ' + (result?.status ?? '?') + '.')
  }
  const payload = await result.json().catch(() => null)
  const imageUrl = payload?.generations?.[0]?.img
  if (!imageUrl || !isHttpUrl(imageUrl)) {
    throw new Error('Layanan edit gambar tidak menghasilkan gambar. Antrean mungkin habis waktu — coba lagi.')
  }
  let imageResponse
  try {
    imageResponse = await fetchWithTimeout(
      fetchImpl,
      imageUrl,
      { headers: { accept: 'image/*' } },
      60000
    )
  } catch (error) {
    throw new Error('Gagal mengunduh hasil edit gambar.')
  }
  if (!imageResponse?.ok) {
    throw new Error('Gagal mengunduh hasil edit gambar (HTTP ' + (imageResponse?.status ?? '?') + ').')
  }
  let out = Buffer.from(await imageResponse.arrayBuffer())
  if (!out.length) throw new Error('Layanan edit gambar mengembalikan hasil kosong.')
  const outputType = await fileTypeFromBuffer(out)
  if (!outputType?.mime?.startsWith('image/')) {
    throw new Error('Hasil edit gambar bukan file gambar yang valid.')
  }
  // AI Horde mengembalikan WebP; WhatsApp menerima JPEG dengan lebih baik.
  if (outputType.mime === 'image/webp') {
    out = await sharp(out).jpeg({ quality: 90 }).toBuffer()
  }
  return out
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
 * kirim langsung dengan caption), edit dengan AI Horde img2img, kirim
 * hasil. Antrean AI Horde gratis bisa 1–5 menit, jadi pengguna diberi
 * tahu dulu. Limit harian hanya terpakai bila gambar berhasil dikirim.
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
    await m
      .reply('⏳ Sedang memproses gambar dengan AI gratis... Antrean bisa 1–5 menit, mohon tunggu.')
      .catch(() => {})
    const result = await editImageWithAiHorde(buffer, prompt, options)
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
