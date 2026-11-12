import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(
      m.chat,
      `*Example :* ${usedPrefix + command} Saya sedang belajar membuat bot whatsapp`,
      m
    )
  }

  try {
    let answer = await askFreeAi(text, { system: 'Parafrasekan teks berikut dengan kata-kata yang berbeda namun maknanya tetap sama. Jawab hanya dengan hasil parafrase.' })
    conn.reply(m.chat, answer, m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['quillbot']
handler.tags = ['ai']
handler.command = /^quillbot$/i
handler.limit = true

export default handler
