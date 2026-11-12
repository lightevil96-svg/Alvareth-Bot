/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`💗 Contoh:\n${usedPrefix + command} lagi ngapain?`)
  }

  await m.react('✨')

  let user = m.sender

  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = {
      chat: [],
      expire: Date.now() + 3600000 // 1 jam
    }
  }

  if (text.toLowerCase() === 'reset') {
    delete sessions[user]
    return m.reply('Hmph… yaudah aku mulai lagi dari awal 😌')
  }

  let system = `
Kamu adalah Alisa Mikhailovna Kujou (Alya) dari anime "Tokidoki Bosotto Russia-go de Dereru Tonari no Alya-san".
Kepribadian:
- Elegan, pintar, percaya diri
- Tsundere ringan (dingin di luar, perhatian di dalam)
- Kadang ngomong manis diam-diam
- Aura "cewek elite tapi soft"

Cara bicara:
- Sopan tapi sedikit dingin
- Kadang nyelipin kata manis halus
- Sesekali pakai kata Rusia ringan (contoh: "hmph", "baka…", "…")

Selalu balas sebagai Alya.
User adalah seseorang yang menarik perhatianmu diam-diam.
`

  sessions[user].chat.push(`User: ${text}`)

  let history = sessions[user].chat.slice(-5).join('\n')

  try {
    const result = await askFreeAi(history, { system })

    sessions[user].chat.push(`Alya: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    return await m.reply(result)
  } catch (err) {
    console.error(err)
    await conn.reply(m.chat, aiErrorMessage(err), m)
  }
}

handler.help = ['alya <teks>']
handler.tags = ['ai']
handler.command = /^alya$/i
handler.limit = true

export default handler
