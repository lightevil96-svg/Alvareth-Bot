import { sticker } from '../../lib/sticker.js'
import uploadFile from '../../lib/uploadFile.js'

let handler = async (m, { conn, args, usedPrefix, command }) => {
  const react = async (emoji) => {
    try {
      await conn.sendMessage(m.chat, {
        react: { text: emoji, key: m.key }
      })
    } catch (e) {
      console.error('❌ Gagal kirim reaction:', e)
    }
  }

  try {
    const q = m.quoted || m
    const mediaNode = q.msg || q
    const mediaType = String(q.mediaType || q.mtype || '')
    const mime = String(
      mediaNode?.mimetype ||
      q.mimetype ||
      (/^imageMessage$/i.test(mediaType) ? 'image' : '') ||
      (/^(video|ptv)Message$/i.test(mediaType) ? 'video' : '')
    ).toLowerCase()
    const isVideo = mime.includes('video') || /^(video|ptv)Message$/i.test(mediaType)
    const isImage = mime.includes('image') || /^imageMessage$/i.test(mediaType)

    if (!isImage && !isVideo) {
      await react('❌')
      return await m.reply(`Balas gambar atau video dengan command *${usedPrefix + command}*`)
    }

    if (isVideo) {
      const seconds = Number(mediaNode?.seconds ?? q.seconds ?? 0)
      if (seconds > 10) {
        await react('❌')
        return await m.reply('Maksimal 10 detik')
      }
    }

    await react('🕒')
    let [packname, ...authorArr] = args.join(' ').split('|')
    packname = packname || global.stickpack
    const author = authorArr.join('|') || global.stickauth

    const img = typeof q.download === 'function' ? await q.download() : null
    if (!img || !(Buffer.isBuffer(img) || img instanceof Uint8Array)) {
      await react('❌')
      return await m.reply(`❌ Media tidak berhasil dibaca. Coba kirim ulang gambar/video lalu balas dengan *${usedPrefix + command}*.`)
    }

    let stiker = false
    try {
      stiker = await sticker(img, false, packname, author)
    } catch (e) {
      console.error('[STICKER] Konversi lokal gagal:', e)
    }

    if (!stiker) {
      const out = await uploadFile(img)
      stiker = await sticker(false, out, packname, author)
    }

    await conn.sendFile(m.chat, stiker, 'sticker.webp', '', m)
    await react('✨')
  } catch (e) {
    console.error('[STICKER] Gagal membuat stiker:', e?.stack || e)
    await react('❌')
    await m.reply('❌ Terjadi kesalahan saat membuat stiker. Periksa log bot untuk detailnya.')
  }
}

handler.help = ['sticker [packname|author]']
handler.tags = ['sticker']
handler.command = /^s(tic?ker)?(gif)?$/i
handler.register = false

export default handler
