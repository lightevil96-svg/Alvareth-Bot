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

    let items = []
    let primaryError = null
    let primaryMessage = ''
    try {
      const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/api/search/pinterest-v2`, {
        params,
        timeout: 20000,
        headers: { Accept: 'application/json' }
      })
      primaryMessage = String(data?.message || data?.msg || data?.error || '')
      const results = Array.isArray(data?.result)
        ? data.result
        : Array.isArray(data?.data)
          ? data.data
          : []
      items = results.map(item => ({
        ...item,
        image: item?.image || item?.image_url || item?.images_url || item?.thumbnail,
        title: item?.title || item?.grid_title || item?.name,
        pinner: item?.pinner || item?.username || item?.author,
        link: item?.link || item?.pin_url || ''
      })).filter(item => typeof item.image === 'string' && /^https?:\/\//i.test(item.image)).slice(0, 10)
      if (!items.length && data?.status === false) {
        primaryError = new Error(primaryMessage || 'Kyzz API mengembalikan status gagal')
      }
    } catch (error) {
      primaryError = error
      console.warn('[PINTEREST] Kyzz v2 gagal:', error.response?.status || error.message)
    }

    // Fallback to the SC's previous Nexray search endpoint when Kyzz is down,
    // refuses the API key, or returns no usable image results.
    if (!items.length && global.APIs?.nexray) {
      try {
        const fallbackUrl = `${String(global.APIs.nexray).replace(/\/$/, '')}/search/pinterest`
        const { data } = await axios.get(fallbackUrl, {
          params: { q: query },
          timeout: 20000,
          headers: { Accept: 'application/json' }
        })
        const fallbackResults = Array.isArray(data?.result) ? data.result : []
        items = fallbackResults.map(item => ({
          ...item,
          image: item?.image || item?.image_url || item?.images_url || item?.thumbnail,
          title: item?.title || item?.grid_title || item?.name,
          pinner: item?.pinner || item?.username || item?.author,
          link: item?.link || item?.pin_url || ''
        })).filter(item => typeof item.image === 'string' && /^https?:\/\//i.test(item.image)).slice(0, 10)
      } catch (fallbackError) {
        console.warn('[PINTEREST] Nexray fallback gagal:', fallbackError.response?.status || fallbackError.message)
      }
    }

    if (!items.length) {
      await react('❌')
      const status = primaryError?.response?.status
      if (status === 401 || status === 403 || /api.?key|unauthori[sz]ed|forbidden|auth/i.test(`${primaryMessage} ${primaryError?.message || ''}`)) {
        return m.reply('❌ API Kyzz menolak akses dan hasil cadangan tidak tersedia. Isi API key Kyzz yang valid pada KYZZ_API_KEY di file .env, lalu restart bot.')
      }
      if (status === 404) {
        return m.reply('❌ Endpoint Pinterest Kyzz tidak ditemukan dan pencarian cadangan gagal. Periksa alamat API atau coba lagi nanti.')
      }
      if (status === 429) {
        return m.reply('❌ Batas permintaan API Pinterest tercapai. Coba lagi beberapa saat.')
      }
      return m.reply(`❌ Tidak ada gambar Pinterest yang bisa dimuat untuk *"${query}"*. Kedua layanan pencarian gagal atau tidak mengembalikan gambar valid.`)
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
