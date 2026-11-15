import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'
import { askGroqAi } from '../../lib/owner-assistant.js'

// Keep .gemini on its original free provider; only .ai uses the shared Groq
// credentials saved through owner-only .asisten apikey.
let handler = async (m, { conn, text, usedPrefix, command }) => {
  await m.react('✨').catch(() => {})

  if (!text?.trim()) {
    return conn.reply(m.chat, 'Contoh: ' + usedPrefix + command + ' Halo', m)
  }

  const isGroqCommand = String(command || '').toLowerCase() === 'ai'
  try {
    const answer = isGroqCommand
      ? await askGroqAi(text)
      : await askFreeAi(text)
    return await conn.reply(m.chat, answer, m)
  } catch (error) {
    if (!isGroqCommand) {
      console.error('[GEMINI]', error?.name || 'request-error')
      return conn.reply(m.chat, aiErrorMessage(error), m)
    }

    // A failed Groq configuration or provider request should not spend a limit.
    m.skipLimit = true
    console.warn('[AI GROQ] Permintaan gagal:', error?.code || error?.status || error?.name || 'request-error')
    let message = '❌ Groq sedang tidak bisa memberikan jawaban. Coba lagi nanti.'
    if (error?.code === 'GROQ_KEY_MISSING') {
      message = '🔑 API key Groq belum tersedia. Minta owner mengisinya melalui .asisten → Apikey atau .asisten apikey.'
    } else if (error?.status === 401 || error?.status === 403) {
      message = '🔑 API key Groq ditolak. Owner perlu memperbaruinya melalui .asisten apikey.'
    } else if (error?.status === 429) {
      message = '⏳ Kuota atau batas permintaan Groq sedang tercapai. Coba lagi nanti.'
    } else if (error?.name === 'AbortError') {
      message = '⏳ Groq belum merespons dalam batas waktu. Coba lagi nanti.'
    }
    return conn.reply(m.chat, message, m)
  }
}

handler.help = ['gemini <teks>', 'ai <teks>']
handler.tags = ['ai']
handler.command = /^(gemini|ai)$/i
handler.limit = true

export default handler
