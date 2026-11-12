import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text }) => {
  const q = m.quoted || m
  const hasImage = (q.msg || q).mimetype?.startsWith('image/')

  if (hasImage) {
    return m.reply(
      '❌ Mode gambar belum didukung di perintah .gpt saat ini.\n' +
      'Silakan kirim pertanyaan dalam bentuk teks saja, contoh:\n.gpt halo'
    )
  }

  if (!text) {
    return m.reply(
`Contoh:
.gpt halo`
    )
  }

  try {
    await m.react('🕒')

    const result = await askFreeAi(text)

    await conn.reply(m.chat, result, m)

    await m.react('✅')
  } catch (e) {
    console.error(e)
    await m.react('❌')
    await m.reply(aiErrorMessage(e))
  }
}

handler.help = ['gpt <text>']
handler.tags = ['ai']
handler.command = /^gpt$/i
handler.limit = true

export default handler
