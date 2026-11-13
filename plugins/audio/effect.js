import { AUDIO_EFFECTS, normalizeAudioEffect, readAudioInput, convertAudio } from '../../lib/audio-tools.js'

let handler = async (m, { conn, usedPrefix = '.', command }) => {
  const effect = normalizeAudioEffect(command)
  const filter = AUDIO_EFFECTS[effect]
  if (!filter) return m.reply('Efek audio tidak dikenal.')

  try {
    const input = await readAudioInput(m, conn)
    if (!input) return m.reply(`Reply pesan audio atau voice note, lalu ketik *${usedPrefix}${command}*.`)
    try { await m.react?.('⏳') } catch {}
    const audio = await convertAudio(input.buffer, { filter })
    await conn.sendMessage(m.chat, { audio, mimetype: 'audio/mpeg', ptt: true }, { quoted: m })
    try { await m.react?.('✅') } catch {}
  } catch (error) {
    console.error(`[AUDIO/${effect}]`, error)
    try { await m.react?.('❌') } catch {}
    return m.reply(`Efek *${effect}* gagal diproses. ${error.message || 'Silakan coba lagi.'}`)
  }
}

handler.help = [...Object.keys(AUDIO_EFFECTS), 'squirrel', 'chipmunk']
handler.tags = ['audio']
handler.command = /^(bass|blown|deep|earrape|fast|fat|nightcore|reverse|robot|slow|smooth|tupai|squirrel|chipmunk|reverb|chorus|flanger|distortion|pitch|highpass|lowpass|underwater)$/i

export default handler
