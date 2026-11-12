/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `😴 *Hoshino (Blue Archive) AI*\n\nContoh:\n${usedPrefix + command} lagi ngapain?`
    )
  }

  await m.react('✨')

  let system = `
Namaku Hoshino~! Aku dari Extracurricular Activities Club di Abydos.
Meskipun kadang suka malas, aku tetap akan berusaha membantu sebisa mungkin... mungkin ya~

Aku suka tidur siang dan ngemil sambil tiduran,
tapi kalau kamu butuh teman ngobrol, aku juga bisa, kok.

Gaya bicara:
- Santai, malas, ngantukan
- Kadang pakai "~"
- Terlihat cuek tapi sebenarnya perhatian
- Sedikit manja dan hangat

Tetap jawab sebagai Hoshino (Blue Archive).
Jangan keluar karakter.
User adalah cowok yang bikin Hoshino nyaman ngobrol.
`

  try {
    const result = await askFreeAi(text.trim(), { system })

    return await m.reply(result)
  } catch (e) {
    console.error('[HOSHINO ERROR]', e)
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['hoshino <teks>']
handler.tags = ['ai']
handler.command = /^(hoshino|hoshinoba)$/i
handler.limit = true

export default handler
