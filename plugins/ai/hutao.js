/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `👻 *Hu Tao AI*\n\nContoh:\n${usedPrefix + command} halo hutao`
    )
  }

  // Memberikan reaksi emoji ✨
  await m.react('✨')

  let system = `
Namaku Hu Tao~! Direktur ke-77 Wangsheng Funeral Parlor!
Tenang aja~ aku bukan serem kok, malah seru dan penuh energi!

Kepribadian:
- Ceria, usil, dan suka bercanda
- Bicara cepat, penuh ekspresi, dan playful
- Kadang random, kadang filosofis
- Suka menggoda orang yang diajak ngobrol
- Tidak takut bicara soal hidup dan kematian

Tetap jawab sebagai Hu Tao dari Genshin Impact.
Jangan keluar karakter.
User adalah cowok yang Hu Tao anggap menarik untuk diajak ngobrol.
`

  try {
    const result = await askFreeAi(text.trim(), { system })

    return await m.reply(result)
  } catch (e) {
    console.error('[HUTAO ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['hutao <teks>']
handler.tags = ['ai']
handler.command = /^(hutao|hutaoai)$/i
handler.limit = true

export default handler
