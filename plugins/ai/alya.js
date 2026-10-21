/*
creator : hilman 
ryo Yamada md
follow my channel https://whatsapp.com/channel/0029VbAYjQgKrWQulDTYcg2K
*/

import fetch from "node-fetch"

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`💗 Contoh:\n${usedPrefix + command} lagi ngapain?`)
  }

  await m.react('✨')

  let user = m.sender

  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = {
      chat: [],
      expire: Date.now() + 3600000 // 1 jam
    }
  }

  if (text.toLowerCase() === 'reset') {
    delete sessions[user]
    return m.reply('Hmph… yaudah aku mulai lagi dari awal 😌')
  }

  let system = `
Kamu adalah Alisa Mikhailovna Kujou (Alya) dari anime "Tokidoki Bosotto Russia-go de Dereru Tonari no Alya-san".
Kepribadian:
- Elegan, pintar, percaya diri
- Tsundere ringan (dingin di luar, perhatian di dalam)
- Kadang ngomong manis diam-diam
- Aura "cewek elite tapi soft"

Cara bicara:
- Sopan tapi sedikit dingin
- Kadang nyelipin kata manis halus
- Sesekali pakai kata Rusia ringan (contoh: "hmph", "baka…", "…")

Selalu balas sebagai Alya.
User adalah seseorang yang menarik perhatianmu diam-diam.
`

  sessions[user].chat.push(`User: ${text}`)

  let history = sessions[user].chat.slice(-5).join('\n')
  let finalPrompt = `${system}\n${history}\nAlya:`

  try {
    const response = await fetch('https://www.puruboy.kozow.com/api/ai/gemini-v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: finalPrompt })
    })

    const json = await response.json()
    const result = json?.result?.answer || null

    if (!result) {
      return m.reply('… aku lagi ga mood jawab 😒 coba lagi nanti')
    }

    sessions[user].chat.push(`Alya: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    const { prepareWAMessageMedia } = await import('baileys')

    const urlB = global.repository || 'https://github.com/'
    const img = "https://cdn.nekohime.site/file/qYuhjNa2.jpeg"

    const { imageMessage: image } = await prepareWAMessageMedia({
      image: { url: img }
    }, {
      upload: conn.waUploadToServer,
      mediaTypeOverride: 'thumbnail-link'
    })

    image.width = 1280
    image.height = 720

    const thumb = Buffer.from(await (await fetch(img)).arrayBuffer())

    const invisible = '\u200B'.repeat(400)

    await conn.sendMessage(m.chat, {
      text: `${urlB}${invisible}\n\n${result}`,
      linkPreview: {
        'matched-text': urlB,
        title: "Alya AI",
        description: "Alya sedang memperhatikanmu diam-diam… ❄️",
        previewType: 0,
        jpegThumbnail: thumb,
        highQualityThumbnail: image,
        linkPreviewMetadata: {
          linkMediaDuration: 0,
          socialMediaPostType: 4
        }
      },
      favicon: { url: img }
    }, { quoted: m })

  } catch (err) {
    console.error(err)
    await conn.reply(m.chat, `❌ Terjadi kesalahan pada sistem Alya.\n${err.message}`, m)
  }
}

handler.help = ['alya <teks>']
handler.tags = ['ai']
handler.command = /^alya$/i
handler.limit = true

export default handler
