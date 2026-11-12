// • Image to prompt 
// • Type : Plugins ESM 
// • Scrape : https://whatsapp.com/channel/0029VbAwMQz5a240uWauNY13/180
// • Author : Hilman 
import axios from "axios"
import FormData from "form-data"
import fs from "fs"
import { aiErrorMessage } from "../../lib/ai-chat.js"

let handler = async (m, { conn, usedPrefix, command }) => {
  let q = m.quoted?.mimetype ? m.quoted : m
  if (!q.mimetype?.includes("image")) return conn.reply(m.chat, `🍭 Kirim atau reply gambar!\n\nContoh: reply gambar lalu ketik *${usedPrefix + command}*`, m)

  let img
  try {
    img = await q.download?.()
  } catch (e) {
    return conn.reply(m.chat, "❌ Gagal mengambil gambar. Coba kirim ulang gambarnya.", m)
  }
  if (!img) return conn.reply(m.chat, "❌ Gagal mengambil gambar. Coba kirim ulang gambarnya.", m)

  try {
    const form = new FormData()
    form.append("file", img, "img.jpg")

    const res = await axios.post("https://be.neuralframes.com/clip_interrogate/", form, {
      headers: {
        ...form.getHeaders(),
        "Authorization": "Bearer uvcKfXuj6Ygncs6tiSJ6VXLxoapJdjQ3EEsSIt45Zm+vsl8qcLAAOrnnGWYBccx4sbEaQtCr416jxvc/zJNAlcDjLYjfHfHzPpfJ00l05h0oy7twPKzZrO4xSB+YGrmCyb/zOduHh1l9ogFPg/3aeSsz+wZYL9nlXfXdvCqDIP9bLcQMHiUKB0UCGuew2oRt",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10)",
        "Referer": "https://www.neuralframes.com/tools/image-to-prompt"
      }
    })

    conn.reply(m.chat, res.data?.caption || res.data?.prompt || "🍬 Tidak ada prompt ditemukan", m)
  } catch (e) {
    conn.reply(m.chat, aiErrorMessage(e), m)
  }
}

handler.help = ["imgprompt"]
handler.tags = ["ai"]
handler.command = /^imgprompt$/i
handler.limit = true 
handler.register = true 

export default handler