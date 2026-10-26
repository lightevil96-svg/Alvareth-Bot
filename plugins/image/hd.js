import scraper from '@zenaveline/scraper'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileTypeFromBuffer } from 'file-type'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_URL_TIMEOUT_MS = 90000

function getQuotedOrCurrentImage(message) {
  const source = message?.quoted || message
  const mediaMessage = source?.mediaMessage

  if (mediaMessage && typeof mediaMessage === 'object') {
    const entries = Object.entries(mediaMessage)
    const imageEntry = entries.find(([type, payload]) =>
      /imageMessage/i.test(type) && payload && typeof payload === 'object'
    )
    if (imageEntry) return { source, type: 'image', payload: imageEntry[1] }
  }

  const candidates = [source?.msg, source]
  for (const payload of candidates) {
    const mime = String(payload?.mimetype || '').toLowerCase()
    if (mime.startsWith('image/')) return { source, type: 'image', payload }
  }

  const mediaType = String(source?.mediaType || source?.mtype || '').toLowerCase()
  if (mediaType.includes('image') && mediaMessage) {
    const payload = mediaMessage[Object.keys(mediaMessage)[0]]
    if (payload) return { source, type: 'image', payload }
  }

  return null
}

async function replyWithoutLimit(m, conn, text) {
  m.skipLimit = true
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

    const media = typeof image.source?.download === 'function'
      ? await image.source.download()
      : (image.payload?.url || image.payload?.directPath)
        ? await conn.downloadM(image.payload, 'image')
        : null

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
