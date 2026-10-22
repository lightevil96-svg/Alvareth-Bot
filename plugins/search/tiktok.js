import { tiktokSearch, tiktokScrape } from '../../lib/scrape/tikwm.js'

let handler = async (m, { text, conn, usedPrefix, command }) => {
  if (!text) throw 'Contoh:\n' + usedPrefix + command + ' Re:Zero anime'

  if (text.includes('|')) {
    const [action, query, encodedUrl] = text.split('|').map(value => value.trim())

    if (action === 'play') {
      if (!encodedUrl) throw 'Tautan video tidak ditemukan. Silakan jalankan pencarian ulang.'

      let url
      try {
        url = decodeURIComponent(encodedUrl)
      } catch {
        throw 'Tautan video tidak valid. Silakan jalankan pencarian ulang.'
      }

      if (!/^https?:\/\/(?:[^/]+\.)?tiktok\.com\//i.test(url)) {
        throw 'Tautan yang dipilih bukan tautan TikTok yang valid.'
      }

      const data = await tiktokScrape(url)
      if (!data) throw 'Gagal mengambil video dari TikTok. Coba pilih hasil lain atau ulangi beberapa saat lagi.'

      const caption = 'TIKTOK SEARCH\n\nQuery : ' + (query || '-') +
        '\nJudul : ' + (data.title || 'TikTok Video') +
        '\nUploader : ' + (data.author || 'Unknown')

      if (data.type === 'image' && Array.isArray(data.images) && data.images.length) {
        for (const [index, imageUrl] of data.images.entries()) {
          await conn.sendMessage(m.chat, {
            image: { url: imageUrl },
            caption: index === 0 ? caption : undefined
          }, { quoted: m })
        }
        return
      }

      if (!data.video) throw 'Tautan ini tidak menyediakan file video yang bisa diunduh. Coba pilih hasil lain.'

      return await conn.sendMessage(m.chat, {
        video: { url: data.video },
        caption,
        footer: 'Alvareth Bot · TikTok Search'
      }, { quoted: m })
    }

    throw 'Aksi tidak dikenali. Silakan jalankan pencarian TikTok lagi.'
  }

  let videos
  try {
    videos = await tiktokSearch(text)
  } catch (error) {
    console.error('[TTSEARCH Error]', error?.message || error)
    throw 'Pencarian TikTok sedang mengalami gangguan pada layanan pencarian.\n' +
      'Coba lagi beberapa saat lagi.\n\nDetail: ' +
      String(error?.message || error).slice(0, 240)
  }

  if (!videos.length) throw 'Tidak ditemukan hasil TikTok untuk "' + text + '". Coba kata kunci lain, misalnya "' + text + ' anime" atau "' + text + ' edit".'

  const rows = videos.slice(0, 10).map(video => ({
    title: String(video.title || 'TikTok Video').replace(/\s+/g, ' ').slice(0, 60),
    description: String(video.author || 'TikTok').replace(/\s+/g, ' ').slice(0, 80),
    id: usedPrefix + command + ' play|' +
      encodeURIComponent(text) + '|' + encodeURIComponent(video.url)
  }))

  const intro = '❀ Hasil pencarian TikTok: ' + text +
    '\nTotal: ' + videos.length + ' video\nPilih salah satu hasil untuk mengirim videonya.'

  try {
    const sent = await conn.sendMessage(m.chat, {
      text: intro,
      footer: 'Alvareth Bot · TikTok Search',
      nativeFlow: [{
        text: '❀ Pilih Video',
        sections: [{
          title: 'Daftar Video',
          rows
        }]
      }]
    }, { quoted: m })

    if (sent?.key) return sent
    throw new Error('WhatsApp tidak mengembalikan ID pesan hasil pencarian.')
  } catch (error) {
    // Keep search useful if a WhatsApp client/library version cannot render the list UI.
    console.error('[TTSEARCH List UI Error]', error?.message || error)
    const links = videos.slice(0, 10).map((video, index) =>
      (index + 1) + '. ' + String(video.title || 'TikTok Video').slice(0, 100) +
      '\nUploader: ' + String(video.author || 'Unknown').slice(0, 60) +
      '\n' + video.url
    )
    return await conn.sendMessage(m.chat, {
      text: intro + '\n\n' + links.join('\n\n'),
      footer: 'Alvareth Bot · TikTok Search'
    }, { quoted: m })
  }
}

handler.help = ['ttsearch', 'tiktoksearch']
handler.tags = ['search']
handler.command = /^(ttsearch|tiktoksearch)$/i
handler.limit = true
handler.register = true

export default handler
