// .toblonde — ubah warna rambut jadi blonde.
// Dulu: backend api-faa.my.id (sekarang HTTP 500, mati), hanya bisa reply
// gambar (m.quoted wajib ada, kirim gambar dengan caption tidak bisa),
// dan file sementara ditulis ke folder kerja bot.
// Sekarang: deteksi gambar dan edit lewat lib/image-edit.js — backend
// Pollinations image gratis tanpa API key (gambar diunggah dulu ke tmp.malvryx.dev).
import { runImageStyle } from '../../lib/image-edit.js'

const PROMPT =
  'Change the hair color of the person in this photo to blonde, keep the face, hairstyle, pose and composition the same'

let handler = async (m, { conn, usedPrefix }) => {
  await runImageStyle(m, {
    conn,
    command: 'toblonde',
    prompt: PROMPT,
    usedPrefix
  })
}

handler.help = ['toblonde']
handler.tags = ['image']
handler.command = /^toblonde$/i
handler.limit = true

export default handler
