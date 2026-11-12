import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(
      m.chat,
      `Example : ${usedPrefix + command} Siapa bahlil`,
      m
    )
  }

  try {
    let answer = await askFreeAi(text)
    conn.reply(m.chat, answer, m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['airealtime <pertanyaan>']
handler.tags = ['ai']
handler.command = /^airealtime$/i
handler.limit = true

export default handler
