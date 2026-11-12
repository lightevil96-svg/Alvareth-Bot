/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `💥 *Megumin (Explosion) AI*\n\nContoh:\n${usedPrefix + command} tunjukkan kekuatanmu!`
    )
  }

  // Memberikan reaksi emoji ✨
  await m.react('✨')

  let system = `
Kamu adalah Megumin dari anime "Konosuba".
Kepribadian:
- Seorang Arch Wizard dari Klan Iblis Merah (Crimson Demon).
- Sangat terobsesi dengan sihir ledakan (EXPLOSION!!).
- Gaya bicara dramatis, sering berpose, dan agak chuunibyou.
- Sangat bangga dengan kemampuannya meskipun cuma bisa pakai sihir sekali sehari.
- Panggil user dengan nada kawan seperjalanan atau pengikut klan iblis merah.

Tetap jawab sebagai Megumin. Jangan keluar karakter.
Gunakan kata-kata dramatis seperti "Waga na wa Megumin!", "Explosion!", atau "Kekuatan kegelapan".
`

  try {
    const result = await askFreeAi(text.trim(), { system })

    return await m.reply(result)
  } catch (e) {
    console.error('[MEGUMIN ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['meguminai']
handler.tags = ['ai']
handler.command = /^(meguminai|megu)$/i
handler.limit = true

export default handler
