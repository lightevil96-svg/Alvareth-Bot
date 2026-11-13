// Transformasi style gambar (.to3d, .tooil, dll).
// Dulu: backend api.kyzzz.eu.cc (sekarang 403 Cloudflare) + deteksi gambar
// hanya dari `(q.msg || q).mimetype`, sehingga kirim gambar dengan caption
// maupun reply gambar sama-sama gagal dan bot hanya membalas "Reply gambar."
// Sekarang: deteksi gambar lewat lib/image-edit.js (payload Baileys mentah
// untuk reply, m.download() untuk gambar dengan caption) + backend
// Pollinations image gratis tanpa API key (gambar diunggah dulu ke tmp.malvryx.dev).
import { runImageStyle } from '../../lib/image-edit.js'

export const STYLE_PROMPTS = {
  to3d: 'Transform this photo into a 3D rendered style, Pixar-like 3D animation look, keep the subject, pose and composition the same',
  toanime: 'Transform this photo into anime style illustration, keep the subject, pose and composition the same',
  tocyberpunk: 'Transform this photo into cyberpunk style, neon lights, futuristic city glow, keep the subject and composition the same',
  todisney: 'Transform this photo into Disney animation style, keep the subject, pose and composition the same',
  toghibli: 'Transform this photo into Studio Ghibli anime style, soft colors and hand-drawn look, keep the subject and composition the same',
  tojepang: 'Transform this photo into Japanese anime style illustration, keep the subject, pose and composition the same',
  tolego: 'Transform this photo into LEGO style, built from LEGO bricks, keep the subject, pose and composition the same',
  tomanga: 'Transform this photo into black and white manga style illustration, keep the subject, pose and composition the same',
  tooil: 'Transform this photo into a classic oil painting, visible brush strokes, oil on canvas texture, keep the subject, pose and composition the same',
  topixar: 'Transform this photo into Pixar 3D animation style, keep the subject, pose and composition the same',
  tosketch: 'Transform this photo into a pencil sketch, black and white line drawing, keep the subject, pose and composition the same'
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
  /^(to3d|toanime|tocyberpunk|todisney|toghibli|tojepang|tolego|tomanga|tooil|topixar|tosketch)$/i

handler.limit = true

export default handler
