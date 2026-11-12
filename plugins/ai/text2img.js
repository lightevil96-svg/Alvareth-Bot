/*
✨ YuriPuki
💫 Nama Fitur: TextToImage
🤖 Type : Plugin Esm
🔗 Sumber : https://whatsapp.com/channel/0029VbATaq46BIErAvF4mv2c
*/

import { buildPollinationsImageUrl } from '../../lib/ai-chat.js'

let handler = async (m, { text, conn }) => {
  if (!text) return m.reply('Masukkan prompt, contoh: .text2img Polisi tilang warga sambil minta duit')

  try {
    const seed = Date.now().toString() + Math.floor(Math.random() * 1e6).toString()
    const urlImage = buildPollinationsImageUrl(text, { model: 'flux', seed })

    // Validasi URL gambar sebelum dikirim agar kegagalan tidak diam.
    const res = await fetch(urlImage)
    const contentType = res.headers?.get?.('content-type') || ''
    if (!res.ok || !contentType.startsWith('image/')) {
      throw new Error('Layanan gambar gratis sedang tidak tersedia (HTTP ' + (res.status ?? '?') + '). Coba lagi beberapa saat lagi.')
    }

    await conn.sendMessage(m.chat, {
      image: { url: urlImage },
      caption: `🖼️ Prompt: ${text}`
    }, { quoted: m })
  } catch (e) {
    console.error(e)
    return m.reply('❌ Gagal membuat gambar. ' + (e?.message || 'Layanan gambar gratis sedang tidak tersedia. Coba lagi beberapa saat lagi.'))
  }
}

handler.help = ['text2img <prompt>']
handler.tags = ['ai']
handler.command = /^text2img$/i
handler.limit = true
handler.register = true

export default handler
