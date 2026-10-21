import axios from "axios"

let handler = async (m, { conn, text }) => {
  try {
    if (!text) {
      await m.react('❌')
      return m.reply(`Contoh:\n.tiktokdl2 https://vm.tiktok.com/xxxxx/`)
    }

    await m.react('✨')

    const result = await getTiktokMedia(text)

    if (!result) {
      await m.react('❌')
      return m.reply("Tidak ada response dari server.")
    }

    if (result.error) {
      await m.react('❌')
      return m.reply("Error:\n" + JSON.stringify(result.error, null, 2))
    }

    let caption = `
— tiktok downloader —

❀ author : ${result.username || "-"}
`.trim()

    let annotations = [
      {
        polygonVertices: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 1000 },
          { x: 0, y: 1000 }
        ],
        shouldSkipConfirmation: true,
        embeddedContent: {
          embeddedMusic: {
            musicContentMediaId: "1409620227516822",
            songId: "244215252974958",
            author: "Elaina - MD",
            title: "\u200B",
            artistAttribution: global.linkch || "",
            countryBlocklist: "",
            isExplicit: false,
            artworkMediaKey: ""
          }
        },
        embeddedAction: true
      }
    ]

    if (result.video_nowm || result.video_wm) {
      const videoUrl = result.video_nowm || result.video_wm

      await conn.sendMessage(
        m.chat,
        {
          video: { url: videoUrl },
          caption,
          annotations
        },
        { quoted: m }
      )

      await m.react('✅')
      return
    }

    if (result.images && Array.isArray(result.images)) {
      let first = true

      for (let img of result.images) {
        await conn.sendMessage(
          m.chat,
          {
            image: { url: img.url || img },
            caption: first ? caption : '',
            annotations
          },
          { quoted: m }
        )
        first = false
      }

      await m.react('✅')
      return
    }

    await m.react('❌')
    m.reply("Media tidak ditemukan.")

  } catch (e) {
    console.error(e)
    await m.react('❌')
    m.reply("Terjadi kesalahan: " + e.message)
  }
}

handler.help = ['tiktokdl2 <url>']
handler.tags = ['downloader']
handler.command = /^tiktokdl2$/i
handler.limit = true

export default handler


async function getTiktokMedia(input) {
  try {
    let id = input

    if (input.includes("tiktok.com")) {
      const res = await axios.get(input, {
        maxRedirects: 0,
        validateStatus: status => status >= 200 && status < 400
      }).catch(async (err) => {
        if (err.response?.headers?.location) {
          return { headers: { location: err.response.headers.location } }
        }
        throw err
      })

      const redirectUrl = res.headers.location || input

      const match = redirectUrl.match(/video\/(\d+)/)
      if (match) {
        id = match[1]
      } else {
        id = redirectUrl.split("/").filter(Boolean).pop()
      }
    }

    const { data } = await axios.get(
      "https://api.twitterpicker.com/tiktok/mediav2",
      {
        params: { id },
        headers: { Accept: "application/json" }
      }
    )

    return {
      id: data.id,
      username: data.user?.username,
      video_nowm: data.video_no_watermark?.url,
      video_wm: data.video_watermark?.url,
      audio: data.audio?.url,
      images: data.images || null
    }

  } catch (err) {
    return { error: err.response?.data || err.message }
  }
}