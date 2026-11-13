// AI Image Converter — transformasi style gambar.
// Dulu: backend api-faa.my.id (sekarang HTTP 500, mati) + upload uguu.se.
// Sekarang: deteksi gambar dan edit lewat lib/image-edit.js — backend
// Pollinations image gratis tanpa API key (gambar diunggah dulu ke tmp.malvryx.dev).
// Perintah toghibli, tojepang, dan tolego dihapus dari file ini karena
// sudah ada di plugins/image/to3d.js dan handler hanya menjalankan plugin
// pertama yang cocok, jadi versi di sini tidak pernah terpanggil.
import { runImageStyle } from '../../lib/image-edit.js'

export const STYLE_PROMPTS = {
  tobotak: 'Make the person in this photo completely bald, shaved head, keep the face, pose and composition the same',
  tochibi: 'Transform this photo into chibi style, cute small character with big head, keep the subject and composition the same',
  tofunk: 'Transform this photo into funky style, colorful and playful, keep the subject, pose and composition the same',
  tofigura: 'Transform the person in this photo into a collectible action figure, keep the pose and composition the same',
  tofigurav2: 'Transform the person in this photo into a collectible figurine standing on a display base, keep the pose and composition the same',
  tofigurav3: 'Transform the person in this photo into a premium statue figurine, keep the pose and composition the same',
  tohijab: 'Add a hijab to the person in this photo, modest and natural, keep the face, pose and composition the same',
  tojapanese: 'Transform this photo into Japanese style illustration, keep the subject, pose and composition the same',
  tokacamata: 'Add stylish glasses to the person in this photo, keep the face, pose and composition the same',
  tokamboja: 'Transform this photo into Cambodian traditional style, keep the subject, pose and composition the same',
  toliquor: 'Transform this photo into a vintage liquor poster style, dramatic lighting, keep the subject and composition the same',
  tomaid: 'Dress the person in this photo in a maid outfit, keep the face, pose and composition the same',
  tomirror: 'Transform this photo into a mirror reflection effect, keep the subject and composition the same',
  tomoai: 'Transform the person in this photo into a Moai statue style, stone Easter Island statue, keep the pose and composition the same',
  tomonyet: 'Transform the person in this photo into a monkey, keep the pose and composition the same',
  topacar: 'Transform this photo into a romantic portrait style, warm and loving mood, keep the subject and composition the same',
  topeci: 'Add a peci, Indonesian traditional black cap, to the person in this photo, keep the face, pose and composition the same',
  topiramida: 'Transform this photo into ancient Egyptian pyramid style, keep the subject and composition the same',
  toputih: 'Make the skin of the person in this photo fair and white, keep the face, hair color and composition the same',
  toreal: 'Make this photo photorealistic, real photography look, keep the subject, pose and composition the same',
  toroblox: 'Transform this photo into Roblox blocky character style, keep the subject, pose and composition the same',
  toroh: 'Transform the person in this photo into a ghostly spirit, ethereal and translucent, keep the pose and composition the same',
  totato: 'Add tattoo art to the person in this photo, keep the face, pose and composition the same',
  totua: 'Make the person in this photo look old, aged with wrinkles and grey hair, keep the pose and composition the same',
  toviking: 'Transform the person in this photo into a Viking warrior style, keep the pose and composition the same',
  tozombie: 'Transform this photo into a zombie, keep the pose and composition the same',
  tounderground: 'Transform this photo into gritty underground street style, dark and raw, keep the subject and composition the same',
  tohitam: 'Make the skin of the person in this photo very black, pitch black #000000, keep the face and hair color unchanged'
}

const handler = async (m, { conn, command, usedPrefix }) => {
  const style = String(command || '').toLowerCase()
  const prompt = STYLE_PROMPTS[style]
  if (!prompt) return m.reply('Style tidak dikenal.')
  await runImageStyle(m, { conn, command: style, prompt, usedPrefix })
}

handler.help = Object.keys(STYLE_PROMPTS)

handler.tags = ['image']

handler.command =
  /^(tobotak|tochibi|tofunk|tofigura|tofigurav2|tofigurav3|tohijab|tojapanese|tokacamata|tokamboja|toliquor|tomaid|tomirror|tomoai|tomonyet|topacar|topeci|topiramida|toputih|toreal|toroblox|toroh|totato|totua|toviking|tozombie|tounderground|tohitam)$/i

handler.limit = true

export default handler
