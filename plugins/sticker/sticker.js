import { getQuotedStanzaId, resolveQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'
import { createStickerFromBuffer, stickerLimits } from './sticker-engine.js'

let handler = async (m, { conn, args = [], usedPrefix = '.', command = 's' }) => {
  let stage = 'membaca pesan'
  let mediaType = ''
  let mime = ''
  let inputBytes = 0

  const react = async emoji => {
    try {
      await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
    } catch (error) {
      console.warn('[STICKER] Gagal mengirim reaksi:', error?.message || error)
    }
  }

  // Do not quote the source message here. A quoted image/link can carry
  // externalAdReply metadata and recreate the unwanted GitHub preview.
  const sendText = async text => conn.sendMessage(m.chat, { text })

  try {
    stage = 'membaca media yang direply'
    let q = null
    try { q = m.quoted } catch (error) {
      console.warn('[STICKER] Serializer reply gagal:', error?.message || error)
    }

    const stanzaId = getQuotedStanzaId(m)
    const hasReply = Boolean(stanzaId || q)
    const quotedInfo = await resolveQuotedMediaInfo(m, conn)

    const safeGet = (getter, fallback = '') => {
      try { return getter() ?? fallback } catch { return fallback }
    }
    const directType = String(safeGet(() => m.mediaType) || safeGet(() => m.mtype))
    mediaType = String(
      quotedInfo?.type ||
      safeGet(() => q?.mediaType) ||
      safeGet(() => q?.mtype) ||
      directType
    )
    const mediaNode = quotedInfo?.media ||
      safeGet(() => q?.msg, null) ||
      q ||
      safeGet(() => m.msg, null) ||
      m
    mime = String(
      quotedInfo?.mime ||
      safeGet(() => mediaNode?.mimetype) ||
      safeGet(() => q?.mimetype) ||
      safeGet(() => m.mimetype) ||
      (/^imageMessage$/i.test(mediaType) ? 'image' : '') ||
      (/^(video|ptv)Message$/i.test(mediaType) ? 'video' : '')
    ).toLowerCase()

    const isVideo = /^video\//i.test(mime) ||
      /^(video|ptv)Message$/i.test(mediaType)
    const isImage = /^image\//i.test(mime) ||
      mime === 'image' ||
      /^imageMessage$/i.test(mediaType)

    console.log('[STICKER] Media terdeteksi', JSON.stringify({
      hasReply,
      stanzaId: stanzaId ? 'ada' : 'tidak ada',
      mediaType: mediaType || null,
      mime: mime || null,
      quotedInfo: Boolean(quotedInfo)
    }))

    if (!isImage && !isVideo) {
      await react('❌')
      return sendText(hasReply
        ? '❌ Pesan yang dibalas terdeteksi, tetapi bukan gambar/video yang bisa dijadikan stiker. Coba reply langsung ke foto atau video aslinya.'
        : 'Balas foto/video dengan command *' + usedPrefix + command + '*, atau kirim foto dengan caption *' + usedPrefix + command + '*.')
    }

    if (isVideo) {
      const seconds = Number(
        mediaNode?.seconds ??
        safeGet(() => q?.seconds, 0) ??
        0
      )
      if (Number.isFinite(seconds) && seconds > stickerLimits.maxVideoSeconds) {
        await react('❌')
        return sendText('❌ Video terlalu panjang. Maksimal ' + stickerLimits.maxVideoSeconds + ' detik untuk stiker animasi.')
      }
    }

    stage = 'mengunduh media'
    await react('🕒')
    let buffer = null

    if (hasReply || quotedInfo) {
      buffer = await downloadQuotedMedia(m, conn)
      if (!buffer && typeof q?.download === 'function') {
        try { buffer = await q.download() } catch (error) {
          console.warn('[STICKER] Fallback q.download gagal:', error?.message || error)
        }
      }
    } else if (typeof m.download === 'function') {
      buffer = await m.download()
    }

    if (!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) || !buffer.length) {
      throw new Error('Media tidak berhasil diunduh dari WhatsApp. Kirim ulang foto/video lalu reply dengan command ' + usedPrefix + command + '.')
    }

    inputBytes = buffer.length
    if (inputBytes > stickerLimits.maxInputBytes) {
      throw new Error('Ukuran media melebihi batas ' + Math.round(stickerLimits.maxInputBytes / 1024 / 1024) + ' MB.')
    }

    stage = 'mengonversi ke WebP'
    const [packnameRaw, ...authorParts] = args.join(' ').split('|')
    const packname = (packnameRaw || global.stickpack || 'Alvareth Bot').trim()
    const author = (authorParts.join('|') || global.stickauth || '').trim()
    const stickerBuffer = await createStickerFromBuffer(Buffer.from(buffer), {
      mimeHint: mime,
      mediaType,
      packname,
      author
    })

    stage = 'mengirim stiker ke WhatsApp'
    // Send the sticker as a native media message, without quoting the original
    // link/media. This avoids the old sendFile preview metadata path entirely.
    await conn.sendMessage(m.chat, {
      sticker: stickerBuffer,
      mimetype: 'image/webp'
    })

    await react('✨')
    console.log('[STICKER] Berhasil', JSON.stringify({
      mediaType,
      mime: mime || null,
      inputBytes,
      outputBytes: stickerBuffer.length
    }))
  } catch (error) {
    const detail = String(error?.message || error || 'Kesalahan tidak diketahui')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL disamarkan]')
      .replace(/\s+/g, ' ')
      .slice(0, 500)

    console.error('[STICKER] GAGAL', JSON.stringify({
      stage,
      mediaType: mediaType || null,
      mime: mime || null,
      inputBytes,
      error: detail
    }), error?.stack || '')

    await react('❌')
    try {
      await sendText('❌ Stiker gagal dibuat pada tahap: ' + stage + '.\nDetail: ' + detail)
    } catch (sendError) {
      console.error('[STICKER] Gagal mengirim pesan diagnostik:', sendError?.stack || sendError)
    }
  }
}

handler.help = ['sticker [packname|author]']
handler.tags = ['sticker']
handler.command = /^s(tic?ker)?(gif)?$/i
handler.register = false

export default handler
