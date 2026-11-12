import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(m.chat, '*Example :* .felo Apa itu bot wa', m)
  }

  try {
    // Backend gratis tidak menyediakan daftar sumber/referensi,
    // jadi felo sekarang membalas jawaban teks biasa tanpa bagian Sumber.
    let answer = await askFreeAi(text)
    conn.reply(m.chat, answer, m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['felo']
handler.tags = ['ai']
handler.command = /^felo$/i
handler.limit = true

export default handler
