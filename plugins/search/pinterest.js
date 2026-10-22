import axios from 'axios'

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const query = text?.trim()
  if (!query) {
    return m.reply(
      `*Pinterest Search*\n\nContoh penggunaan:\n${usedPrefix + command} aesthetic wallpaper\n${usedPrefix + command} anime wallpaper`
    )
  }

  const client = conn || global.mainSock || global.conn
  if (!client) return m.reply('❌ Koneksi WhatsApp belum siap.')

  const react = async (emoji) => {
    try {
      if (m.key) await client.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
    } catch (error) {
      console.warn('[PINTEREST] Gagal mengirim reaksi:', error.message)
    }
  }

  await react('⏳')

  try {
    const baseUrl = global.APIs?.kyzzz || global.APIs?.kyzz
    if (!baseUrl) throw new Error('API Pinterest belum dikonfigurasi.')

    const apiKey = global.APIKeys?.[baseUrl]
    const params = { q: query }
    if (apiKey && apiKey !== 'ISI_APIKEY') params.apikey = apiKey

    const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/api/search/pinterest-v2`, {
      params,
      timeout: 20000,
      headers: { Accept: 'application/json' }
    })

    if (!data?.status || !Array.isArray(data.result) || data.result.length === 0) {
      await react('❌')
      return m.reply(`❌ Tidak ada gambar Pinterest ditemukan untuk *"${query}"*.`)
    }

    const items = data.result
      .filter(item => typeof item?.image === 'string' && /^https?:\/\//i.test(item.image))
      .slice(0, 10)

    if (!items.length) {
      await react('❌')
      return m.reply('❌ Hasil ditemukan, tetapi tidak ada URL gambar valid yang dapat dimuat.')
    }

    const album = items.map((item, index) => {
      const title = typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : `Gambar ${index + 1}`
      const pinner = item.pinner || item.username || 'Pengguna Pinterest'
      const likes = item.likes !== undefined && item.likes !== null && item.likes !== ''
        ? `\n❤️ Likes: ${Number(item.likes).toLocaleString('id-ID')}`
        : ''
      const pinLink = typeof item.link === 'string' && /^https?:\/\//i.test(item.link)
        ? item.link
        : `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`

      return {
        image: { url: item.image },
        caption: `📌 *Pinterest • ${index + 1}/${items.length}*\n\n🔎 *Pencarian:* ${query}\n🖼️ *Judul:* ${title.slice(0, 180)}\n👤 *Pinner:* ${pinner}${likes}\n🔗 ${pinLink}\n\n© ${global.namebot || 'Alvareth Bot'}`
      }
    })

    // Use the album feature already supported by this repository's Baileys fork.
    // Avoid ruby-baileys/src helper imports, which are not present in this project.
    await client.sendMessage(m.chat, { album }, { quoted: m })
    await react('✅')
  } catch (error) {
    console.error('[PINTEREST SEARCH ERROR]', error.response?.data || error.stack || error.message)
    await react('❌')
    return m.reply('❌ Gagal mencari gambar Pinterest. Coba lagi nanti atau periksa konfigurasi API Kyzz.')
  }
}

handler.help = ['pinterest <kata_kunci>', 'pin <kata_kunci>']
handler.tags = ['search']
handler.command = /^(pinterest|pin)$/i
handler.register = true
handler.limit = true

export default handler
