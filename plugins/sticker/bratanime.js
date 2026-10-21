import { createSticker, StickerTypes } from 'wa-sticker-formatter'

let handler = async (m, { conn, text }) => {
  try {
    if (!text) throw `Masukkan teks\nContoh: .bratanime halo hilman`

    const url = `https://api.nexray.web.id/maker/bratanime?text=${encodeURIComponent(text)}`
    
    const res = await fetch(url)
    const buffer = Buffer.from(await res.arrayBuffer())

    const stickerBuffer = await createSticker(buffer, {
      type: StickerTypes.FULL,
      pack: 'ᴀʟᴠᴀʀᴇᴛʜ ʙᴏᴛ',
      author: 'ʙy ʟɪɢʜᴛ ᴠ',
      categories: ['✨'],
      id: '.',
      quality: 70,
      background: null
    })

    await conn.sendFile(m.chat, stickerBuffer, 'sticker.webp', '', m)

  } catch (e) {
    console.error(e)
    m.reply('Terjadi kesalahan saat membuat sticker')
  }
}

handler.help = ['bratanime']
handler.tags = ['sticker']
handler.command = /^bratanime$/i
handler.limit = true

export default handler