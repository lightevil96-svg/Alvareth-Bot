import ytmp3Handler from './ytmp3.js'

// Reuse the established multi-provider downloader instead of the legacy FAA
// endpoint, which can return a small/non-audio payload while reporting success.
let handler = async (m, context = {}) => {
  const text = String(context.text || '').trim()

  if (!text) {
    const prefix = context.usedPrefix || '.'
    return m.reply('Contoh:\\n' + prefix + 'ytmp3v2 https://youtu.be/dQw4w9WgXcQ\\n' + prefix + 'ytmp3v2 judul lagu')
  }

  return ytmp3Handler(m, { ...context, text })
}

handler.help = ['ytmp3v2 <url atau judul>']
handler.tags = ['downloader']
handler.command = /^ytmp3v2$/i
handler.limit = true

export default handler
