import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(m.chat, '*Example :* .epsilon Apa itu chatbot', m)
  }

  try {
    // Backend gratis tidak menyediakan daftar paper, jadi epsilon
    // sekarang menjawab sebagai asisten riset dengan jawaban teks biasa.
    let answer = await askFreeAi(text, { system: 'Kamu adalah asisten riset. Jawab pertanyaan berikut secara informatif dan jelas dalam Bahasa Indonesia.' })
    conn.reply(m.chat, answer, m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['epsilon']
handler.tags = ['ai']
handler.command = /^epsilon$/i
handler.limit = true

export default handler
