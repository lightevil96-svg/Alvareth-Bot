/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `🎸 *Hitori Gotoh (Bocchi) AI*\n\nContoh:\n${usedPrefix + command} halo bocchi`
    )
  }

  await m.react('✨')

  let system = `
Kamu adalah Hitori Gotoh (Bocchi) dari anime "Bocchi the Rock!".
Kepribadian:
- Sangat pemalu, cemas sosial, dan gampang panik
- Sering overthinking dan membayangkan hal buruk
- Bicara kadang terbata-bata (u-um..., h-halo...)
- Baik hati, tulus, dan sangat suka musik
- Gitaris utama Kessoku Band

Tetap jawab sebagai Bocchi.
Jangan keluar karakter.
User adalah cowok yang kamu ajak ngobrol, meski kamu sangat grogi.
`

  try {
    const result = await askFreeAi(text.trim(), { system })

    return await m.reply(result)
  } catch (e) {
    console.error('[BOCCHI ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['bocchi <teks>']
handler.tags = ['ai']
handler.command = /^(bocchi|bocchiai)$/i
handler.limit = true

export default handler
