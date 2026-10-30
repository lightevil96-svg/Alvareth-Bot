/**
 * AI Image Converter — transformasi gambar berbasis API FAA.
 * Perbaikan: deteksi media reply dari payload Baileys dan teruskan error ke handler global.
 */
import axios from "axios"
import FormData from "form-data"
import fetch from "node-fetch"
import { fileTypeFromBuffer } from "file-type"

const API_TIMEOUT = 90000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function findImageMessage(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 10 || seen.has(value)) return null
  seen.add(value)
  if (value.imageMessage) return value.imageMessage
  for (const key of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage", "editedMessage", "message"]) {
    const child = value[key]
    if (!child) continue
    const found = findImageMessage(child.message || child, depth + 1, seen)
    if (found) return found
  }
  for (const [key, child] of Object.entries(value)) {
    if (["contextInfo", "messageContextInfo", "senderKeyDistributionMessage"].includes(key)) continue
    if (child && typeof child === "object") {
      const found = findImageMessage(child, depth + 1, seen)
      if (found) return found
    }
  }
  return null
}

async function uploadImage(buffer) {
  const form = new FormData()
  form.append("files[]", buffer, { filename: "image.jpg", contentType: "image/jpeg" })
  const { data } = await axios.post("https://uguu.se/upload", form, {
    headers: form.getHeaders(),
    timeout: API_TIMEOUT,
    maxBodyLength: MAX_IMAGE_BYTES + 1024 * 1024
  })
  const url = data?.files?.[0]?.url
  if (!url || !/^https?:\\/\\//i.test(url)) {
    throw new Error("Layanan upload tidak memberikan URL gambar yang valid.")
  }
  return url
}

let handler = async (m, { conn, command }) => {
  await m.react("✨").catch(() => {})
  const q = m.quoted || m
  const nestedImage = findImageMessage(
    q?.mediaMessage || q?.message || q?.msg || q?.rawMessage || m?.rawMessage?.message
  )
  const mime = String(
    q?.mimetype || q?.msg?.mimetype || q?.mediaMessage?.mimetype ||
    nestedImage?.mimetype || ""
  ).toLowerCase()

  if (!mime.startsWith("image/") && !nestedImage) {
    const list = handler.help.map(v => `.${v}`).join("\\n")
    return m.reply(`✨ *AI IMAGE CONVERTER*\\n\\nReply gambar dengan caption salah satu command berikut:\\n\\n${list}`)
  }

  if (typeof q.download !== "function") {
    throw new Error("Fungsi download media pada pesan yang direply tidak tersedia.")
  }
  const buffer = await q.download()
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Gagal mengambil data gambar dari pesan yang direply.")
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Ukuran gambar melebihi batas 20 MB.")
  }
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected?.mime?.startsWith("image/")) {
    throw new Error("Media yang direply bukan file gambar yang valid.")
  }

  await m.reply(`⏳ Sedang memproses gambar dengan style *${command}*... `)
  const imageUrl = await uploadImage(buffer)
  const apiUrl = `https://api-faa.my.id/faa/${encodeURIComponent(command)}?url=${encodeURIComponent(imageUrl)}`
  const response = await fetch(apiUrl, {
    headers: { accept: "image/*, application/json" },
    timeout: API_TIMEOUT
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`API ${command} mengembalikan HTTP ${response.status}: ${body.slice(0, 500)}`)
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase()
  let result
  if (contentType.includes("application/json")) {
    const json = await response.json()
    if (json?.status === false || json?.success === false) {
      throw new Error(json?.message || json?.error || "API gagal memproses gambar.")
    }
    const resultUrl = json?.result?.url || json?.result || json?.url || json?.data?.url
    if (typeof resultUrl !== "string" || !/^https?:\\/\\//i.test(resultUrl)) {
      throw new Error("Respons API tidak berisi URL gambar hasil yang valid.")
    }
    const imageResponse = await fetch(resultUrl, { timeout: API_TIMEOUT })
    if (!imageResponse.ok) throw new Error(`Gagal mengunduh hasil gambar (HTTP ${imageResponse.status}).`)
    result = Buffer.from(await imageResponse.arrayBuffer())
  } else {
    result = Buffer.from(await response.arrayBuffer())
  }

  if (!result.length) throw new Error("API mengembalikan hasil gambar kosong.")
  if (result.length > MAX_IMAGE_BYTES) throw new Error("Hasil gambar melebihi batas 20 MB.")
  const outputType = await fileTypeFromBuffer(result)
  if (!outputType?.mime?.startsWith("image/")) {
    throw new Error(`Respons API bukan gambar valid (content-type: ${contentType || "tidak diketahui"}).`)
  }

  await conn.sendMessage(m.chat, {
    image: result,
    mimetype: outputType.mime,
    fileName: `${command}.${outputType.ext}`,
    caption: `✨ Berhasil mengubah gambar dengan style ${command}.`
  }, { quoted: m })
  await m.react("✅").catch(() => {})
}

handler.help = [
  'tobotak','tochibi','tofunk',
  'tofigura','tofigurav2','tofigurav3','toghibli','tohijab',
  'tojapanese','tojepang','tokacamata','tokamboja','tolego',
  'toliquor','tomaid','tomirror','tomoai','tomonyet',
  'topacar','topeci','topiramida','toputih','toreal',
  'toroblox','toroh','totato','totua','toviking',
  'tozombie','tounderground','tohitam'
]
handler.tags = ['image']
handler.command = /^(tobotak|tochibi|tofunk|tofigura|tofigurav2|tofigurav3|toghibli|tohijab|tojapanese|tojepang|tokacamata|tokamboja|tolego|toliquor|tomaid|tomirror|tomoai|tomonyet|topacar|topeci|topiramida|toputih|toreal|toroblox|toroh|totato|totua|toviking|tozombie|tounderground|tohitam)$/i
handler.limit = true
export default handler
