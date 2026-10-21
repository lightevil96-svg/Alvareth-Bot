import yts from 'yt-search'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { downloadYoutubeVideo, cleanupDownload } from '../../lib/scrape/youtube.js'

const execAsync = promisify(exec)

let handler = async (m, { conn, text }) => {
  if (!text) throw `Contoh:
.playvid https://youtu.be/dQw4w9WgXcQ
.playvid dj remix
.playvid dj remix|720`

  await m.react('🕒')

  let result

  try {
    let [query, resolusi = '360'] = text.split('|')

    let url = query

    if (!/^https?:\/\//.test(query)) {
      const search = await yts(query)
      const video = search.videos[0]
      if (!video) throw 'Video tidak ditemukan.'
      url = video.url
    }

    try {
      const res = await fetch(`${global.APIs.nexray}/downloader/ytmp4?url=${encodeURIComponent(url)}&resolusi=${resolusi}`)
      const json = await res.json()

      if (!json.status) throw new Error(json.message || 'Gagal mengambil video')

      const data = json.result

      const input = path.join(os.tmpdir(), `${Date.now()}-input.mp4`)
      const output = path.join(os.tmpdir(), `${Date.now()}-output.mp4`)

      const video = await fetch(data.url)
      fs.writeFileSync(input, Buffer.from(await video.arrayBuffer()))

      await execAsync(`ffmpeg -y -i "${input}" -c copy -movflags +faststart "${output}"`)

      const size = fs.statSync(output).size
      const caption = `❏ Author      : ${data.author || '-'}
❏ Duration    : ${data.duration || '-'} Detik
❏ Title       : ${data.title || '-'}`

      if (size > 50 * 1024 * 1024) {
        await conn.sendMessage(m.chat, {
          document: fs.readFileSync(output),
          fileName: `${data.title || 'video'}.mp4`,
          mimetype: 'video/mp4',
          caption
        }, { quoted: m })
      } else {
        await conn.sendMessage(m.chat, {
          video: fs.readFileSync(output),
          caption
        }, { quoted: m })
      }

      fs.unlinkSync(input)
      fs.unlinkSync(output)

      await m.react('✅')
      return
    } catch (e) {
      console.log('[YTMP4] Nexray gagal:', e.message)
    }

    result = await downloadYoutubeVideo(url, Number(resolusi) || 360)

    const buffer = fs.readFileSync(result.path)
    const size = fs.statSync(result.path).size

    if (size > 50 * 1024 * 1024) {
      await conn.sendMessage(m.chat, {
        document: buffer,
        mimetype: 'video/mp4',
        fileName: `${result.title}.mp4`
      }, { quoted: m })
    } else {
      await conn.sendMessage(m.chat, {
        video: buffer,
        caption: `📹 ${result.title}\nKualitas: ${result.quality}p`
      }, { quoted: m })
    }

    await cleanupDownload(result.outputDir)
    await m.react('✅')
  } catch (e) {
    if (result?.outputDir) {
      await cleanupDownload(result.outputDir).catch(() => {})
    }

    console.error(e)
    await m.react('❌')
    throw e.message || 'Terjadi kesalahan.'
  }
}

handler.help = ['playvid', 'ytmp4']
handler.tags = ['downloader']
handler.command = /^(playvid|ytmp4)$/i
handler.limit = true

export default handler