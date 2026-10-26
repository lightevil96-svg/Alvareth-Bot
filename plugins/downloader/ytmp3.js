import fs from 'node:fs'
import { fileTypeFromBuffer } from 'file-type'
import yts from 'yt-search'
import {
  downloadYoutubeAudio,
  cleanupDownload,
  encodeAudioBufferToMp3
} from '../../lib/scrape/youtube.js'

const MAX_INLINE_AUDIO_BYTES = 50 * 1024 * 1024
const MAX_AUDIO_BYTES = 150 * 1024 * 1024
const RECENT_REQUEST_TTL_MS = 3 * 60 * 1000
const MAX_RECENT_REQUESTS = 200
const recentRequests = new Map()

function claimRequestOnce(m) {
  const messageId = String(m?.key?.id || '').trim()
  if (!messageId) return true

  const now = Date.now()
  for (const [key, expiresAt] of recentRequests) {
    if (expiresAt <= now) recentRequests.delete(key)
  }

  const key = String(m.chat || m.key?.remoteJid || '') + ':' + messageId
  if (recentRequests.has(key)) return false

  recentRequests.set(key, now + RECENT_REQUEST_TTL_MS)
  while (recentRequests.size > MAX_RECENT_REQUESTS) {
    const oldestKey = recentRequests.keys().next().value
    if (oldestKey === undefined) break
    recentRequests.delete(oldestKey)
  }
  return true
}

function conciseDownloadError(error) {
  const message = String(error?.message || error || 'Kesalahan tidak diketahui')
  if (/FFmpeg gagal|Invalid data found when processing input|audio-input\.bin|bukan file audio|bukan file media|operation was aborted|timeout|timed out/i.test(message)) {
    return 'Sumber unduhan mengembalikan data yang tidak valid atau waktu unduhan habis. Semua sumber cadangan sudah dicoba; silakan coba lagi beberapa saat.'
  }
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

async function getFallbackAudio(url, targetBitrate) {
  const apiBase = String(global.APIs?.nexray || 'https://api.nexray.eu.cc').replace(/\/+$/, '')
  const endpoints = [
    apiBase + '/downloader/savetube?url=' + encodeURIComponent(url) + '&quality=mp3',
    apiBase + '/downloader/v1/ytmp3?url=' + encodeURIComponent(url)
  ]
  const failures = []

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error('API audio HTTP ' + response.status)
      const json = await response.json()
      const data = json?.result
      const mediaUrl = data?.url || data?.dl
      if (!json?.status || !mediaUrl) throw new Error(json?.message || 'API tidak mengembalikan URL audio.')

      const mediaResponse = await fetch(mediaUrl, { signal: AbortSignal.timeout(90000) })
      if (!mediaResponse.ok) throw new Error('Unduhan audio HTTP ' + mediaResponse.status)

      const responseMime = String(mediaResponse.headers.get('content-type') || '')
        .split(';')[0].trim().toLowerCase()
      if (/^(text\/html|text\/plain|application\/json|application\/xml)/i.test(responseMime)) {
        throw new Error('Provider audio mengembalikan ' + responseMime + ', bukan file audio.')
      }

      const buffer = Buffer.from(await mediaResponse.arrayBuffer())
      if (!buffer.length) throw new Error('File audio kosong.')
      if (buffer.length > MAX_AUDIO_BYTES) throw new Error('File audio melebihi batas 150 MB.')

      const detected = await fileTypeFromBuffer(buffer)
      const actualMime = String(detected?.mime || '').toLowerCase()
      if (!detected || (!actualMime.startsWith('audio/') && !actualMime.startsWith('video/'))) {
        throw new Error('Provider audio mengembalikan data yang bukan file media' +
          (responseMime ? ' (Content-Type: ' + responseMime + ')' : '') + '.')
      }

      const encoded = await encodeAudioBufferToMp3(buffer, targetBitrate)
      return {
        ...encoded,
        title: data.title || 'audio',
        sourceBitrate: null
      }
    } catch (error) {
      failures.push(String(error?.message || error))
    }
  }

  throw new Error(failures.join(' | ') || 'Semua sumber audio gagal.')
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const rawInput = String(text || '').trim()
  if (!rawInput) {
    throw `Contoh:
${usedPrefix || '.'}${command} https://youtube.com/watch?v=337-Aroj1Ew|320
${usedPrefix || '.'}${command} judul lagu|128

Kualitas: |320 = terbaik yang tersedia, |128 = hemat.`
  }

  const [queryPart, bitratePart] = rawInput.split('|')
  const query = String(queryPart || '').trim()
  const targetBitrate = Number(String(bitratePart || '320').trim()) === 128 ? 128 : 320
  if (!query) throw new Error('Judul lagu atau URL YouTube tidak boleh kosong.')

  if (!claimRequestOnce(m)) {
    console.warn('[YTMP3] Mengabaikan pemrosesan duplikat untuk pesan:', m?.key?.id)
    return
  }

  let outputDir = null
  let audioSent = false

  try {
    await m.react('🕒').catch(error => {
      console.warn('[YTMP3] Gagal memasang reaksi proses:', error?.message || error)
    })

    let url = query
    if (!/^https?:\/\//i.test(query)) {
      const search = await yts(query)
      const video = search.videos?.[0]
      if (!video) throw new Error('Video tidak ditemukan.')
      url = video.url
    }

    let result
    try {
      result = await downloadYoutubeAudio(url, targetBitrate)
    } catch (localError) {
      console.warn('[YTMP3] Downloader utama gagal; mencoba fallback:', localError?.message || localError)
      result = await getFallbackAudio(url, targetBitrate)
    }
    outputDir = result.outputDir

    const buffer = result.buffer || fs.readFileSync(result.path)
    if (!buffer?.length) throw new Error('File MP3 kosong.')
    if (buffer.length > MAX_AUDIO_BYTES) throw new Error('File MP3 melebihi batas 150 MB.')

    const bitrate = Number(result.bitrate || targetBitrate)
    const caption = [
      '🎵 *' + String(result.title || 'Audio YouTube').replace(/[\r\n]+/g, ' ').slice(0, 180) + '*',
      '🎧 Format: MP3',
      '⚙️ Encoding: ' + bitrate + ' kbps',
      result.sourceBitrate ? '📡 Bitrate sumber: sekitar ' + Math.round(result.sourceBitrate) + ' kbps' : '',
    ].filter(Boolean).join('\n')

    const sent = buffer.length > MAX_INLINE_AUDIO_BYTES
      ? await conn.sendMessage(m.chat, {
          document: buffer,
          mimetype: 'audio/mpeg',
          fileName: `Alvareth-${bitrate}kbps.mp3`,
          caption
        }, { quoted: m, noAlvarethPreview: true })
      : await conn.sendMessage(m.chat, {
          audio: buffer,
          mimetype: 'audio/mpeg',
          fileName: `Alvareth-${bitrate}kbps.mp3`,
          ptt: false,
          caption
        }, { quoted: m, noAlvarethPreview: true })

    // Once sendMessage resolves, delivery was accepted. A failed reaction or
    // post-send bookkeeping must not claim the audio failed and send a second error.
    audioSent = true
    if (!sent?.key?.id) {
      console.warn('[YTMP3] Pesan terkirim tetapi WhatsApp tidak mengembalikan ID pesan.')
    }
    await m.react('✅').catch(error => {
      console.warn('[YTMP3] Audio sudah terkirim; reaksi sukses gagal:', error?.message || error)
    })
    console.log('[YTMP3] Terkirim ke', m.chat, '| bitrate MP3', bitrate)
  } catch (error) {
    console.error('[YTMP3]', error?.stack || error)

    if (audioSent) {
      console.warn('[YTMP3] Menekan pesan gagal karena audio sudah berhasil dikirim.')
      return
    }

    await m.react('❌').catch(() => {})
    await conn.sendMessage(m.chat, {
      text: '❌ Gagal mengunduh/mengirim audio: ' + conciseDownloadError(error)
    }, { quoted: m, noAlvarethPreview: true }).catch(sendError => {
      console.error('[YTMP3] Gagal mengirim pesan error:', sendError?.message || sendError)
    })
  } finally {
    if (outputDir) await cleanupDownload(outputDir).catch(() => {})
  }
}

handler.help = ['ytmp3 <URL/judul>|320 atau |128']
handler.tags = ['downloader']
handler.command = /^ytmp3$/i
handler.limit = true

export default handler
