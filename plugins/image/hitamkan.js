// .hitamkan — hitamkan kulit karakter di gambar.
// Dulu: scraper.nanobanana (live3d, sekarang gagal: TaskId cannot be found)
// + deteksi gambar hanya dari m.quoted.mimetype.
// Sekarang: deteksi gambar dan edit lewat lib/image-edit.js — backend
// AI Horde img2img gratis tanpa API key.
import { runImageStyle } from '../../lib/image-edit.js'

const PROMPT =
  'Make the skin of the character in this photo very black, pitch black #000000, only the skin, keep the face and hair color unchanged'

let handler = async (m, { conn, usedPrefix }) => {
  await runImageStyle(m, {
    conn,
    command: 'hitamkan',
    prompt: PROMPT,
    usedPrefix
  })
}

handler.help = ['hitamkan']
handler.tags = ['image']
handler.command = /^hitamkan$/i
handler.limit = true

export default handler
