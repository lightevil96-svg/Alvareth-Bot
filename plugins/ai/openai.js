// Open AI (dialihkan ke backend AI gratis di lib/ai-chat.js)
import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) return m.reply(`Contoh: *${usedPrefix + command} apa itu AI?*`)

  try {
    const jawab = await askFreeAi(text, {
      system: 'Kamu adalah AI pintar dan ramah. Jawab setiap pertanyaan dengan jelas, padat, dan sopan.'
    })

    if (!jawab) throw new Error('Gagal mendapatkan balasan dari AI.')

    m.reply(jawab)
  } catch (e) {
    console.error(e)
    m.reply(aiErrorMessage(e))
  }
}

handler.help = ['openai'].map(v => v + ' <teks>')
handler.tags = ['ai']
handler.command = /^openai$/i
handler.limit = true

export default handler
