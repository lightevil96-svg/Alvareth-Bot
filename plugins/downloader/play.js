import yts from 'yt-search'
import fs from 'fs'
import { prepareWAMessageMedia } from 'baileys'

const BOT_LINK = 'https://spoo.me/Alvareth-Bot'
const BOT_THUMB = './media/alvareth-character.png'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    // Kirim preview eksplisit di plugin .play agar tidak mewarisi preview lama dari m.reply().
    const thumbnail = fs.readFileSync(BOT_THUMB)
    const { imageMessage: highQualityThumbnail } = await prepareWAMessageMedia({
      image: thumbnail
    }, {
      upload: conn.waUploadToServer,
      mediaTypeOverride: 'thumbnail-link'
    })
    highQualityThumbnail.width = 1280
    highQualityThumbnail.height = 720

    return conn.sendMessage(m.chat, {
      text: `${BOT_LINK}\n\nContoh: ${usedPrefix + command} judul lagu`,
      linkPreview: {
        'matched-text': BOT_LINK,
        title: 'Alvareth Bot',
        description: 'WhatsApp Bot',
        previewType: 0,
        jpegThumbnail: thumbnail,
        highQualityThumbnail,
        linkPreviewMetadata: {
          linkMediaDuration: 0,
          socialMediaPostType: 4
        }
      }
    }, { quoted: m })
  }

  try {
    const search = await yts(text)
    const videos = search.videos

    if (!videos.length) {
      return m.reply('Tidak ditemukan.')
    }

    const video = videos[0]

    const caption = `Play Music

✿ Title : ${video.title}
✿ Duration : ${video.timestamp || '-'}
✿ Views : ${formatNumber(video.views)}
✿ Channel : ${video.author.name}${video.author.verified ? ' ✓' : ''}
✿ Upload : ${video.ago || '-'}

Silakan pilih format download di bawah.`

    await conn.sendMessage(m.chat, {
      image: { url: video.thumbnail },
      caption,
      footer: 'Alvareth Bot',
      optionText: 'Pilih',
      optionTitle: 'Download',
      nativeFlow: [
        {
          text: 'Pilih Format',
          sections: [
            {
              title: 'Downloader',
              rows: [
                {
                  title: 'Audio MP3',
                  description: 'Download sebagai MP3',
                  id: `.ytmp3 ${video.url}`
                },
                {
                  title: 'Audio MP3 V2',
                  description: 'Download sebagai MP3 V2',
                  id: `.ytmp3v2 ${video.url}`
                },
                {
                  title: 'Video MP4',
                  description: 'Download sebagai MP4',
                  id: `.ytmp4 ${video.url}`
                },
                {
                  title: 'Video MP4 V2',
                  description: 'Download sebagai MP4 V2',
                  id: `.ytmp4v2 ${video.url}`
                }
              ]
            }
          ]
        }
      ]
    }, { quoted: m })

  } catch (e) {
    console.error(e)
    m.reply('Terjadi kesalahan.')
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