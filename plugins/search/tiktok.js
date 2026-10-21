import { tiktokSearch, tiktokScrape } from '../../lib/scrape/tikwm.js'

let handler = async (m, { text, conn, usedPrefix, command }) => {
  if (!text) throw `Contoh:\n${usedPrefix + command} ryo yamada edit`

  if (text.includes('|')) {
    const [action, query, encodedUrl] = text.split('|').map(v => v.trim())

    if (action === 'play') {
      const url = decodeURIComponent(encodedUrl)
      const data = await tiktokScrape(url)

      if (!data) throw 'Gagal mengambil video'

      const caption = `TIKTOK SEARCH

Query : ${query}
Judul : ${data.title}
Uploader : ${data.author}`

      if (data.type === 'image' && data.images.length) {
        for (const [i, img] of data.images.entries()) {
          await conn.sendMessage(m.chat, {
            image: { url: img },
            caption: i === 0 ? caption : undefined
          }, { quoted: m })
        }
        return
      }

      return await conn.sendMessage(m.chat, {
        video: { url: data.video },
        caption,
        footer: 'ʀʏᴏ ʏᴀᴍᴀᴅᴀ - ᴍᴅ'
      }, { quoted: m })
    }

    throw 'Aksi tidak dikenali'
  }

  const videos = await tiktokSearch(text)
  if (!videos.length) throw `Tidak ditemukan "${text}"`

  const rows = videos.slice(0, 10).map(v => ({
    title: v.title?.slice(0, 60) || 'Tanpa judul',
    description: v.author,
    id: `${usedPrefix + command} play|${encodeURIComponent(text)}|${encodeURIComponent(v.url)}`
  }))

  return await conn.sendMessage(m.chat, {
    text: `❀ Hasil pencarian: ${text}\nTotal: ${videos.length} video`,
    footer: 'TikTok Search',
    nativeFlow: [{
      text: '❀ Pilih Video',
      sections: [{
        title: 'Daftar Video',
        rows
      }]
    }]
  }, { quoted: m })
}

handler.help = ['ttsearch', 'tiktoksearch']
handler.tags = ['search']
handler.command = /^(ttsearch|tiktoksearch)$/i
handler.limit = true
handler.register = true

export default handler