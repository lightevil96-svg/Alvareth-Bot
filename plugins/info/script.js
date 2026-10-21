import fs from 'fs'

let handler = async (m, { conn }) => {
  const repository = global.repository || 'Belum dikonfigurasi (atur REPOSITORY_URL di .env).'
  const channel = global.linkch || 'Belum dikonfigurasi (atur WHATSAPP_CHANNEL_URL di .env).'
  await conn.sendMessage(m.chat, {
    orderText: `Hai kak! 👋\n\n❏ Script *Alvareth Bot*\n\n✿ *Repository:*\n${repository}\n\n✿ *Channel:*\n${channel}`,
    thumbnail: fs.readFileSync('./media/thumbnail.jpg')
  }, { quoted: m })
}

handler.help = ['sc', 'script']
handler.tags = ['info']
handler.command = /^(sc|script)$/i

export default handler
