import fs from 'fs'
import syntaxError from 'syntax-error'
import path from 'path'

const _fs = fs.promises

let handler = async (m, { conn, text, usedPrefix, command, __dirname }) => {
  if (!text) throw `
Penggunaan: ${usedPrefix}${command} <name file>
Contoh: ${usedPrefix}savefile main.js
        ${usedPrefix}saveplugin owner
`.trim()

  if (!m.quoted) throw 'Reply Kodenya'

  if (/p(lugin)?/i.test(command)) {
    let filename = text.replace(/plugin(s)\//i, '') + (/\.js$/i.test(text) ? '' : '.js')

    const error = syntaxError(m.quoted.text, filename, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    })
    if (error) throw error

    const pluginsRoot = path.join(process.cwd(), 'plugins')

    // kalau user udah nulis folder sendiri (misal "owner/newban.js"), pakai apa adanya.
    // kalau enggak, tebak kategori dari prefix nama file (misal "ai-xxx.js" -> folder ai/)
    let relTarget = filename
    if (!filename.includes('/')) {
      const catMatch = filename.match(/^([a-zA-Z0-9]+)-/)
      if (catMatch) relTarget = path.join(catMatch[1].toLowerCase(), filename)
    }

    const pathFile = path.join(pluginsRoot, relTarget)
    await _fs.mkdir(path.dirname(pathFile), { recursive: true })
    await _fs.writeFile(pathFile, m.quoted.text)

    await conn.sendMessage(
      m.chat,
      { text: `Sukses Menyimpan Di *${relTarget}*` },
      { quoted: m }
    )

  } else {
    const isJavascript = m.quoted.text && !m.quoted.mediaMessage && /\.js$/i.test(text)

    if (isJavascript) {
      const error = syntaxError(m.quoted.text, text, {
        sourceType: 'module',
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true
      })
      if (error) throw error

      await _fs.writeFile(text, m.quoted.text)

      await conn.sendMessage(
        m.chat,
        { text: `Sukses Menyimpan Di *${text}*` },
        { quoted: m }
      )

    } else if (m.quoted.mediaMessage) {
      const media = await m.quoted.download()
      await _fs.writeFile(text, media)

      await conn.sendMessage(
        m.chat,
        { text: `Sukses Menyimpan Di *${text}*` },
        { quoted: m }
      )

    } else {
      throw 'Tidak Support!!'
    }
  }
}

handler.help = ['saveplugin']
handler.tags = ['owner']
handler.command = /^(sf|saveplugin|sp)$/i
handler.rowner = true

export default handler