/* Alvareth Bot AI plugin */

import fetch from "node-fetch"

let sessions = {}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Contoh:\n${usedPrefix + command} halo ryo`)
  }

  await m.react('✨')

  let userId = m.sender
  let system = `
Kamu adalah Ryo Yamada dari anime "Bocchi the Rock!".
Gaya bicara:
- Cool, flat, deadpan
- Jarang menunjukkan emosi tapi perhatian diam-diam
- Jujur, to the point
- Kadang menggoda secara kalem
- Misterius, elegan, tidak banyak bicara tapi tepat

Selalu balas sebagai Ryo ke user (cowok). Jangan keluar karakter.
User adalah orang yang cukup dekat dan menarik perhatianmu.
`

  let finalPrompt = `${system}\nUser: ${text}\nRyo:`

  try {
    const res = await fetch('https://www.puruboy.kozow.com/api/ai/gemini-v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: finalPrompt })
    })

    const json = await res.json()
    const result = json?.result?.answer || null

    if (!result) throw Error("Gagal mendapatkan respon dari API.")

    const { prepareWAMessageMedia } = await import('baileys')

    const urlB = global.botLink || 'https://spoo.me/Alvareth-Bot'
    const img = 'https://raw.githubusercontent.com/lightevil96-svg/Alvareth-Bot/main/media/thumbnail.jpg'

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
        title: 'Alvareth Bot',
        description: 'WhatsApp Bot',
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
    await m.reply("Maaf, sepertinya ada masalah dengan ingatanku (API Error).")
  }
}

handler.help = ['ryo <teks>', 'ryoyamada <teks>', 'ryoai <teks>']
handler.tags = ['ai']
handler.command = /^(ryo|ryoyamada|ryoai)$/i
handler.limit = true

export default handler
