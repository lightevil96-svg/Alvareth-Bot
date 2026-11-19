import {
  getQuotedMediaInfo,
  resolveQuotedMediaInfo,
  downloadQuotedMedia,
  isQuotedViewOnce
} from '../../lib/simple.js'

const DEFAULT_MEDIA = {
  imageMessage: { mimetype: 'image/jpeg', extension: 'jpg' },
  videoMessage: { mimetype: 'video/mp4', extension: 'mp4' },
  audioMessage: { mimetype: 'audio/ogg', extension: 'ogg' },
  documentMessage: { mimetype: 'application/octet-stream', extension: 'bin' },
  stickerMessage: { mimetype: 'image/webp', extension: 'webp' },
  ptvMessage: { mimetype: 'video/mp4', extension: 'mp4' },
  lottieStickerMessage: { mimetype: 'application/x-tgsticker', extension: 'tgs' }
}

function safeFilename(value, extension) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)

  if (!cleaned) return `media.${extension}`
  return /\.[a-z0-9]{1,12}$/i.test(cleaned) ? cleaned : `${cleaned}.${extension}`
}

let handler = async (m, { conn }) => {
  // .rvo (read view once) memang dibuat untuk membaca media Lihat Sekali:
  // resolver bersama di lib/simple.js sudah membuka wrapper viewOnceMessage /
  // viewOnceMessageV2 / ephemeral dan mengunduh media dari mediaKey-nya.
  // isQuotedViewOnce hanya dipakai untuk pesan error yang lebih jelas bila
  // media Lihat Sekali itu sudah tidak bisa diunduh lagi, bukan untuk menolak.
  const wasViewOnce = isQuotedViewOnce(m)

  // Read the raw quoted payload first, then prefer a complete cached original
  // when the WhatsApp reply preview contains only a thumbnail or partial fields.
  const quotedInfo = getQuotedMediaInfo(m)
  const info = await resolveQuotedMediaInfo(m, conn) || quotedInfo
  if (!info) {
    throw '❌ Balas pesan foto, video, audio, stiker, atau dokumen yang ingin diproses dengan perintah .rvo!'
  }

  const defaults = DEFAULT_MEDIA[info.type] || { mimetype: 'application/octet-stream', extension: 'bin' }
  const mimetype = info.mime || defaults.mimetype
  if (!/^(image|video|audio|application)\//i.test(mimetype)) {
    throw '❌ Pesan yang dibalas bukan jenis media yang didukung!'
  }

  let media
  try {
    media = await downloadQuotedMedia(m, conn)
  } catch (error) {
    console.error('[RVO] Download media gagal:', error?.stack || error)
    if (wasViewOnce) {
      throw '❌ Gagal mengunduh media Lihat Sekali. Media itu mungkin sudah dibuka sehingga WhatsApp tidak lagi menyediakannya — minta pengirim mengirim ulang sebagai media biasa.'
    }
    throw '❌ Gagal mengunduh media. Coba balas media biasa yang masih tersedia.'
  }

  if (!media || !(Buffer.isBuffer(media) || media instanceof Uint8Array) || media.length === 0) {
    if (wasViewOnce) {
      throw '❌ Media Lihat Sekali tidak dapat diunduh (mungkin sudah dibuka/kedaluwarsa). Minta pengirim mengirim ulang sebagai media biasa.'
    }
    throw '❌ Data media tidak valid atau tidak dapat diunduh. Coba kirim ulang media tersebut.'
  }

  if (typeof conn.sendFile !== 'function') {
    throw '❌ Fitur pengiriman media tidak tersedia pada koneksi bot.'
  }

  const extension = info.mime
    ? info.mime.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9.+-]/gi, '') || defaults.extension || 'bin'
    : defaults.extension || 'bin'
  const filename = safeFilename(info.media?.fileName, extension)
  await conn.sendFile(m.chat, Buffer.from(media), filename, info.caption || '', m)
}

handler.help = ['rvo']
handler.tags = ['tools']
handler.command = /^rvo$/i
handler.limit = true

export default handler
