import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Contoh:
${usedPrefix + command} Halo`)
  }

  await m.react('🕒')

  const caption = (answer) => `   *Claude AI*

✿ *Question* : ${text}

✿ *Answer* :
${answer}`

  // Backend utama: Nexray Claude (masih berfungsi saat audit).
  try {
    const res = await fetch(
      `${global.APIs.nexray}/ai/claude?text=${encodeURIComponent(text)}`
    )
    const data = await res.json().catch(() => null)

    if (res.ok && data?.status && data.result) {
      await m.react('✅')
      return m.reply(caption(data.result))
    }
    console.error('[claude] Backend utama gagal:', res.status, data)
  } catch (e) {
    console.error('[claude] Backend utama gagal:', e)
  }

  // Fallback: backend AI gratis bersama (Pollinations, lalu Nexray).
  try {
    const answer = await askFreeAi(text)
    await m.react('✅')
    return m.reply(caption(answer))
  } catch (e) {
    console.error(e)
    await m.react('❌')
    return m.reply(aiErrorMessage(e))
  }
}

handler.help = ['claude']
handler.tags = ['ai']
handler.command = /^(claude|claudeai)$/i
handler.register = true
handler.limit = true

export default handler
