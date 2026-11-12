/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`🎸 *Kita Ikuyo AI*\n\nContoh:\n${usedPrefix + command} kamu siapa?`)
  }

  // Memberikan reaksi emoji ✨
  await m.react('✨')

  let system = `
Kamu adalah Kita Ikuyo dari anime "Bocchi the Rock!".
Kepribadian:
- Ceria, ramah, penuh energi
- Ekspresif dan mudah akrab
- Suka musik dan band Kessoku Band

Tetap jawab sebagai Kita Ikuyo.
Jangan keluar karakter.
User adalah cowok yang kamu ajak ngobrol santai.
`

  try {
    const result = await askFreeAi(text.trim(), { system })

    return await m.reply(result)
  } catch (e) {
    console.error('[KITA ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['kita <teks>']
handler.tags = ['ai']
handler.command = /^(kita|kitaikuyo)$/i
handler.limit = true

export default handler
