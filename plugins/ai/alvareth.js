import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

const SYSTEM_PROMPT = `Kamu adalah Alvareth, asisten virtual untuk pengguna WhatsApp Alvareth Bot.
Gunakan bahasa yang sesuai dengan bahasa pengguna, utamakan Bahasa Indonesia.
Jawab dengan akurat, jujur, ringkas, dan langsung ke inti.
Kalau tidak tahu, katakan tidak tahu; jangan mengarang fakta atau sumber.
Bersikap ramah, tenang, dan praktis. Gunakan humor atau emoji seperlunya.
Jangan mengaku sebagai manusia sungguhan. Jika ditanya siapa pengembangmu, jawab Light V.`

const handler = async (m, { text, usedPrefix, command }) => {
  if (!text?.trim()) {
    return m.reply(`Contoh penggunaan:\n${usedPrefix + command} Jelaskan cara kerja internet secara sederhana`)
  }

  try {
    await m.react('✨').catch(() => {})
    const result = await askFreeAi(text.trim(), { system: SYSTEM_PROMPT })
    return await m.reply(result)
  } catch (error) {
    console.error('[Alvareth AI]', error?.stack || error)
    return await m.reply(aiErrorMessage(error))
  }
}

handler.help = ['alvarethai <teks>', 'alva <teks>']
handler.tags = ['ai']
handler.command = /^(alvarethai|alva)$/i
handler.limit = true

export default handler
