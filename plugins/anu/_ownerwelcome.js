// Owner welcome plugin; uses the configured owner in config.js.
let handler = {}

handler.before = async function (m, { conn }) {
  if (!m.isGroup || m.fromMe) return
  const configuredOwner = global.owner?.[0]?.[0]
  if (!configuredOwner) return
  const ownerJid = `${String(configuredOwner).replace(/\D/g, '')}@s.whatsapp.net`
  if (m.sender !== ownerJid) return

  const user = global.db.data.users[m.sender] || (global.db.data.users[m.sender] = {})
  const now = Date.now()
  if (user.ownerWelcome && now - user.ownerWelcome < 3600000) return
  user.ownerWelcome = now

  await conn.sendMessage(m.chat, {
    text: `Hai ownerku, ${global.namebot || 'Alvareth Bot'} siap membantu.\n@${ownerJid.split('@')[0]}`,
    mentions: [ownerJid]
  })
}

export default handler
