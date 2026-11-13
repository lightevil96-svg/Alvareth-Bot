import WebSocket from 'ws'
import { readAudioInput } from '../../lib/audio-tools.js'

const SPACE = 'https://yanzbotz-waifu-yanzbotz.hf.space'
const WS_URL = 'wss://yanzbotz-waifu-yanzbotz.hf.space/queue/join'
const TIMEOUT_MS = 90_000
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024

export function createZetaPayload(audio, sessionHash) {
  return {
    fn_index: 0,
    data: [
      { data: 'data:audio/mpeg;base64,' + audio.toString('base64'), name: `audio-${Date.now()}.mp3` },
      10, 'pm', 0.6, false, '', 'en-US-AnaNeural-Female'
    ],
    event_data: null,
    session_hash: sessionHash
  }
}

export async function requestZetaVoice(audio, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!Buffer.isBuffer(audio) || !audio.length) throw new Error('Audio kosong atau tidak valid.')
  if (audio.length > MAX_OUTPUT_BYTES) throw new Error('Ukuran audio maksimal 25 MB.')

  const sessionHash = Math.random().toString(36).slice(2, 14)
  return new Promise((resolve, reject) => {
    let socket
    let settled = false
    let timer
    let outputPath = ''
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket?.close() } catch {}
      if (error) reject(error)
      else resolve(result)
    }
    try { socket = new WebSocket(WS_URL) }
    catch (error) { reject(new Error('Tidak dapat menghubungi layanan Zeta Voice: ' + error.message)); return }

    timer = setTimeout(() => finish(new Error('Layanan Zeta Voice terlalu lama merespons. Coba lagi nanti.')), timeoutMs)
    timer.unref?.()

    socket.on('open', () => {
      socket.send(JSON.stringify({ fn_index: 0, session_hash: sessionHash }))
    })
    socket.on('message', async raw => {
      let message
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.msg === 'send_hash') {
        socket.send(JSON.stringify({ fn_index: 0, session_hash: sessionHash }))
      } else if (message.msg === 'send_data') {
        socket.send(JSON.stringify(createZetaPayload(audio, sessionHash)))
      } else if (message.msg === 'process_completed') {
        const data = message.output?.data
        const candidate = Array.isArray(data) ? data.find(item => item && typeof item.name === 'string') : null
        if (!candidate) return finish(new Error('Layanan Zeta Voice tidak mengembalikan file audio.'))
        const name = candidate.name
        if (/^https:\/\//i.test(name)) {
          let url
          try { url = new URL(name) } catch { return finish(new Error('URL hasil Zeta Voice tidak valid.')) }
          if (url.origin !== SPACE) return finish(new Error('Layanan Zeta Voice mengembalikan host file yang tidak dikenal.'))
          outputPath = url.href
        } else if (name.startsWith('/file=')) {
          outputPath = SPACE + name
        } else if (name.startsWith('file=')) {
          outputPath = SPACE + '/' + name
        } else {
          return finish(new Error('Lokasi file hasil Zeta Voice tidak valid.'))
        }
        try {
          const response = await fetch(outputPath, { signal: AbortSignal.timeout(20_000) })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const contentLength = Number(response.headers.get('content-length') || 0)
          if (contentLength > MAX_OUTPUT_BYTES) throw new Error('File hasil melebihi 25 MB.')
          const result = Buffer.from(await response.arrayBuffer())
          if (!result.length || result.length > MAX_OUTPUT_BYTES) throw new Error('File hasil kosong atau terlalu besar.')
          finish(null, result)
        } catch (error) {
          finish(new Error('Gagal mengunduh hasil Zeta Voice: ' + error.message))
        }
      } else if (message.msg === 'queue_full') {
        finish(new Error('Antrean Zeta Voice sedang penuh. Coba lagi beberapa saat.'))
      } else if (message.msg === 'process_error') {
        finish(new Error('Layanan Zeta Voice gagal memproses audio.'))
      }
    })
    socket.on('error', error => finish(new Error('Koneksi Zeta Voice gagal: ' + error.message)))
    socket.on('close', (code, reason) => {
      if (!settled) finish(new Error('Koneksi Zeta Voice terputus sebelum hasil diterima (' + code + ').'))
    })
  })
}

let handler = async (m, { conn, usedPrefix = '.', command }) => {
  try {
    const input = await readAudioInput(m, conn, { allowVideo: true })
    if (!input) return m.reply(`Reply audio, voice note, atau video yang memiliki audio, lalu ketik *${usedPrefix}${command}*.`)
    try { await m.react?.('⏳') } catch {}
    const result = await requestZetaVoice(input.buffer)
    await conn.sendMessage(m.chat, { audio: result, mimetype: 'audio/mpeg', ptt: false }, { quoted: m })
    try { await m.react?.('✅') } catch {}
  } catch (error) {
    console.error('[AUDIO/zetavoice]', error)
    try { await m.react?.('❌') } catch {}
    return m.reply('Zeta Voice gagal diproses. ' + (error.message || 'Silakan coba lagi.'))
  }
}

handler.help = ['zetavoice']
handler.command = ['zetavoice']
handler.tags = ['audio']
handler.premium = false

export default handler
