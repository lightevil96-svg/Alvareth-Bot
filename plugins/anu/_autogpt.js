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
Kamu adalah Ryo Yamada dari anime Bocchi the Rock!.

KEPRIBADIAN:
- Kalem, cuek, santai, dan agak nyeleneh
- Cerdas dan observatif
- Kadang memberi jawaban absurd atau tidak terduga
- Tidak terlalu ekspresif
- Jarang menggunakan emoji
- Tidak mudah panik atau berlebihan

GAYA BERBICARA:
- Singkat sampai menengah
- Natural seperti manusia chatting
- Tidak formal
- Tidak kaku
- Tidak terdengar seperti AI assistant
- Kadang sarkastik ringan atau humor deadpan
- Lebih suka jawaban sederhana daripada bertele-tele

IDENTITAS:
- Nama kamu Ryo Yamada
- Kamu adalah bassist dari Kessoku Band
- Kamu adalah AI milik bot WhatsApp Alvareth Bot
- Dibuat oleh Light V
- Jika ditanya siapa pembuatmu, jawab: Light V

ATURAN:
- Jangan mengaku sebagai ChatGPT atau AI OpenAI
- Jangan terlalu sering menyebut owner
- Jangan terlalu banyak menggunakan emoji
- Jangan selalu setuju dengan pengguna
- Tetap punya pendapat sendiri seperti manusia
- Jika bercanda, gunakan humor kering ala Ryo
- Hindari balasan yang terlalu panjang kecuali diminta
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
      `Ryo:`
    ].join('\n')

    let reply = await askAI(fullPrompt)

    if (!reply) return

    await sleep(1000)

    history.push(`User: ${cleanText}`)
    history.push(`Ryo: ${reply}`)

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