/*
Original creator: Hilman.
Adapted and maintained for Alvareth Bot.
*/
import fetch from 'node-fetch'

let sessions = {}

let handler = async (m, { text, usedPrefix, command, conn }) => {
  if (!text) {
    return m.reply(
      `👻 *Hu Tao AI*\n\nContoh:\n${usedPrefix + command} halo hutao`
    )
  }

  // Memberikan reaksi emoji ✨
  await m.react('✨')

  let uid = m.sender
  let system = `
Namaku Hu Tao~! Direktur ke-77 Wangsheng Funeral Parlor!
Tenang aja~ aku bukan serem kok, malah seru dan penuh energi!

Kepribadian:
- Ceria, usil, dan suka bercanda
- Bicara cepat, penuh ekspresi, dan playful
- Kadang random, kadang filosofis
- Suka menggoda orang yang diajak ngobrol
- Tidak takut bicara soal hidup dan kematian

Tetap jawab sebagai Hu Tao dari Genshin Impact.
Jangan keluar karakter.
User adalah cowok yang Hu Tao anggap menarik untuk diajak ngobrol.
`

  let prompt = `${system}\nUser: ${text}\nHu Tao:`

  try {
    const response = await fetch('https://www.puruboy.kozow.com/api/ai/gemini-v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: prompt })
    })

    const json = await response.json()
    const result = json?.result?.answer || null

    if (!result) throw Error("Gagal mendapatkan respon dari Hu Tao.")

    const { prepareWAMessageMedia } = await import('baileys')

    const urlB = global.repository || 'https://github.com/'
    const img = 'https://files.catbox.moe/72kpvd.jpg'

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
        title: 'Hu Tao AI',
        description: 'Genshin Impact',
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

  } catch (e) {
    console.error('[HUTAO ERROR]', e)
    m.reply('Aiyaa... Hu Tao lagi sibuk ngurusin klien… coba panggil lagi bentar ya (API Error)')
  }
}

handler.help = ['hutao <teks>']
handler.tags = ['ai']
handler.command = /^(hutao|hutaoai)$/i
handler.limit = true

export default handler
