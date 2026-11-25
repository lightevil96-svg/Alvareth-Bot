import { getQuotedStanzaId, resolveQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'
import { createStickerFromBuffer, stickerLimits } from './sticker-engine.js'
import {
  classifyStickerAudioSource,
  extractAudioFromVideoBuffer,
  makeVideoFromImageAndAudio,
  normalizeAudioBuffer,
  parseStickerAudioArgs,
  sendNativeSoundSticker,
  stickerAudioLimits
} from '../../lib/sticker-audio.js'

// Sticker Audio — `.sa` / `.stickeraudio`.
//
// Cara pakai (sesuai permintaan pemilik):
//   - Balas video bersuara dengan `.sa`
//   - Kirim video bersuara dengan caption `.sa`
//   - Balas audio/voice note dengan gambar + `.sa` (contoh pertama di
//     screenshot: gambar dibalas ke audio, lalu bot mengembalikan stiker)
//   - `.sa Ibuki - Arisu Soft` — teks setelah command jadi nama pack,
//     sama seperti `.s` (`packname|author`).
//
// Hasil v2 (native): satu pesan stiker suara — stiker animasi WebP yang
// membawa audionya di field `stickerMessage.audioMessage` (field 26),
// jadi penerima melihat ikon speaker di stiker dan mengetuknya untuk
// bunyi, seperti stiker suara dari aplikasi resmi. Butuh
// @itsliaaa/baileys >= 0.4.0 (repo kini memakai 0.5.6); pengiriman
// lewat sendNativeSoundSticker() di lib/sticker-audio.js. Kalau
// pengiriman native gagal (upload error, koneksi tanpa relay/upload),
// plugin jatuh kembali ke v1 — stiker + audio terpisah — dan
// mengatakannya di chat, bukan mengirim stiker diam-diam.
let handler = async (m, { conn, args = [], usedPrefix = '.', command = 'sa' }) => {
  let stage = 'membaca pesan'
  let mediaType = ''
  let mime = ''
  let inputBytes = 0

  const react = async emoji => {
    try {
      await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
    } catch (error) {
      console.warn('[STICKER-AUDIO] Gagal mengirim reaksi:', error?.message || error)
    }
  }

  const sendText = async text => conn.sendMessage(m.chat, { text })

  const usage = 'Balas video bersuara dengan *' + usedPrefix + command + '*, ' +
    'atau kirim video bersuara dengan caption *' + usedPrefix + command + '*. ' +
    'Bisa juga balas audio dengan gambar + *' + usedPrefix + command + '*. ' +
    'Maksimal ' + stickerAudioLimits.maxSoundSeconds + ' detik.'

  try {
    stage = 'membaca media yang direply'
    let q = null
    try { q = m.quoted } catch (error) {
      console.warn('[STICKER-AUDIO] Serializer reply gagal:', error?.message || error)
    }

    const stanzaId = getQuotedStanzaId(m)
    const hasReply = Boolean(stanzaId || q)
    const quotedInfo = await resolveQuotedMediaInfo(m, conn)

    const safeGet = (getter, fallback = '') => {
      try { return getter() ?? fallback } catch { return fallback }
    }
    const directType = String(safeGet(() => m.mediaType) || safeGet(() => m.mtype))
    const directNode = safeGet(() => m.msg, null) || m
    const directMime = String(
      safeGet(() => m.mimetype) ||
      safeGet(() => directNode?.mimetype) || ''
    ).toLowerCase()
    const quotedType = String(quotedInfo?.type || safeGet(() => q?.mediaType) || safeGet(() => q?.mtype) || '')
    const quotedMime = String(
      quotedInfo?.mime ||
      safeGet(() => q?.mimetype) || ''
    ).toLowerCase()
    const quotedNode = quotedInfo?.media || safeGet(() => q?.msg, null) || q

    const kind = classifyStickerAudioSource({
      directType,
      directMime,
      quotedType,
      quotedMime
    })
    mediaType = quotedType || directType
    mime = quotedMime || directMime

    console.log('[STICKER-AUDIO] Media terdeteksi', JSON.stringify({
      hasReply,
      stanzaId: stanzaId ? 'ada' : 'tidak ada',
      kind,
      directType: directType || null,
      quotedType: quotedType || null,
      directMime: directMime || null,
      quotedMime: quotedMime || null
    }))

    if (kind === 'unsupported' || kind === 'audio-only') {
      await react('❌')
      return sendText(kind === 'audio-only'
        ? '❌ Audio saja tidak bisa jadi stiker audio — butuh gambar/video sebagai visualnya. Balas audio dengan gambar + *' + usedPrefix + command + '*, atau balas video bersuara dengan *' + usedPrefix + command + '*.'
        : '❌ Tidak ada video/gambar + audio yang bisa dijadikan stiker audio.\n' + usage)
    }
    if (kind === 'image-only') {
      await react('❌')
      return sendText('❌ Gambar ini tidak punya audio. Balas audio dengan gambar ini + *' + usedPrefix + command + '*, atau pakai *' + usedPrefix + 's* untuk stiker biasa tanpa suara.')
    }

    const downloadDirect = async () => {
      if (typeof m.download === 'function') {
        try { return await m.download() } catch (error) {
          console.warn('[STICKER-AUDIO] Download media langsung gagal:', error?.message || error)
        }
      }
      return null
    }
    const downloadQuoted = async () => {
      const buffer = await downloadQuotedMedia(m, conn)
      if (buffer) return buffer
      if (typeof q?.download === 'function') {
        try { return await q.download() } catch (error) {
          console.warn('[STICKER-AUDIO] Fallback q.download gagal:', error?.message || error)
        }
      }
      return null
    }
    const asBuffer = buffer => (
      buffer && (Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) && buffer.length
        ? Buffer.from(buffer)
        : null
    )

    stage = 'mengunduh media'
    await react('🕒')

    let videoBuffer = null
    let imageBuffer = null
    let audioBuffer = null

    if (kind === 'video') {
      const quotedIsVideo = /video/i.test(quotedType) || /^video\//i.test(quotedMime)
      videoBuffer = asBuffer(quotedIsVideo ? await downloadQuoted() : await downloadDirect())
      if (!videoBuffer && hasReply) videoBuffer = asBuffer(await downloadQuoted())
      if (!videoBuffer) videoBuffer = asBuffer(await downloadDirect())
      if (videoBuffer) {
        const seconds = Number(
          (quotedIsVideo ? quotedNode?.seconds : directNode?.seconds) ??
          quotedNode?.seconds ??
          directNode?.seconds ??
          safeGet(() => q?.seconds) ?? 0
        )
        if (Number.isFinite(seconds) && seconds > stickerAudioLimits.maxVideoSeconds) {
          await react('❌')
          return sendText('❌ Video terlalu panjang. Maksimal ' + stickerAudioLimits.maxVideoSeconds + ' detik untuk stiker audio.')
        }
      }
    } else {
      // image+audio: gambar dan audio datang dari dua pesan berbeda.
      const quotedIsImage = /image/i.test(quotedType) || /^image\//i.test(quotedMime)
      const quotedIsAudio = /audio/i.test(quotedType) || /^audio\//i.test(quotedMime)
      if (quotedIsImage) {
        imageBuffer = asBuffer(await downloadQuoted())
        audioBuffer = asBuffer(await downloadDirect())
      } else if (quotedIsAudio) {
        audioBuffer = asBuffer(await downloadQuoted())
        imageBuffer = asBuffer(await downloadDirect())
      }
      if (!imageBuffer && hasReply) imageBuffer = asBuffer(await downloadQuoted())
      if (!audioBuffer && hasReply) audioBuffer = asBuffer(await downloadQuoted())
    }

    if (kind === 'video' && !videoBuffer) {
      throw new Error('Video tidak berhasil diunduh dari WhatsApp. Kirim ulang video lalu reply dengan command ' + usedPrefix + command + '.')
    }
    if (kind === 'image+audio' && (!imageBuffer || !audioBuffer)) {
      throw new Error(
        !imageBuffer && !audioBuffer
          ? 'Gambar dan audio tidak berhasil diunduh dari WhatsApp.'
          : !imageBuffer
            ? 'Gambar tidak berhasil diunduh dari WhatsApp.'
            : 'Audio tidak berhasil diunduh dari WhatsApp.'
      )
    }

    const sourceBuffer = videoBuffer || imageBuffer
    inputBytes = sourceBuffer.length
    if (inputBytes > stickerLimits.maxInputBytes) {
      throw new Error('Ukuran media melebihi batas ' + Math.round(stickerLimits.maxInputBytes / 1024 / 1024) + ' MB.')
    }

    stage = 'menyiapkan audio'
    let audioOgg = null
    let audioWarning = ''
    let stickerSource = videoBuffer
    if (kind === 'video') {
      try {
        audioOgg = await extractAudioFromVideoBuffer(videoBuffer, { maxSeconds: stickerAudioLimits.maxSoundSeconds })
      } catch (error) {
        if (/tidak memiliki trek audio/i.test(error?.message || '')) {
          audioWarning = '⚠️ Video ini tidak ada audionya, jadi dikirim sebagai stiker biasa. Coba video lain yang bersuara.'
        } else {
          throw error
        }
      }
    } else {
      try {
        audioOgg = await normalizeAudioBuffer(audioBuffer, { maxSeconds: stickerAudioLimits.maxSoundSeconds })
        stickerSource = await makeVideoFromImageAndAudio(imageBuffer, audioBuffer, { maxSeconds: stickerAudioLimits.maxSoundSeconds })
      } catch (error) {
        throw error
      }
    }

    stage = 'mengonversi ke stiker'
    const { packname: packnameRaw, author: authorRaw } = parseStickerAudioArgs(args.join(' '))
    const packname = (packnameRaw || global.stickpack || 'Alvareth Bot').trim()
    const author = (authorRaw || global.stickauth || '').trim()
    const stickerBuffer = await createStickerFromBuffer(Buffer.from(stickerSource), {
      mimeHint: kind === 'video' ? (mime || 'video/mp4') : 'video/mp4',
      mediaType: 'videoMessage',
      maxVideoSeconds: stickerAudioLimits.maxVideoSeconds,
      maxStickerBytes: stickerAudioLimits.maxStickerBytes,
      packname,
      author
    })

    stage = 'mengirim stiker audio ke WhatsApp'
    let sentNative = false
    if (audioOgg) {
      try {
        await sendNativeSoundSticker(conn, m.chat, { stickerBuffer, audioOgg })
        sentNative = true
      } catch (error) {
        console.warn('[STICKER-AUDIO] Stiker suara native gagal, fallback ke stiker + audio terpisah:', error?.message || error)
      }
    }
    if (!sentNative) {
      await conn.sendMessage(m.chat, {
        sticker: stickerBuffer,
        mimetype: 'image/webp'
      })

      if (audioOgg) {
        await conn.sendMessage(m.chat, {
          audio: audioOgg,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: false
        })
        await sendText(
          '🔊 Stiker suara native gagal dikirim kali ini, jadi dikirim sebagai stiker + audio ' +
          stickerAudioLimits.maxSoundSeconds + ' detik terpisah di bawahnya.'
        )
      } else if (audioWarning) {
        await sendText(audioWarning)
      }
    }

    await react('✨')
    console.log('[STICKER-AUDIO] Berhasil', JSON.stringify({
      kind,
      mediaType,
      mime: mime || null,
      native: sentNative,
      inputBytes,
      audioBytes: audioOgg ? audioOgg.length : 0,
      outputBytes: stickerBuffer.length
    }))
  } catch (error) {
    const detail = String(error?.message || error || 'Kesalahan tidak diketahui')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL disamarkan]')
      .replace(/\s+/g, ' ')
      .slice(0, 500)

    console.error('[STICKER-AUDIO] GAGAL', JSON.stringify({
      stage,
      mediaType: mediaType || null,
      mime: mime || null,
      inputBytes,
      error: detail
    }), error?.stack || '')

    await react('❌')
    try {
      await sendText('❌ Stiker audio gagal dibuat pada tahap: ' + stage + '.\nDetail: ' + detail + '\n' + usage)
    } catch (sendError) {
      console.error('[STICKER-AUDIO] Gagal mengirim pesan diagnostik:', sendError?.stack || sendError)
    }
  }
}

handler.help = ['sa [packname|author]', 'stickeraudio [packname|author]']
handler.tags = ['sticker']
handler.command = /^(sa|stickeraudio)$/i
handler.register = false

export default handler
