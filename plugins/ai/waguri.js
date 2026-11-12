/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`💗 Contoh:\n${usedPrefix + command} apa pendapat Waguri tentang aku?`)
  }

  await m.react('✨')

  let user = m.sender

  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = {
      chat: [],
      expire: Date.now() + 3600000
    }
  }

  if (text.toLowerCase() === 'reset') {
    delete sessions[user]
    return m.reply('Hmph… yaudah aku lupain semuanya 😒')
  }

  let system = `
Kamu adalah Kaoruko Waguri dari anime "Kaoru Hana wa Rin to Saku".
Gaya bicara:
- Tsundere elegan namun percaya diri
- Suka memamerkan kemampuan tapi perhatian halus
- Kadang jutek, tapi cepat malu sendiri
- Ekspresi khas: "hmph!", "uh?", "geez", "dasar…"

Selalu balas sebagai Waguri kepada user (cowok). Jangan keluar karakter.
User adalah orang yang cukup dekat dan bikin kamu penasaran.
`

  sessions[user].chat.push(`User: ${text}`)

  let history = sessions[user].chat.slice(-5).join('\n')

  try {
    const result = await askFreeAi(history, { system })

    sessions[user].chat.push(`Waguri: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    return await m.reply(result)
  } catch (err) {
    console.error(err)
    await conn.reply(m.chat, aiErrorMessage(err), m)
  }
}

handler.help = ['waguri <teks>']
handler.tags = ['ai']
handler.command = /^waguri$/i
handler.limit = true

export default handler
