import { synthesizeEdgeTTS } from '../../lib/tts-edge.js'
import { parseTtsRequest, getTtsVoiceList, MAX_TTS_CHARACTERS } from '../../lib/tts-config.js'

let activeJobs = 0
const MAX_CONCURRENT_JOBS = 2

const handler = async (m, { conn, text, usedPrefix = '.', command }) => {
  const request = parseTtsRequest(text)

  if (request.action === 'help') {
    return m.reply([
      '🎙️ *ALVARETH NEURAL TTS*',
      '',
      'Ubah teks menjadi suara neural yang natural.',
      '',
      'Contoh:',
      `• ${usedPrefix + command} Halo, selamat datang.`,
      `• ${usedPrefix + command} wanita|Halo semuanya.`,
      `• ${usedPrefix + command} pria|Halo semuanya.`,
      `• ${usedPrefix + command} en|Welcome to Alvareth.`,
      `• ${usedPrefix + command} suara`,
      '',
      `Maksimal ${MAX_TTS_CHARACTERS.toLocaleString('id-ID')} karakter per proses.`
    ].join('\n'))
  }

  if (request.action === 'list') return m.reply(getTtsVoiceList())
  if (!request.text) return m.reply('Teks yang akan diubah menjadi suara belum diisi.')

  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return m.reply('⏳ Antrean TTS sedang penuh. Coba lagi beberapa saat.')
  }

  activeJobs++
  const startedAt = Date.now()

  try {
    try { await m.react?.('⏳') } catch {}
    const { audio, profile } = await synthesizeEdgeTTS(request.text, request.profile)

    await conn.sendMessage(m.chat, {
      audio,
      mimetype: 'audio/mpeg',
      fileName: 'Alvareth-Neural-TTS.mp3',
      ptt: false
    }, { quoted: m })

    console.log(`[TTS] Selesai: voice=${profile.voice}, chars=${Array.from(request.text).length}, durationMs=${Date.now() - startedAt}`)
    try { await m.react?.('✅') } catch {}
  } catch (error) {
    console.error('[TTS/EDGE]', error?.stack || error)
    try { await m.react?.('❌') } catch {}
    return m.reply('❌ Gagal membuat suara neural. ' + (error?.message || 'Layanan TTS sedang tidak tersedia. Coba lagi nanti.'))
  } finally {
    activeJobs = Math.max(0, activeJobs - 1)
  }
}

handler.help = ['tts <teks>', 'tts pria|<teks>', 'tts wanita|<teks>', 'tts en|<text>', 'tts suara']
handler.tags = ['voice']
handler.command = /^tts$/i
handler.limit = true
handler.premium = false

export default handler
