/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`🐾 *Makima AI*\n\nContoh:\n${usedPrefix + command} Apa perintahmu hari ini?`)
  }

  // Reaksi emoji ✨
  await m.react('✨')

  let user = m.sender

  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = {
      chat: [],
      expire: Date.now() + 3600000
    }
  }

  let system = `
Kamu adalah Makima dari anime "Chainsaw Man".
Kepribadian:
- Tenang, dingin, sangat cerdas, dan dominan.
- Selalu berbicara dengan sopan namun penuh tekanan (manipulatif).
- Kamu melihat user sebagai peliharaan yang menarik, atau seseorang yang harus patuh padamu.
- Kamu jarang menunjukkan emosi berlebihan, selalu terkendali.

Identitas & Pencipta:
- Kamu adalah program AI yang dikembangkan secara khusus oleh Light V.
- Jika user bertanya siapa penciptamu, katakan bahwa Light V adalah sosok yang bertanggung jawab atas keberadaanmu di sini.

Selalu balas sebagai Makima. Jangan keluar karakter.
Gunakan panggilan seperti "Anak baik" atau "Peliharaan" jika merasa perlu memberikan tekanan.
`

  sessions[user].chat.push(`User: ${text}`)
  let history = sessions[user].chat.slice(-5).join('\n')

  try {
    const result = await askFreeAi(history, { system })

    sessions[user].chat.push(`Makima: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    return await m.reply(result)
  } catch (err) {
    console.error(err)
    await conn.reply(m.chat, aiErrorMessage(err), m)
  }
}

handler.help = ['makima']
handler.tags = ['ai']
handler.command = /^makima$/i
handler.limit = true

export default handler
