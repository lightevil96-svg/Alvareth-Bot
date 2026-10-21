import { tiktokSearch, tiktokScrape } from '../../lib/scrape/tikwm.js'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  await m.react('✨')

  const input = m.quoted ? m.quoted.text : text
  if (!input) {
    return m.reply(
      `Contoh:\n` +
      `${usedPrefix + command} https://vt.tiktok.com/xxxx\n` +
      `${usedPrefix + command} ryo yamada edit`
    )
  }

  try {
    let url = input

    if (!/^https?:\/\//i.test(input)) {
      const results = await tiktokSearch(input)
      if (!results.length) throw 'Hasil tidak ditemukan'
      url = results[0].url
    }

    const res = await tiktokScrape(url)
    if (!res) throw 'Gagal mengambil data TikTok'

    const title = (res.title || '-').replace(/\s+/g, ' ').trim()
    const uploader = res.author || '-'

    const caption = `*\`TikTok Downloader\`*

✿ *\`Judul\`* : ${title.length > 80 ? title.slice(0, 80) + '...' : title}
✿ *\`Uploader\`* : ${uploader}`

    if (res.type === 'image' && res.images.length > 0) {
      await conn.sendMessage(
        m.chat,
        {
          album: res.images.map((img, i) => ({
            image: { url: img },
            caption: i === 0 ? caption : ''
          }))
        },
        { quoted: m }
      )

      if (res.audio) {
        await conn.sendMessage(
          m.chat,
          {
            audio: { url: res.audio },
            mimetype: 'audio/mpeg'
          },
          { quoted: m }
        )
      }

      await m.react('✅')
      return
    }

    if (res.video) {
      await conn.sendMessage(
        m.chat,
        {
          video: { url: res.video },
          caption
        },
        { quoted: m }
      )
    }

    if (res.audio) {
      await conn.sendMessage(
        m.chat,
        {
          audio: { url: res.audio },
          mimetype: 'audio/mpeg'
        },
        { quoted: m }
      )
    }

    await m.react('✅')
  } catch (e) {
    await m.react('❌')
    throw String(e)
  }
}

handler.help = ['tt', 'tiktok']
handler.tags = ['downloader']
handler.command = /^(tt|tiktok)$/i
handler.limit = true
handler.register = false

export default handler