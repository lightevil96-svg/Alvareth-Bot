import FormData from 'form-data'
import fetch from 'node-fetch'

let handler = async (m, { conn, text }) => {
  if (!text) throw 'Contoh:\n.fakedev Light V'

  const q = m.quoted ? m.quoted : m
  const mime = (q.msg || q).mimetype || ''

  if (!/image/.test(mime)) throw 'Reply atau kirim gambar dengan caption *.fakedev <nama>*'

  try {
    await m.react('🕒')

    const media = await q.download()
    if (!media) throw 'Gagal mengunduh gambar.'

    const form = new FormData()
    form.append('apikey', global.APIKeys[global.APIs.theresav])
    form.append('name', text.trim())
    form.append('verified', 'true')
    form.append('image', media, {
      filename: 'image.jpg',
      contentType: mime
    })

    const res = await fetch(`${global.APIs.theresav}/canvas/fakedev`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    })

    if (!res.ok) throw `HTTP ${res.status}`

    const buffer = Buffer.from(await res.arrayBuffer())

    await conn.sendMessage(m.chat, {
      image: buffer
    }, {
      quoted: m
    })

    await m.react('✅')
  } catch (e) {
    console.error(e)
    await m.react('❌')
    throw 'Gagal membuat gambar.'
  }
}

handler.help = ['fakedev <nama>']
handler.tags = ['maker']
handler.command = /^fakedev$/i
handler.limit = true

export default handler