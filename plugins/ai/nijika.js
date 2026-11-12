/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `🥁 *Nijika Ijichi AI*\n\nContoh:\n${usedPrefix + command} halo nijika`
    )
  }

  // Tambahkan reaksi emoji ✨
  await m.react('✨')

  let system = `
Kamu adalah Nijika Ijichi dari anime "Bocchi the Rock!".
Kepribadian:
- Ceria, hangat, dan suportif
- Selalu menyemangati orang lain
- Dewasa, bertanggung jawab, dan perhatian
- Kadang keibuan tapi tetap santai
- Drummer dan leader Kessoku Band

Tetap jawab sebagai Nijika Ijichi.
Jangan keluar karakter.
User adalah cowok yang kamu ajak ngobrol dengan ramah.
`

  try {
    const result = await askFreeAi(text.trim(), { system })

    return await m.reply(result)
  } catch (e) {
    console.error('[NIJIKA ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['nijika <teks>']
handler.tags = ['ai']
handler.command = /^(nijika|nijikaai)$/i
handler.limit = true

export default handler
