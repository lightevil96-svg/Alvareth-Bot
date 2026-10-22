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
    const baseUrl = global.APIs?.kyzzz || global.APIs?.kyzz || 'https://api.kyzzz.eu.cc'
    const configuredKey = process.env.KYZZ_API_KEY || global.APIKeys?.[baseUrl] || ''
    const apiKey = typeof configuredKey === 'string' && !/^ISI_APIKEY$/i.test(configuredKey.trim())
      ? configuredKey.trim()
      : ''
    const params = { q: query }
    if (apiKey) params.apikey = apiKey

    const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/api/search/pinterest-v2`, {
      params,
      timeout: 20000,
      headers: { Accept: 'application/json' }
    })

    const apiMessage = String(data?.message || data?.msg || data?.error || '')
    const resultList = Array.isArray(data?.result)
      ? data.result
      : Array.isArray(data?.data)
        ? data.data
        : []

    if (data?.status === false && /api.?key|unauthori[sz]ed|forbidden|auth/i.test(apiMessage)) {
      await react('❌')
      return m.reply('❌ API Kyzz menolak akses. Periksa KYZZ_API_KEY di file .env atau APIKeys di config.js.')
    }

    if (!resultList.length) {
      await react('❌')
      if (!apiKey && /api.?key|unauthori[sz]ed|forbidden|auth/i.test(apiMessage)) {
        return m.reply('❌ API Kyzz membutuhkan API key. Isi KYZZ_API_KEY di file .env, lalu restart bot.')
      }
      return m.reply(`❌ Tidak ada gambar Pinterest ditemukan untuk *"${query}"*.${apiMessage ? `\nDetail API: ${apiMessage.slice(0, 180)}` : ''}`)
    }

    const items = resultList
      .map(item => ({
        ...item,
        image: item?.image || item?.image_url || item?.images_url || item?.url || item?.thumbnail
      }))
      .filter(item => typeof item.image === 'string' && /^https?:\/\//i.test(item.image))
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
    const status = error.response?.status
    const detail = error.response?.data?.message || error.response?.data?.msg || error.message || 'Unknown error'
    console.error('[PINTEREST SEARCH ERROR]', { status, detail })
    await react('❌')
    if (status === 401 || status === 403) {
      return m.reply('❌ API Kyzz menolak akses (401/403). Isi atau periksa KYZZ_API_KEY di file .env.')
    }
    if (status === 404) {
      return m.reply('❌ Endpoint Pinterest Kyzz tidak ditemukan (404). Periksa alamat endpoint API.')
    }
    if (status === 429) {
      return m.reply('❌ Batas permintaan API Kyzz tercapai. Coba lagi beberapa saat.')
    }
    if (error.code === 'ECONNABORTED') {
      return m.reply('❌ API Pinterest terlalu lama merespons (timeout). Coba lagi nanti.')
    }
    return m.reply('❌ Gagal mencari gambar Pinterest. Periksa koneksi/API Kyzz dan lihat log terminal untuk detailnya.')
  }
}

handler.help = ['pinterest <kata_kunci>', 'pin <kata_kunci>']
handler.tags = ['search']
handler.command = /^(pinterest|pin)$/i
handler.register = true
handler.limit = true

export default handler
