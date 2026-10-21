import { upload } from '../../lib/scrape/uploadnekohime.js'

let handler = async (m, { conn }) => {
  const q = m.quoted || m
  const mime = (q.msg || q).mimetype || ''

  if (!/audio/.test(mime)) {
    throw 'Reply audio atau voice note yang ingin dikenali.'
  }

  await m.react('🕒')

  try {
    const media = await q.download()
    if (!media) throw new Error('Gagal mengunduh audio.')

    const extMap = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/mp4': 'm4a'
    }

    const ext = extMap[mime] || mime.split('/')[1]?.split(';')[0] || 'bin'
    const filename = q.fileName || `file.${ext}`

    const { url } = await upload(media, filename)

    const res = await fetch(
      `${global.APIs.nexray}/tools/whatsmusic?url=${encodeURIComponent(url)}`
    )

    const json = await res.json()

    if (!json.status) {
      const msg = json.error || json.message || ''

      if (/Song data not found/i.test(msg)) {
        throw new Error(
          'Lagu tidak berhasil dikenali.\n\nPastikan audio berisi lagu yang jelas dan berdurasi beberapa detik.'
        )
      }

      throw new Error(msg || 'Terjadi kesalahan.')
    }

    const data = json.result

    const spotify = data.url?.find(v => /spotify\.com/i.test(v)) || '-'
    const youtube = data.url?.find(v => /youtu(\.be|be\.com)/i.test(v)) || '-'
    const deezer = data.url?.find(v => /deezer\.com/i.test(v)) || '-'

    await conn.reply(
      m.chat,
      `❏ Title       : ${data.title}
❏ Artist      : ${data.artist}
❏ Score       : ${data.score}%
❏ Release     : ${data.release}
❏ Duration    : ${data.duration}

❏ Spotify     : ${spotify}
❏ YouTube     : ${youtube}
❏ Deezer      : ${deezer}`,
      m
    )

    await m.react('✅')
  } catch (e) {
    console.error(e)
    await m.react('❌')
    throw e.message || String(e)
  }
}

handler.help = ['whatmusic']
handler.tags = ['tools']
handler.command = /^whatmusic$/i
handler.limit = true

export default handler