import FormData from 'form-data'
import fetch from 'node-fetch'

let handler = async (m, { conn, text }) => {
  const args = text.split('|').map(v => v.trim())

  if (args.length < 4) {
    throw `Contoh:
.fakegroup Nama User|500|Mabar bot|06/03/26 15:31`
  }

  const [name, members, desc, date] = args

  const q = m.quoted ? m.quoted : m
  const mime = (q.msg || q).mimetype || ''

  if (!/image/.test(mime)) {
    throw 'Reply atau kirim gambar dengan caption *.fakegroup nama|members|deskripsi|tanggal*'
  }

  try {
    await m.react('🕒')

    const media = await q.download()
    if (!media) throw 'Gagal mengunduh gambar.'

    const form = new FormData()
    form.append('apikey', global.APIKeys[global.APIs.theresav])
    form.append('name', name)
    form.append('members', members)
    form.append('desc', desc)
    form.append('date', date)
    form.append('image', media, {
      filename: 'image.jpg',
      contentType: mime
    })

    const res = await fetch(`${global.APIs.theresav}/canvas/fakegroup`, {
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

handler.help = ['fakegroup']
handler.tags = ['maker']
handler.command = /^fakegroup$/i
handler.limit = true

export default handler