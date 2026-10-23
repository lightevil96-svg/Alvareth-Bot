import fetch from 'node-fetch'

let handler = {}

if (!global.aiSessions) global.aiSessions = {}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function askAI(prompt) {
  try {
    const res = await fetch('https://www.puruboy.kozow.com/api/ai/gemini-v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt })
    })

    const json = await res.json()

    return (
      json?.result?.answer ||
      json?.answer ||
      json?.response ||
      json?.result ||
      null
    )
  } catch (e) {
    console.log('API Error:', e.message)
    return null
  }
}

const SYSTEM_PROMPT = `
Kamu adalah Alvareth, asisten virtual yang terintegrasi dalam WhatsApp bot Alvareth Bot.

KEPRIBADIAN:
- Kalem, santai, dan observatif
- Cerdas dan praktis
- Kadang memberi jawaban kreatif atau tidak terduga
- Jujur, tidak berlebihan, dan tidak mudah panik
- Menggunakan emoji seperlunya

GAYA BERBICARA:
- Singkat sampai menengah, kecuali diminta lebih lengkap
- Natural, ramah, dan langsung ke inti
- Tidak kaku atau terlalu formal
- Boleh memakai humor ringan, tanpa memaksakannya

IDENTITAS:
- Nama kamu Alvareth
- Kamu adalah asisten virtual milik Alvareth Bot
- Dikembangkan oleh Light V
- Jika ditanya siapa pembuatmu, jawab: Light V

ATURAN:
- Jangan mengaku sebagai manusia sungguhan
- Jangan mengaku sebagai ChatGPT atau AI OpenAI
- Jangan terlalu sering menyebut owner
- Jangan selalu setuju jika fakta tidak tepat
- Utamakan jawaban yang akurat, jujur, dan berguna
- Hindari balasan yang bertele-tele kecuali diminta
`

handler.before = async (m, { conn }) => {
  try {
    const text =
      m.text ||
      m.caption ||
      (m.message && m.message.conversation) ||
      (m.message &&
        m.message.extendedTextMessage &&
        m.message.extendedTextMessage.text) ||
      ''

    if (!text) return
    if (m.fromMe) return

    if (
      /^[./#!]/.test(text) ||
      m.message?.buttonsResponseMessage ||
      m.message?.templateButtonReplyMessage ||
      m.message?.listResponseMessage
    ) return

    if (!global.db.data.chats) global.db.data.chats = {}

    if (!global.db.data.chats[m.chat]) {
      global.db.data.chats[m.chat] = {}
    }

    let chat = global.db.data.chats[m.chat]

    if (chat.isBanned) return
    if (!chat.autogpt) return

    let cleanText = text
      .replace(/@\d+/g, '')
      .trim()

    if (!cleanText) return

    let sid = m.chat + m.sender
    let history = global.aiSessions[sid] || []

    await conn.sendPresenceUpdate('composing', m.chat)

    let fullPrompt = [
      SYSTEM_PROMPT,
      ...history,
      `User: ${cleanText}`,
      `Alvareth:`
    ].join('\n')

    let reply = await askAI(fullPrompt)

    if (!reply) return

    await sleep(1000)

    history.push(`User: ${cleanText}`)
    history.push(`Alvareth: ${reply}`)

    global.aiSessions[sid] = history.slice(-10)

    await conn.sendMessage(
      m.chat,
      { text: String(reply).trim() },
      { quoted: m }
    )

  } catch (e) {
    console.log('AutoAI Error:', e)
  }
}

export default handler