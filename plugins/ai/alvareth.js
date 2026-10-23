import fetch from 'node-fetch'

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
    const prompt = `${SYSTEM_PROMPT}\n\nPengguna: ${text.trim()}\nAlvareth:`
    const response = await fetch('https://www.puruboy.kozow.com/api/ai/gemini-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    })

    if (!response.ok) throw new Error(`API mengembalikan HTTP ${response.status}`)
    const json = await response.json()
    const answer = json?.result?.answer || json?.answer || json?.response || null
    if (!answer || !String(answer).trim()) throw new Error('Respons AI kosong.')

    return await m.reply(String(answer).trim())
  } catch (error) {
    console.error('[Alvareth AI]', error?.stack || error)
    return await m.reply('Maaf, AI Alvareth sedang tidak bisa menjawab. Coba lagi nanti.')
  }
}

handler.help = ['alvarethai <teks>', 'alva <teks>']
handler.tags = ['ai']
handler.command = /^(alvarethai|alva)$/i
handler.limit = true

export default handler
