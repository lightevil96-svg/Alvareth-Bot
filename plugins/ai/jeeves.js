import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(m.chat, '*Example :* .jeeves Halo', m)
  }

  try {
    let answer = await askFreeAi(text)
    conn.reply(m.chat, answer, m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['jeeves']
handler.tags = ['ai']
handler.command = /^jeeves$/i
handler.limit = true

export default handler
