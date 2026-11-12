import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(
      m.chat,
      `Example : ${usedPrefix + command} Halo`,
      m
    )
  }

  try {
    let answer = await askFreeAi(text)
    conn.reply(m.chat, answer, m)
  } catch (e) {
    console.error(e)
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['gemini']
handler.tags = ['ai']
handler.command =  /^(gemini|ai)$/i
handler.limit = true

export default handler
