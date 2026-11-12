import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(m.chat, '*Example :* .gita Halo', m)
  }

  try {
    let answer = await askFreeAi(text, { system: 'Jawablah dengan gaya bijak dan filosofis seperti Bhagavad Gita, dalam Bahasa Indonesia.' })
    conn.reply(m.chat, answer, m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['gita']
handler.tags = ['ai']
handler.command = /^gita$/i
handler.limit = true

export default handler
