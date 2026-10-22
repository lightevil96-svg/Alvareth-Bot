import { buildGroupDigest } from '../../lib/group-digest.js'

const handler = async (m, { args }) => {
  let hours = 24
  const remaining = []
  for (const argument of args || []) {
    const value = String(argument || '').toLowerCase()
    const match = value.match(/^(\d{1,3})(h|j|d|hari)$/)
    if (match) {
      const amount = Number(match[1])
      const unit = match[2]
      hours = amount * (unit === 'd' || unit === 'hari' ? 24 : 1)
      continue
    }
    if (value === 'minggu' || value === 'sepekan') {
      hours = 168
      continue
    }
    if (value === 'semua' || value === 'all') continue
    remaining.push(argument)
  }

  hours = Math.max(1, Math.min(168, hours))
  const groupQuery = remaining.join(' ').trim()
  const report = await buildGroupDigest({ hours, groupQuery })
  if (typeof m.reply === 'function') return m.reply(report)
  if (typeof this?.sendMessage === 'function' && m.chat) {
    return this.sendMessage(m.chat, { text: report }, m.key ? { quoted: m } : {})
  }
  throw new Error('Tidak dapat mengirim ringkasan ke chat ini.')
}

handler.help = ['ringkaswa', 'ringkaswa <3h|24h|7d> <nama grup>']
handler.tags = ['owner']
handler.command = /^(ringkaswa|ringkasgrup|ringkasgc)$/i
handler.owner = true
handler.private = true

export default handler
