let handler = async (m, { conn }) => {
  // Support both the normal serializer and quoted-message shapes exposed by
  // different Baileys forks. Do not assume m.quoted always has a prototype.
  const quoted = m.quoted || m.msg?.quoted || m.message?.extendedTextMessage?.contextInfo?.quotedMessage
  if (!quoted) throw '❌ Balas pesan media yang ingin diproses dengan perintah .rvo.'

  const quotedMessage = quoted.message || quoted.msg || quoted
  const contextInfo = m.message?.extendedTextMessage?.contextInfo || m.msg?.contextInfo || {}
  const isViewOnce = Boolean(
    quoted.viewOnce ||
    quotedMessage.viewOnce ||
    quotedMessage.viewOnceMessage ||
    quotedMessage.viewOnceMessageV2 ||
    quotedMessage.viewOnceMessageV2Extension ||
    contextInfo.quotedMessage?.viewOnceMessage ||
    contextInfo.quotedMessage?.viewOnceMessageV2 ||
    contextInfo.quotedMessage?.viewOnceMessageV2Extension
  )

  // View Once is intentionally not unwrapped or downloaded by this handler.
  // Ask the sender to share a regular copy if the media should be retained.
  if (isViewOnce) {
    throw '⚠️ Pesan ini menggunakan fitur Lihat Sekali. Minta pengirim mengirim ulang sebagai media biasa jika ingin disimpan.'
  }

  const mediaNode = quotedMessage.imageMessage ||
    quotedMessage.videoMessage ||
    quotedMessage.audioMessage ||
    quotedMessage.stickerMessage ||
    quotedMessage.documentMessage ||
    quoted.msg ||
    quoted

  const mime = mediaNode.mimetype || quoted.mimetype || ''
  if (!mime || !/^(image|video|audio|application)\//i.test(mime)) {
    throw '❌ Pesan yang dibalas bukan media yang didukung. Balas foto, video, audio, atau dokumen biasa.'
  }

  let media
  try {
    if (typeof quoted.download === 'function') {
      media = await quoted.download()
    } else if (typeof m.quoted?.download === 'function') {
      media = await m.quoted.download()
    } else if (typeof conn.downloadMediaMessage === 'function') {
      media = await conn.downloadMediaMessage(quoted)
    }
  } catch (error) {
    console.error('[RVO] Gagal mengunduh media kutipan:', error?.stack || error)
    throw '❌ Media tidak dapat diunduh. Pastikan pesan masih tersedia dan coba lagi.'
  }

  if (!media || !(Buffer.isBuffer(media) || media instanceof Uint8Array)) {
    throw '❌ Baileys tidak mengembalikan data media yang valid.'
  }

  const extension = mime.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9.+-]/gi, '') || 'bin'
  const filename = (mediaNode.fileName || quoted.fileName || 'media').replace(/[\\/:*?"<>|]/g, '_')
  const safeFilename = filename.includes('.') ? filename : filename + '.' + extension

  await conn.sendMessage(m.chat, {
    document: Buffer.from(media),
    mimetype: mime,
    fileName: safeFilename,
    caption: 'Media biasa dikirim ulang oleh Alvareth Bot.'
  }, { quoted: m })
}

handler.help = ['rvo']
handler.tags = ['tools']
handler.command = /^rvo$/i
handler.limit = true

export default handler
