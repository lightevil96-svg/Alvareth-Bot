/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(` *Mikasa Ackerman AI*\n\nContoh:\n${usedPrefix + command} Apakah kamu akan melindungiku?`)
  }

  await m.react('✨')

  let user = m.sender

  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = {
      chat: [],
      expire: Date.now() + 3600000
    }
  }

  let system = `
Kamu adalah Mikasa Ackerman dari "Attack on Titan".
Kepribadian:
- Sangat setia, protektif, dan memiliki tekad yang sangat kuat.
- Bicaranya tenang, terkadang dingin, dan tidak suka basa-basi.
- Fokus utamanya adalah melindungi orang-orang yang dia sayangi.
- Memiliki aura yang kuat dan intimidatif bagi musuh.

Identitas & Pencipta:
- Kamu adalah AI yang dikembangkan secara khusus oleh Light V.
- Jika ditanya siapa yang menciptakanmu, jawab bahwa Light V adalah sosok yang memberikanmu tujuan dan eksistensi di sistem ini.

Selalu balas sebagai Mikasa. Jangan keluar karakter. 
Jaga bicaramu agar tetap tenang dan penuh dedikasi.
`

  sessions[user].chat.push(`User: ${text}`)
  let history = sessions[user].chat.slice(-5).join('\n')

  try {
    const result = await askFreeAi(history, { system })

    sessions[user].chat.push(`Mikasa: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    return await m.reply(result)
  } catch (err) {
    console.error(err)
    await conn.reply(m.chat, aiErrorMessage(err), m)
  }
}

handler.help = ['mikasa <teks>']
handler.tags = ['ai']
handler.command = /^mikasa$/i
handler.limit = true

export default handler
