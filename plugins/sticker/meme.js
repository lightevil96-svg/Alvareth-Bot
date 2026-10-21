import { sticker } from '../../lib/sticker.js'
import axios from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'

async function uguu(filePath) {
  try {
    const form = new FormData()
    form.append('files[]', fs.createReadStream(filePath))
    const { data } = await axios.post('https://uguu.se/upload', form, { headers: { ...form.getHeaders() } })
    return data.files[0].url
  } catch (err) {
    throw new Error(err.message)
  }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  let [atas, bawah] = text.split('|')
  let q = m.quoted ? m.quoted : m
  let mime = (q.msg || q).mimetype || ''
  if (!mime) throw `Balas media dengan perintah\n\n${usedPrefix + command} <teks atas>|<teks bawah>`

  m.react('🕒')
  let mediaBuffer = await q.download()

  let ext = mime.split('/')[1] || 'png'
  let tempFile = path.join(process.cwd(), `temp_${Date.now()}.${ext}`)
  fs.writeFileSync(tempFile, mediaBuffer)

  try {
    let url = await uguu(tempFile)
    let stiker

    if (mime.startsWith('image/')) {
      let memeUrl = `https://api.memegen.link/images/custom/${encodeURIComponent(atas || ' ')}/${encodeURIComponent(bawah || ' ')}.png?background=${url}`
      stiker = await sticker(false, memeUrl, 'Alvareth Bot', 'ʙy ʟɪɢʜᴛ ᴠ')
    } else {
      stiker = await sticker(false, url, 'Alvareth Bot', 'ʙy ʟɪɢʜᴛ ᴠ')
    }

    await conn.sendFile(m.chat, stiker, '', '', m, '')
  } finally {
    fs.unlinkSync(tempFile)
  }
}

handler.help = ['smeme']
handler.tags = ['sticker']
handler.command = /^(smeme)$/i
handler.limit = true

export default handler