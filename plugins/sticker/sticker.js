import { sticker } from '../../lib/sticker.js'
import uploadFile from '../../lib/uploadFile.js'
import { getQuotedStanzaId, resolveQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'

let handler = async (m, { conn, args = [], usedPrefix = '.', command = 's' }) => {
  const react = async emoji => {
    try {
      await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
    } catch (error) {
      console.warn('[STICKER] Gagal mengirim reaksi:', error?.message || error)
    }
  }

  // Plain reply only, without GitHub cards or externalAdReply metadata.
  const replyText = text => conn.sendMessage(
    m.chat, { text }, { quoted: m, noAlvarethPreview: true }
  )

  try {
    let q
    try { q = m.quoted } catch (error) {
      console.warn('[STICKER] Serializer quoted gagal:', error?.message || error)
    }

    // Read the original Baileys contextInfo.quotedMessage, or recover the full
    // media via stanzaId and conn.loadMessage when self-chat replies contain
    // only a preview/thumbnail rather than the downloadable media itself.
    const quotedInfo = await resolveQuotedMediaInfo(m, conn)
    const mediaNode = quotedInfo?.media || q?.msg || q || m.msg || m
    const mediaType = String(
      quotedInfo?.type ||
      q?.mediaType || q?.mtype ||
      m.mediaType || m.mtype || ''
    )
    const mime = String(
      quotedInfo?.mime ||
      mediaNode?.mimetype ||
      q?.mimetype ||
      m.mimetype ||
      (/^imageMessage$/i.test(mediaType) ? 'image' : '') ||
      (/^(video|ptv)Message$/i.test(mediaType) ? 'video' : '')
    ).toLowerCase()
    const isVideo = /^video\//i.test(mime) || /^video$/i.test(mime) ||
      /^(video|ptv)Message$/i.test(mediaType)
    const isImage = /^image\//i.test(mime) || /^image$/i.test(mime) ||
      /^imageMessage$/i.test(mediaType)

    const message = m.rawMessage?.message || m.message || {}
    const hasReplyContext = Boolean(q || getQuotedStanzaId(m))

    console.log('[STICKER] Deteksi media', JSON.stringify({
      hasReply: hasReplyContext,
      quotedType: quotedInfo?.type || null,
      detectedType: mediaType || null,
      mime: mime || null,
      rawKeys: Object.keys(message).slice(0, 6)
    }))

    if (!isImage && !isVideo) {
      await react('❌')
      return replyText(hasReplyContext
        ? '❌ Balasan terdeteksi, tetapi data gambar/video aslinya belum tersedia. Kirim ulang gambar atau video, lalu balas dengan *' + usedPrefix + command + '*.'
        : 'Balas gambar atau video dengan command *' + usedPrefix + command + '*, atau kirim gambar dengan caption *' + usedPrefix + command + '*.')
    }

    if (isVideo) {
      const seconds = Number(mediaNode?.seconds ?? q?.seconds ?? m.msg?.seconds ?? 0)
      if (seconds > 10) {
        await react('❌')
        return replyText('Maksimal 10 detik untuk stiker video.')
      }
    }

    await react('🕒')
    let [packname, ...authorArr] = args.join(' ').split('|')
    packname = packname || global.stickpack
    const author = authorArr.join('|') || global.stickauth

    let buffer = null
    if (quotedInfo) {
      buffer = await downloadQuotedMedia(m, conn)
    } else if (typeof q?.download === 'function' && (q?.mediaMessage || /^(image|video|ptv)Message$/i.test(mediaType))) {
      buffer = await q.download()
    } else if (typeof m.download === 'function') {
      buffer = await m.download()
    }
    if (!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) || !buffer.length) {
      await react('❌')
      return replyText('❌ Media ditemukan tetapi gagal diunduh. Coba kirim ulang media dan balas dengan *' + usedPrefix + command + '*.')
    }
    const img = Buffer.from(buffer)

    let result = false
    try {
      result = await sticker(img, false, packname, author)
    } catch (error) {
      console.warn('[STICKER] Konversi lokal gagal:', error?.message || error)
    }
    if (!result) {
      const url = await uploadFile(img)
      result = await sticker(false, url, packname, author)
    }
    if (!result) throw new Error('Konverter tidak menghasilkan stiker WebP.')

    await conn.sendFile(m.chat, result, 'sticker.webp', '', m, false, {
      asSticker: true,
      noAlvarethPreview: true
    })
    await react('✨')
  } catch (error) {
    console.error('[STICKER] Gagal membuat stiker:', error?.stack || error)
    await react('❌')
    await replyText('❌ Gagal membuat stiker dari media tersebut. Coba ulangi atau periksa log [STICKER] di server.')
  }
}

handler.help = ['sticker [packname|author]']
handler.tags = ['sticker']
handler.command = /^s(tic?ker)?(gif)?$/i
handler.register = false

export default handler
