import { WAMessageStubType } from 'baileys'
import PhoneNumber from 'awesome-phonenumber'
import chalk from 'chalk'
import { watchFile } from 'fs'

function formatBytes(bytes = 0) {
  if (!bytes || isNaN(bytes)) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function getTime(timestamp) {
  return new Date(
    timestamp ? 1000 * (timestamp.low || timestamp) : Date.now()
  ).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
}

export default async function (m, conn = { user: {} }) {
  try {
    // Some WhatsApp system/status updates have no sender or chat JID.
    // Log them safely instead of crashing the logger.
    const senderJid = typeof m?.sender === 'string' ? m.sender : ''
    const chatJid = typeof m?.chat === 'string' ? m.chat : ''
    const botJid = typeof conn?.user?.jid === 'string' ? conn.user.jid : ''

    if (!senderJid || !chatJid) {
      // Ignore routine WhatsApp system/status updates silently to avoid flooding the terminal.
      return
    }

    const name = await Promise.resolve(conn.getName(senderJid)).catch(() => '')
    const rawSenderNumber = senderJid.split('@')[0].split(':')[0]
    const parsedSender = rawSenderNumber ? PhoneNumber('+' + rawSenderNumber).getNumber('international') : ''
    const sender = (parsedSender || rawSenderNumber || senderJid) + (name ? ` ~ ${name}` : '')

    const chatName = await Promise.resolve(conn.getName(chatJid)).catch(() => '')
    const chatLabel = chatName || (chatJid.endsWith('@g.us') ? `Grup ${chatJid.split('@')[0]}` : chatJid.endsWith('@s.whatsapp.net') ? 'Chat pribadi' : chatJid)
    const rawBotNumber = botJid ? botJid.split('@')[0].split(':')[0] : ''
    const botNumber = rawBotNumber
      ? (PhoneNumber('+' + rawBotNumber).getNumber('international') || rawBotNumber)
      : 'Belum tersedia'
    const botName = 'Alvareth Bot'

    const filesize =
      m.msg?.fileLength?.low ||
      m.msg?.fileLength ||
      m.msg?.vcard?.length ||
      m.msg?.axolotlSenderKeyDistributionMessage?.length ||
      m.text?.length ||
      0

    const user = global.db.data.users[m.sender] || {}
    const time = getTime(m.messageTimestamp)

    const type = m.mtype
      ? m.mtype
          .replace(/message$/i, '')
          .replace('audio', m.msg?.ptt ? 'PTT' : 'Audio')
          .replace(/^./, v => v.toUpperCase())
      : '-'

    const stub = m.messageStubType
      ? WAMessageStubType[m.messageStubType]
      : '-'

    console.log(
      chalk.hex('#9b5cff')('╭────────────── 🎸 ALVARETH BOT 🎸 ──────────────'),
      '\n' + chalk.magentaBright('│ 🎸 Bot        : ') + chalk.white(`${botNumber} ~ ${botName}`),
      '\n' + chalk.yellowBright('│ ⏰ Waktu      : ') + chalk.white(time),
      '\n' + chalk.cyanBright('│ 💬 Sumber Chat: ') + chalk.white(chatLabel),
      '\n' + chalk.greenBright('│ 👤 From       : ') + chalk.white(sender),
      '\n' + chalk.blueBright('│ 🎴 Type Msg  : ') + chalk.white(type),
      '\n' + chalk.redBright('│ 🧩 Event     : ') + chalk.white(stub),
      '\n' + chalk.magentaBright('│ 📦 Size      : ') + chalk.white(formatBytes(filesize)),
      '\n' + chalk.yellowBright('│ ⭐ Status    : ') + chalk.white(
        `Lv.${user.level || 0} | Exp ${user.exp || 0} | Limit ${user.limit || 0}`
      ),
      '\n' + chalk.hex('#9b5cff')('╰──────────────────────────────────────────────')
    )

    // ===== CHAT TEXT =====
    if (typeof m.text === 'string' && m.text) {
      let log = m.text.replace(/\u200e+/g, '')

      if (m.mentionedJid) {
        for (let jid of m.mentionedJid) {
          log = log.replace(
            '@' + jid.split('@')[0],
            chalk.cyanBright('@' + await conn.getName(jid))
          )
        }
      }

      if (m.error) console.log(chalk.redBright('❌ ERROR   : ' + log))
      else if (m.isCommand) console.log(chalk.greenBright('⚡ COMMAND : ' + log))
      else console.log(chalk.white('💬 CHAT    : ' + log))
    }

    // ===== MEDIA INFO =====
    // Some WhatsApp status/broadcast messages have m.mtype but no serialized m.msg.
    const mediaMessage = m?.msg ||
      m?.message?.audioMessage ||
      m?.message?.documentMessage ||
      m?.message?.contactMessage ||
      {}

    if (/document/i.test(m?.mtype || '')) {
      console.log(chalk.blue('📄 FILE    :'), mediaMessage.fileName || mediaMessage.displayName || '-')
    } else if (/contact/i.test(m?.mtype || '')) {
      console.log(chalk.blue('👤 CONTACT :'), mediaMessage.displayName || '-')
    } else if (/audio/i.test(m?.mtype || '')) {
      const seconds = Number(mediaMessage.seconds)
      const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
      console.log(
        chalk.magenta(
          `🎧 AUDIO   : ${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(
            duration % 60
          ).padStart(2, '0')}`
        )
      )
    }

    console.log()

  } catch (e) {
    console.error(chalk.red('LOGGER CRASH:'), e)
  }
}

let file = global.__filename(import.meta.url)
watchFile(file, () => {
  console.log(chalk.magentaBright('Logger Alvareth Bot updated'))
})