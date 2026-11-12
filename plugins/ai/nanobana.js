import fs from 'fs'
import axios from 'axios'
import FormData from 'form-data'
import { buildPollinationsImageUrl, aiErrorMessage } from '../../lib/ai-chat.js'

async function uguu(filePath) {
  const form = new FormData()
  form.append('files[]', fs.createReadStream(filePath))
  const { data } = await axios.post('https://uguu.se/upload', form, {
    headers: { ...form.getHeaders() }
  })
  return data.files[0].url
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  await m.react('✨')

  let q = m.quoted ? m.quoted : m

  if (q.mtype !== 'imageMessage') {
    return conn.reply(
      m.chat,
      `*Example :* reply gambar + ${usedPrefix + command} Ubah jadi tersenyum`,
      m
    )
  }

  if (!text) {
    return conn.reply(
      m.chat,
      `*Example :* reply gambar + ${usedPrefix + command} Ubah jadi tersenyum`,
      m
    )
  }

  let media
  try {
    media = await q.download()
  } catch (e) {
    await m.react('❌')
    return conn.reply(m.chat, aiErrorMessage(e), m)
  }
  if (!media) {
    await m.react('❌')
    return conn.reply(m.chat, '❌ Gagal mengunduh gambar. Coba kirim ulang gambarnya.', m)
  }

  let tmp = './tmp_' + Date.now() + '.jpg'
  fs.writeFileSync(tmp, media)

  try {
    let urlGambar = await uguu(tmp)
    if (!urlGambar) throw new Error('Upload gambar ke uguu.se gagal.')

    let imageUrl = buildPollinationsImageUrl(text, { image: urlGambar })
    await conn.sendMessage(m.chat, {
      image: { url: imageUrl },
      caption: `✨ *Edit gambar selesai*\n\n📝 *Prompt:* ${text}`
    }, { quoted: m })
    await m.react('✅')
  } catch (e) {
    await m.react('❌')
    await conn.reply(m.chat, aiErrorMessage(e), m)
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {}
  }
}

handler.help = ['editimage', 'nanobanana']
handler.tags = ['ai']
handler.command = /^(editimage|nanobanana)$/i
handler.limit = true

export default handler
