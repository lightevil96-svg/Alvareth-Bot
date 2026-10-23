import yts from 'yt-search'

const BOT_LINK = 'https://spoo.me/Alvareth-Bot'
const BOT_THUMB = 'https://raw.githubusercontent.com/lightevil96-svg/Alvareth-Bot/main/media/alvareth-character.png'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    // Jangan taruh URL Spoo.me di teks pesan: WhatsApp akan mengambil OG metadata
    // dari identitas tautan lama. Gunakan externalAdReply yang eksplisit.
    const replyText = `Gunakan perintah: ${usedPrefix + command} judul lagu`
    const message = {
      text: replyText,
      contextInfo: {
        externalAdReply: {
          title: 'Alvareth Bot',
          body: 'WhatsApp Bot',
          thumbnailUrl: BOT_THUMB,
          sourceUrl: BOT_LINK,
          mediaType: 1,
          renderLargerThumbnail: true,
          showAdAttribution: false
        }
      }
    }

    try {
      return await conn.sendMessage(m.chat, message, { quoted: m })
    } catch (error) {
      console.error('[.play] Gagal mengirim preview Alvareth; mencoba teks biasa:', error)
      try {
        return await conn.sendMessage(m.chat, { text: replyText }, { quoted: m })
      } catch (sendError) {
        console.error('[.play] Gagal mengirim balasan teks:', sendError)
        throw sendError
      }
    }
  }

  try {
    const search = await yts(text)
    const videos = search.videos

    if (!videos.length) {
      return await m.reply('Tidak ditemukan.')
    }

    const video = videos[0]
    const caption = `Play Music

✿ Title : ${video.title}
✿ Duration : ${video.timestamp || '-'}
✿ Views : ${formatNumber(video.views)}
✿ Channel : ${video.author.name}${video.author.verified ? ' ✓' : ''}
✿ Upload : ${video.ago || '-'}

Silakan pilih format download di bawah.`

    return await m.reply(caption + `\n\nLink video: ${video.url}\n\nDownload audio: .ytmp3 ${video.url}\nDownload video: .ytmp4 ${video.url}`)
  } catch (error) {
    console.error('[.play] Gagal mencari/mengirim hasil:', error)
    return await m.reply('Pencarian lagu gagal. Coba lagi beberapa saat.')
  }
}

handler.help = ['play']
handler.tags = ['downloader']
handler.command = /^(play)$/i

export default handler

function formatNumber(num = 0) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B'
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M'
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K'
  return num.toString()
}