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

    const displayValue = (value, fallback = '-') => {
      if (typeof value === 'string' || typeof value === 'number') {
        const result = String(value).trim()
        return result || fallback
      }
      if (value && typeof value === 'object') {
        // API responses sometimes return author/pinner as an object instead of a string.
        const result = value.name || value.username || value.full_name || value.title
        return typeof result === 'string' && result.trim() ? result.trim() : fallback
      }
      return fallback
    }

    // Download and validate media first: one blocked URL must not fail every carousel card.
    const mediaItems = await Promise.all(items.map(async (item, index) => {
      try {
        const response = await axios.get(item.image, {
          responseType: 'arraybuffer',
          timeout: 18000,
          maxContentLength: 8 * 1024 * 1024,
          maxBodyLength: 8 * 1024 * 1024,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          }
        })
        const mime = String(response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
        const imageBuffer = Buffer.from(response.data)
        if (!imageBuffer.length || (mime && !mime.startsWith('image/'))) throw new Error('Respons URL bukan file gambar')
        return { ...item, imageBuffer }
      } catch (error) {
        console.warn(`[PINTEREST MEDIA ${index + 1}] Gambar dilewati:`, error.message)
        return null
      }
    }))
    const readyItems = mediaItems.filter(Boolean).slice(0, 10)

    if (readyItems.length === 0) {
      await react('❌')
      return m.reply('❌ Pinterest menemukan hasil, tetapi gambar tidak bisa diunduh dari sumbernya. Coba kata kunci lain atau ulangi nanti.')
    }

    const makeCaption = (item, index, total) => {
      const title = displayValue(item.title, `Gambar ${index + 1}`)
      const pinner = displayValue(item.pinner || item.username || item.author, 'Pengguna Pinterest')
      const rawLikes = Number(item.likes)
      const likes = item.likes !== undefined && item.likes !== null && item.likes !== '' && Number.isFinite(rawLikes)
        ? `\n❤️ *Likes:* ${rawLikes.toLocaleString('id-ID')}`
        : ''
      return `🔎 *Pencarian:* ${query}\n🖼️ *Judul:* ${title.slice(0, 180)}\n👤 *Pinner:* ${pinner}${likes}\n📌 Pinterest • ${index + 1}/${total}`
    }

    const makePinLink = item => typeof item.link === 'string' && /^https?:\/\//i.test(item.link)
      ? item.link
      : `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`

    // User opted for the original normal image album instead of interactive cards/carousel.
    // This fork supports { album: [{ image: Buffer, caption }] } and sends each image as an album item.
    const album = readyItems.map((item, index) => ({
      image: item.imageBuffer,
      caption: `${makeCaption(item, index, readyItems.length)}\n🔗 ${makePinLink(item)}\n\n© ${global.namebot || 'Alvareth Bot'}`
    }))

    let delivered = false
    try {
      if (album.length >= 2) {
        const sent = await client.sendMessage(m.chat, { album }, { quoted: m })
        delivered = Boolean(sent?.key?.id)
      } else {
        const item = readyItems[0]
        const sent = await client.sendMessage(m.chat, {
          image: item.imageBuffer,
          caption: `${makeCaption(item, 0, 1)}\n🔗 ${makePinLink(item)}\n\n© ${global.namebot || 'Alvareth Bot'}`
        }, { quoted: m })
        delivered = Boolean(sent?.key?.id)
      }
    } catch (sendError) {
      console.error('[PINTEREST ALBUM SEND FAILED]', sendError?.stack || sendError)
      await react('❌')
      return m.reply('❌ Gambar Pinterest sudah ditemukan, tetapi gagal dikirim. Periksa log terminal untuk detail error media.')
    }

    if (!delivered) {
      await react('❌')
      return m.reply('❌ Pengiriman hasil Pinterest tidak mengembalikan ID pesan. Coba lagi nanti.')
    }
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
handler.register = false
handler.limit = true

export default handler
