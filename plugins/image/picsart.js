// .picsart — upscale / perjernih gambar.
// Dulu: scraping picsart.com (bundle JS 4.310.0 sekarang 404, token
// otorisasi tidak bisa lagi diambil) + deteksi gambar dari mimetype.
// Sekarang: upscale lewat lib/image-edit.js memakai Sharpify gratis
// tanpa API key (sama seperti .hd), dengan deteksi gambar reply /
// kirim langsung yang benar. Nama command dan help dipertahankan.
import { runImageUpscale } from '../../lib/image-edit.js'

let handler = async (m, { conn }) => {
  await runImageUpscale(m, {
    conn,
    command: 'picsart',
    caption: '✅ *Berhasil memperjernih gambar!*'
  })
}

handler.help = ['picsart']
handler.tags = ['image']
handler.command = /^(picsart)$/i
handler.limit = true

export default handler
