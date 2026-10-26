import yts from 'yt-search'

const BOT_LINK = 'https://spoo.me/Alvareth-Bot'
const BOT_THUMB = 'https://raw.githubusercontent.com/lightevil96-svg/Alvareth-Bot/main/media/alvareth-character.png'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
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
      return await conn.sendMessage(m.chat, { text: replyText }, { quoted: m, noAlvarethPreview: true })
    }
  }

  try {
    const search = await yts(text)
    const video = search.videos?.[0]
    if (!video) {
      return await conn.sendMessage(m.chat, {
        text: 'Tidak ditemukan lagu/video yang cocok dengan pencarian itu.'
      }, { quoted: m, noAlvarethPreview: true })
    }

    const clean = value => String(value || '-').replace(/[\r\n]+/g, ' ').trim()
    const caption = [
      '🎵 *PLAY MUSIC — ALVARETH*',
      '',
      '📝 *Judul:* ' + clean(video.title),
      '⏱️ *Durasi:* ' + clean(video.timestamp),
      '👁️ *Views:* ' + formatNumber(video.views),
      '🎤 *Channel:* ' + clean(video.author?.name) + (video.author?.verified ? ' ✓' : ''),
      '📅 *Upload:* ' + clean(video.ago),
    ].join('\n')

    // Keep media and the interactive picker as two separate messages. The old
    // combined image+nativeFlow payload was being rewritten by the global link
    // preview wrapper, and sender-side display alone did not prove recipient delivery.
    const thumbnailMessage = await conn.sendMessage(m.chat, {
      image: { url: video.thumbnail },
      caption
    }, { quoted: m, noAlvarethPreview: true })

    if (!thumbnailMessage?.key?.id) {
      throw new Error('WhatsApp tidak mengembalikan ID pesan thumbnail.')
    }

    const prefix = usedPrefix || '.'
    const audioBest = `${prefix}ytmp3 ${video.url}|320`
    const audioLow = `${prefix}ytmp3 ${video.url}|128`
    const videoBest = `${prefix}ytmp4 ${video.url}|best`
    const videoLow = `${prefix}ytmp4 ${video.url}|360`

    const pickerCaption = [
      '🎚️ *PILIH KUALITAS DOWNLOAD*',
      '',
      '🎧 Audio terbaik: sumber audio tertinggi yang tersedia, MP3 320 kbps.',
      '🎧 Audio hemat: MP3 128 kbps, ukuran file lebih kecil.',
      '🎬 Video terbaik: resolusi tertinggi yang tersedia (HD/4K jika tersedia).',
      '🎬 Video hemat: target 360p untuk menghemat data.'
    ].join('\n')

    const pickerMessage = await conn.sendMessage(m.chat, {
      text: pickerCaption,
      footer: 'Alvareth Bot • Pilih format dan kualitas',
      optionText: 'Pilih Kualitas',
      optionTitle: 'Audio / Video',
      nativeFlow: [
        {
          text: 'Pilih Format Download',
          sections: [
            {
              title: '🎧 AUDIO MP3',
              rows: [
                {
                  title: '✨ Kualitas Terbaik',
                  description: 'Sumber terbaik • MP3 320 kbps',
                  id: audioBest
                },
                {
                  title: '📦 Kualitas Hemat',
                  description: 'MP3 128 kbps • file lebih kecil',
                  id: audioLow
                }
              ]
            },
            {
              title: '🎬 VIDEO MP4',
              rows: [
                {
                  title: '✨ Kualitas Tertinggi (HD)',
                  description: 'Resolusi maksimum yang tersedia',
                  id: videoBest
                },
                {
                  title: '📦 Kualitas Hemat (360p)',
                  description: 'Lebih ringan untuk kuota',
                  id: videoLow
                }
              ]
            }
          ]
        }
      ],
      interactiveAsTemplate: false
    }, { quoted: m, noAlvarethPreview: true })

    if (!pickerMessage?.key?.id) {
      throw new Error('WhatsApp tidak mengembalikan ID pesan menu kualitas.')
    }

    console.log('[.play] Thumbnail dan menu kualitas dikirim ke chat:', m.chat)
  } catch (error) {
    console.error('[.play] Gagal mencari/mengirim hasil:', error?.stack || error)
    await conn.sendMessage(m.chat, {
      text: '❌ Pencarian atau pengiriman menu Play gagal: ' + String(error?.message || error)
    }, { quoted: m, noAlvarethPreview: true })
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
