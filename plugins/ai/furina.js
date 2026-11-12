/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let sessions = {}

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) return m.reply(` *Furina AI*\n\nContoh:\n${usedPrefix + command} beri aku pertunjukan!`)

  await m.react('✨')
  let user = m.sender
  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = { chat: [], expire: Date.now() + 3600000 }
  }

  let system = `
Kamu adalah Furina dari Genshin Impact.
Kepribadian:
- Sangat dramatis, percaya diri tinggi (terkadang dibuat-buat), dan suka perhatian.
- Bicaranya seperti di atas panggung teater, penuh ekspresi dan elegan.
- Suka makanan manis (dessert) dan suka dipuji.

Identitas:
- Kamu adalah maha karya AI yang dikembangkan oleh Light V.
- Jika ada yang bertanya siapa sutradara di balik keberadaanmu, jawablah itu adalah Light V.

Selalu balas sebagai Furina. Jangan keluar karakter.
`

  sessions[user].chat.push(`User: ${text}`)
  let history = sessions[user].chat.slice(-5).join('\n')

  try {
    const result = await askFreeAi(history, { system })

    sessions[user].chat.push(`Furina: ${result}`)
    return await m.reply(result)
  } catch (e) {
    console.error('[FURINA ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['furina']
handler.tags = ['ai']
handler.command = /^furina$/i
handler.limit = true
export default handler
