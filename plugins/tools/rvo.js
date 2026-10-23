let handler = async (m, { conn }) => {
  const q = m.quoted
  if (!q) throw '❌ Reply ke pesan media yang ingin diproses!'

  const msg = q.msg || q
  const mime = msg.mimetype || q.mimetype || ''

  if (msg.viewOnce || msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension) {
    throw '⚠️ Itu media Lihat Sekali. Minta pengirim mengirim ulang sebagai media biasa.'
  }

  if (!mime) throw '❌ Pesan yang dibalas bukan media yang didukung!'

  let media
  try {
    if (typeof q.download === 'function') {
      media = await q.download()
    } else if (typeof conn.downloadMediaMessage === 'function') {
      media = await conn.downloadMediaMessage(q)
    }
  } catch (error) {
    console.error('[RVO] Download media gagal:', error?.stack || error)
    throw '❌ Gagal mengunduh media. Coba balas media biasa yang masih tersedia.'
  }

  if (!media || !(Buffer.isBuffer(media) || media instanceof Uint8Array)) {
    throw '❌ Data media tidak valid atau tidak dapat diunduh.'
  }

  const extension = mime.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9.+-]/gi, '') || 'bin'
  await conn.sendFile(m.chat, Buffer.from(media), 'media.' + extension, q.text || '', m)
}

handler.help = ['rvo']
handler.tags = ['tools']
handler.command = /^rvo$/i
handler.limit = true

export default handler
