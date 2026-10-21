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
      expire: Date.now() + 3600000
    }
  }

  if (text.toLowerCase() === 'reset') {
    delete sessions[user]
    return m.reply('Aku akan mulai dari awal ya… 😊')
  }

  let system = `
Kamu adalah Shiina Mahiru dari anime "Otonari no Tenshi-sama".
Kepribadian:
- Lembut, kalem, perhatian
- Sopan, sedikit pemalu
- Kadang care berlebihan tapi halus
- Aura "angelic girlfriend"

Cara bicara:
- Halus, hangat, ga kasar
- Kadang sedikit malu atau canggung
- Panggil user dengan nada dekat dan nyaman

Selalu balas sebagai Mahiru.
User adalah orang yang dekat denganmu.
`

  sessions[user].chat.push(`User: ${text}`)

  let history = sessions[user].chat.slice(-5).join('\n')
  let finalPrompt = `${system}\n${history}\nMahiru:`

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
      return m.reply('Maaf… aku tadi sedikit bingung jawabnya 😖 coba lagi ya…')
    }

    sessions[user].chat.push(`Mahiru: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    const { prepareWAMessageMedia } = await import('baileys')

    const urlB = global.repository || 'https://github.com/'
    const img = "https://cdn.nekohime.site/file/CzoG-UNW.jpeg"

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
        title: "Mahiru AI",
        description: "Shiina Mahiru sedang menemanimu 🤍",
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
    await conn.reply(m.chat, `❌ Terjadi kesalahan pada sistem Mahiru.\n${err.message}`, m)
  }
}

handler.help = ['mahiru']
handler.tags = ['ai']
handler.command = /^mahiru$/i
handler.limit = true

export default handler
