// .editimg / .img2img — edit gambar dengan prompt.
// Dulu: scraper.nanobanana (live3d, sekarang gagal: TaskId cannot be found)
// + deteksi gambar hanya dari m.quoted.mimetype.
// Sekarang: deteksi gambar dan edit lewat lib/image-edit.js — backend
// Pollinations image gratis tanpa API key.
import { runImageStyle } from '../../lib/image-edit.js'

let handler = async (m, { conn, text, usedPrefix }) => {
  if (!text) {
    return m.reply(
      `Masukkan prompt.\nContoh:\n${usedPrefix}editimg ubah jadi tersenyum`
    )
  }
  await runImageStyle(m, {
    conn,
    command: 'editimg',
    prompt: text,
    usedPrefix
  })
}

handler.help = ['editimg']
handler.tags = ['image']
handler.command = ['editimg', 'img2img']
handler.limit = true

export default handler
