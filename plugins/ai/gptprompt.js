import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { conn, text }) => {
  await m.react('✨')

  if (!text) {
    return conn.reply(
      m.chat,
      '*Example :* .gptprompt Seolah kamu asisten virtual yang santai | Halo',
      m
    )
  }

  let [prompt, isi] = text.split('|').map(v => v.trim())
  if (!prompt || !isi) {
    return conn.reply(
      m.chat,
      '*Example :* .gptprompt Seolah kamu asisten virtual yang santai | Halo',
      m
    )
  }

  try {
    let answer = await askFreeAi(isi, { system: prompt })
    conn.reply(m.chat, answer, m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ['gptprompt']
handler.tags = ['ai']
handler.command = /^gptprompt$/i
handler.limit = true

export default handler
