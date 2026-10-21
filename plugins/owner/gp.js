import cp, { exec as _exec } from 'child_process'
import { promisify } from 'util'
import { generateWAMessageFromContent, proto } from 'baileys'

const exec = promisify(_exec).bind(cp)

let handler = async (m, { conn, isROwner, usedPrefix, command, text }) => {
  if (!isROwner) return
  if (!text) {
    throw `uhm.. where the text?\n\nexample:\n${usedPrefix + command} menu`
  }

  await m.react('🕒')

  const plugins = Object.keys(global.plugins)
  const names = plugins.map(v => v.replace(/\.js$/, ''))

  if (!names.includes(text)) {
    return m.reply(
      `❌ *Plugin Tidak Ditemukan*\n\n📦 *Daftar Plugin:*\n${names.map(v => `• ${v}`).join('\n')}`
    )
  }

  try {
    const { stdout, stderr } = await exec(`cat plugins/${text}.js`)

    if (stderr) throw new Error(stderr)

    const code = stdout.trim()

    const msg = generateWAMessageFromContent(m.chat, {
      viewOnceMessage: {
        message: {
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({
              text: `📄 *Plugin:* ${text}.js\n\nTekan tombol di bawah untuk menyalin source code.`
            }),
            footer: proto.Message.InteractiveMessage.Footer.create({
              text: 'ʀʏᴏ ʏᴀᴍᴀᴅᴀ - ᴍᴅ'
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
              buttons: [
                {
                  name: 'cta_copy',
                  buttonParamsJson: JSON.stringify({
                    display_text: ' Copy Source',
                    copy_code: code
                  })
                }
              ]
            })
          })
        }
      }
    }, {})

    await conn.relayMessage(
      m.chat,
      msg.message,
      { messageId: msg.key.id }
    )

    await m.react('✅')
  } catch (e) {
    console.error(e)
    await m.react('❌')
    throw e.message || String(e)
  }
}

handler.help = ['getplugin']
handler.tags = ['owner']
handler.command = /^(getplugin|gp)$/i
handler.rowner = true

export default handler