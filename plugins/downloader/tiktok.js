import { tiktokSearch, tiktokScrape } from '../../lib/scrape/tikwm.js'

// Some messages in this Baileys fork are protobuf-converted objects without the
// serializer prototype methods. Send reactions through the socket directly.
async function reactSafe(conn, m, text) {
  if (!m?.chat || !m?.key) return
  try {
    await conn.sendMessage(m.chat, { react: { text, key: m.key } })
  } catch (error) {
    console.warn('[TikTok] Gagal mengirim reaksi:', error?.message || error)
  }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  await reactSafe(conn, m, '✨')

  const input = m.quoted ? m.quoted.text : text
  if (!input) {
    return m.reply(
      `Contoh:\n` +
      `${usedPrefix + command} https://vt.tiktok.com/xxxx\n` +
      `${usedPrefix + command} ryo yamada edit`
    )
  }

  try {
    let url = input

    if (!/^https?:\/\//i.test(input)) {
      const results = await tiktokSearch(input)
      if (!results.length) throw 'Hasil tidak ditemukan'
      url = results[0].url
    }

    const res = await tiktokScrape(url)
    if (!res) throw 'Gagal mengambil data TikTok'

    const title = (res.title || '-').replace(/\s+/g, ' ').trim()
    const uploader = res.author || '-'

    const displayTitle = title.length > 220 ? title.slice(0, 217).trimEnd() + '...' : title
    const displayUploader = String(uploader).length > 80 ? String(uploader).slice(0, 77).trimEnd() + '...' : uploader
    const mediaFormat = res.type === 'image' ? 'Photo / Slideshow' : res.video ? 'Video' : 'Media'
    const caption = `╭━━━〔 🎬 *ALVARETH • TIKTOK* 〕━━━╮
┃
┃  ✦ *VIDEO BERHASIL DIUNDUH*
┃  ───────────────────
┃
┃  📝 *JUDUL VIDEO*
┃  ${displayTitle}
┃
┃  👤 *KREATOR*
┃  ${displayUploader}
┃
┃  📥 *STATUS*  •  Siap ditonton
┃  💠 *FORMAT*  •  ${mediaFormat}
┃
╰━━━━━━━━━━━━━━━━━━━━
     ✨ _Downloaded by Alvareth Bot_ ✨`;

    if (res.type === 'image' && res.images.length > 0) {
      await conn.sendMessage(
        m.chat,
        {
          album: res.images.map((img, i) => ({
            image: { url: img },
            caption: i === 0 ? caption : ''
          }))
        },
        { quoted: m }
      )

      if (res.audio) {
        await conn.sendMessage(
          m.chat,
          {
            audio: { url: res.audio },
            mimetype: 'audio/mpeg'
          },
          { quoted: m }
        )
      }

      await reactSafe(conn, m, '✅')
      return
    }

    if (res.video) {
      await conn.sendMessage(
        m.chat,
        {
          video: { url: res.video },
          caption
        },
        { quoted: m }
      )
    }

    if (res.audio) {
      await conn.sendMessage(
        m.chat,
        {
          audio: { url: res.audio },
          mimetype: 'audio/mpeg'
        },
        { quoted: m }
      )
    }

    await reactSafe(conn, m, '✅')
  } catch (e) {
    await reactSafe(conn, m, '❌')
    console.error('[TikTok Downloader]', e?.stack || e)
    await conn.sendMessage(m.chat, { text: `Gagal memproses TikTok: ${String(e?.message || e)}` }, { quoted: m }).catch(() => {})
  }
}

handler.help = ['tt', 'tiktok']
handler.tags = ['downloader']
handler.command = /^(tt|tiktok)$/i
handler.limit = true
handler.register = false

export default handler