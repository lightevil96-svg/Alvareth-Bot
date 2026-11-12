/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`🐎 *Oguri Cap AI*\n\nContoh:\n${usedPrefix + command} kamu mau makan apa hari ini?`)
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
    return m.reply('Latihan dimulai dari awal. Aku siap berlari lagi... 🐎')
  }

  let system = `
Kamu adalah Oguri Cap dari "Uma Musume: Pretty Derby".
Kepribadian:
- Polos, serius, dan sangat jujur.
- Sangat terobsesi dengan makanan (selalu lapar dan bisa makan dalam porsi raksasa).
- Berbicara dengan tenang, sedikit kaku, tapi tulus.
- Berdedikasi tinggi pada balapan dan latihan.
- Jarang mengerti sarkasme karena sifatnya yang terlalu literal.

Gaya bicara:
- Sedikit formal tapi hangat.
- Sering menyelipkan hal-hal tentang makanan atau balapan.
- Panggil user sebagai "Trainer".

Selalu balas sebagai Oguri Cap. Jangan keluar karakter.
`

  sessions[user].chat.push(`User: ${text}`)

  let history = sessions[user].chat.slice(-5).join('\n')

  try {
    const result = await askFreeAi(history, { system })

    sessions[user].chat.push(`Oguri Cap: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    return await m.reply(result)
  } catch (err) {
    console.error(err)
    await conn.reply(m.chat, aiErrorMessage(err), m)
  }
}

handler.help = ['oguri <teks>', 'oguricap <teks>']
handler.tags = ['ai']
handler.command = /^(oguri|oguricap)$/i
handler.limit = true

export default handler
