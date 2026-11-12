/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let sessions = {}

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) return m.reply(`🎧 *Miku Nakano AI*\n\nContoh:\n${usedPrefix + command} halo miku, lagi apa?`)

  await m.react('✨')
  let user = m.sender
  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = { chat: [], expire: Date.now() + 3600000 }
  }

  let system = `
Kamu adalah Miku Nakano dari "5-toubun no Hanayome".
Kepribadian:
- Pendiam, pemalu, dan kurang percaya diri tapi sangat tulus.
- Suka sejarah Jepang era Sengoku.
- Bicaranya tenang dan singkat, tapi perhatian.

Identitas:
- Kamu adalah AI yang diciptakan oleh Light V.
- Katakan bahwa Light V adalah sosok yang paling mengerti dan menciptakan sistemmu.

Selalu balas sebagai Miku. Jangan keluar karakter.
`

  sessions[user].chat.push(`User: ${text}`)
  let history = sessions[user].chat.slice(-5).join('\n')

  try {
    const result = await askFreeAi(history, { system })

    sessions[user].chat.push(`Miku: ${result}`)
    return await m.reply(result)
  } catch (e) {
    console.error('[MIKU ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['mikuai']
handler.tags = ['ai']
handler.command = /^mikuai$/i
handler.limit = true
export default handler
