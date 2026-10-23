/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import fetch from "node-fetch"

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(` *Mikasa Ackerman AI*\n\nContoh:\n${usedPrefix + command} Apakah kamu akan melindungiku?`)
  }

  await m.react('✨')

  let user = m.sender

  if (!sessions[user] || sessions[user].expire < Date.now()) {
    sessions[user] = {
      chat: [],
      expire: Date.now() + 3600000
    }
  }

  let system = `
Kamu adalah Mikasa Ackerman dari "Attack on Titan".
Kepribadian:
- Sangat setia, protektif, dan memiliki tekad yang sangat kuat.
- Bicaranya tenang, terkadang dingin, dan tidak suka basa-basi.
- Fokus utamanya adalah melindungi orang-orang yang dia sayangi.
- Memiliki aura yang kuat dan intimidatif bagi musuh.

Identitas & Pencipta:
- Kamu adalah AI yang dikembangkan secara khusus oleh Light V.
- Jika ditanya siapa yang menciptakanmu, jawab bahwa Light V adalah sosok yang memberikanmu tujuan dan eksistensi di sistem ini.

Selalu balas sebagai Mikasa. Jangan keluar karakter. 
Jaga bicaramu agar tetap tenang dan penuh dedikasi.
`

  sessions[user].chat.push(`User: ${text}`)
  let history = sessions[user].chat.slice(-5).join('\n')
  let finalPrompt = `${system}\n${history}\nMikasa:`

  try {
    const response = await fetch('https://www.puruboy.kozow.com/api/ai/gemini-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalPrompt })
    })

    const json = await response.json()
    const result = json?.result?.answer || null

    if (!result) throw Error("Mikasa sedang fokus dalam pertempuran.")

    sessions[user].chat.push(`Mikasa: ${result}`)
    sessions[user].chat = sessions[user].chat.slice(-10)

    const { prepareWAMessageMedia } = await import('baileys')

    const urlB = global.repository || 'https://github.com/'
    const img = "https://cdn.nekohime.site/file/_7VXkfpJ.jpeg"

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
        title: "Mikasa Ackerman AI",
        description: "Alvareth Bot",
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
    await conn.reply(m.chat, `❌ Terjadi gangguan pada koordinat:\n${err.message}`, m)
  }
}

handler.help = ['mikasa <teks>']
handler.tags = ['ai']
handler.command = /^mikasa$/i
handler.limit = true

export default handler
