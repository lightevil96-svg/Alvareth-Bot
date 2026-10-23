import ytmp4Handler from './ytmp4.js'

// Reuse the established multi-provider MP4 downloader and default V2 to 720p.
// An explicitly supplied resolution (URL|360, URL|480, etc.) is preserved.
let handler = async (m, context = {}) => {
  const text = String(context.text || '').trim()

  if (!text) {
    const prefix = context.usedPrefix || '.'
    return m.reply('Contoh:\n' + prefix + 'ytmp4v2 https://youtu.be/dQw4w9WgXcQ\n' + prefix + 'ytmp4v2 https://youtu.be/dQw4w9WgXcQ|720')
  }

  const hasResolution = /\|\s*\d+\s*$/.test(text)
  const downloadText = hasResolution ? text : text + '|720'

  return ytmp4Handler(m, { ...context, text: downloadText })
}

handler.help = ['ytmp4v2 <url atau judul>']
handler.tags = ['downloader']
handler.command = /^ytmp4v2$/i
handler.limit = true

export default handler
