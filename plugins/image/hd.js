import scraper from '@zenaveline/scraper'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileTypeFromBuffer } from 'file-type'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_URL_TIMEOUT_MS = 90000

function findImagePayload(value, depth = 0, visited = new Set()) {
  if (!value || typeof value !== 'object' || depth > 12 || visited.has(value)) return null
  visited.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImagePayload(item, depth + 1, visited)
      if (found) return found
    }
    return null
  }

  // Direct image message, including a photo whose outer message was wrapped
  // as ephemeral/view-once/document-with-caption by WhatsApp.
  if (value.imageMessage && typeof value.imageMessage === 'object') return value.imageMessage

  const wrapperKeys = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
    'message'
  ]
  for (const key of wrapperKeys) {
    const child = value[key]
    if (!child) continue
    const found = findImagePayload(child.message || child, depth + 1, visited)
    if (found) return found
  }

  // Handle protobuf wrappers that contain their useful message below another
  // key not known to this Baileys fork, while ignoring context-only fields.
  for (const [key, child] of Object.entries(value)) {
    if (['contextInfo', 'messageContextInfo', 'senderKeyDistributionMessage'].includes(key)) continue
    if (!child || typeof child !== 'object') continue
    const found = findImagePayload(child, depth + 1, visited)
    if (found) return found
  }
  return null
}

function getQuotedOrCurrentImage(message) {
  const source = message?.quoted || message
  const candidates = [
    source?.mediaMessage,
    source?.messages,
    source?.vM?.message,
    source?.message,
    source?.msg,
    message?.msg?.contextInfo?.quotedMessage,
    message?.message?.extendedTextMessage?.contextInfo?.quotedMessage,
    source
  ]

  for (const candidate of candidates) {
    const payload = findImagePayload(candidate)
    if (payload) return { source, type: 'image', payload }
  }

  // Fallback for wrappers which the current Baileys serializer exposes only as
  // an image MIME object and not as its complete raw message.
  for (const candidate of [source?.msg, source]) {
    const mime = String(candidate?.mimetype || '').toLowerCase()
    if (mime.startsWith('image/')) return { source, type: 'image', payload: candidate }
  }
  return null
}

async function replyWithoutLimit(m, conn, text) {
  m.skipLimit = true
  m.limit = false
  return conn.sendMessage(m.chat, { text }, { quoted: m, noAlvarethPreview: true })
}

async function downloadEnhancedImage(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(IMAGE_URL_TIMEOUT_MS),
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36'
    }
  })
  if (!response.ok) throw new Error('Server hasil HD mengembalikan HTTP ' + response.status + '.')

  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error('Server hasil HD mengembalikan ' + contentType + ', bukan gambar.')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('Hasil HD kosong.')
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Hasil HD melebihi batas 25 MB.')
  const type = await fileTypeFromBuffer(buffer)
  if (!type?.mime?.startsWith('image/')) throw new Error('Hasil HD bukan file gambar yang valid.')
  return { buffer, mime: type.mime, ext: type.ext }
}

let handler = async (m, { conn }) => {
  let tempFile = null

  try {
    const image = getQuotedOrCurrentImage(m)
    if (!image) {
      await replyWithoutLimit(m, conn, '❌ Gambar tidak terbaca. Kirim .hd sebagai balasan ke foto asli, bukan pesan teks atau preview tautan.')
      return
    }

    let media = null
    // Download the actual nested imageMessage payload first; quoted.download()
    // can be unavailable when Baileys wraps the quoted image as view-once/media.
    if (image.payload?.url || image.payload?.directPath) {
      try {
        media = await conn.downloadM(image.payload, 'image')
      } catch (error) {
        console.warn('[HD] Download gambar langsung gagal, mencoba quoted.download():', error?.message || error)
      }
    }
    if ((!Buffer.isBuffer(media) || !media.length) && typeof image.source?.download === 'function') {
      media = await image.source.download()
    }

    if (!Buffer.isBuffer(media) || !media.length) {
      await replyWithoutLimit(m, conn, '❌ Gagal membaca data gambar yang direply. Coba kirim ulang foto tersebut lalu reply dengan .hd.')
      return
    }
    if (media.length > MAX_IMAGE_BYTES) {
      await replyWithoutLimit(m, conn, '❌ Ukuran gambar melebihi batas 25 MB.')
      return
    }

    const inputType = await fileTypeFromBuffer(media)
    if (!inputType?.mime?.startsWith('image/')) {
      await replyWithoutLimit(m, conn, '❌ Pesan yang direply bukan file gambar yang valid.')
      return
    }

    await m.react('🕒').catch(() => {})
    const tmpDir = path.resolve('./tmp')
    await fs.mkdir(tmpDir, { recursive: true })
    tempFile = path.join(tmpDir, 'hd-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.' + inputType.ext)
    await fs.writeFile(tempFile, media)

    const result = await scraper.sharpify(tempFile, 'upscale')
    if (!result?.url || typeof result.url !== 'string' || !/^https?:\/\//i.test(result.url)) {
      throw new Error('Layanan HD tidak menghasilkan URL gambar yang valid.')
    }

    const enhanced = await downloadEnhancedImage(result.url)
    const sent = await conn.sendMessage(m.chat, {
      image: enhanced.buffer,
      mimetype: enhanced.mime,
      fileName: 'Alvareth-HD.' + enhanced.ext,
      caption: '✨ Gambar berhasil ditingkatkan kualitasnya.'
    }, { quoted: m, noAlvarethPreview: true })
    if (!sent?.key?.id) throw new Error('WhatsApp tidak mengonfirmasi pengiriman gambar HD.')

    // The handler may charge the plugin limit only after a successful result.
    m.skipLimit = false
    await m.react('✅').catch(() => {})
  } catch (error) {
    console.error('[HD] Gagal memproses gambar:', error?.stack || error)
    await m.react('❌').catch(() => {})
    await replyWithoutLimit(m, conn, '❌ Gagal meningkatkan kualitas gambar: ' + String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 350)).catch(sendError => {
      console.error('[HD] Gagal mengirim pesan error:', sendError?.message || sendError)
    })
  } finally {
    if (tempFile) await fs.unlink(tempFile).catch(() => {})
  }
}

handler.help = ['hd']
handler.tags = ['image']
handler.command = /^hd$/i
handler.limit = true
handler.register = false

export default handler
