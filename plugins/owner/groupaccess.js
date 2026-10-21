/**
 * Group allowlist manager for Alvareth Bot.
 *
 * Commands are owner-only and private-chat-only:
 * .groupaccess help
 * .groupaccess status
 * .groupaccess list
 * .groupaccess add <group-id@g.us>
 * .groupaccess remove <group-id@g.us>
 * .groupaccess on
 * .groupaccess off
 *
 * enabled=true means ONLY listed groups are processed.
 * enabled=false disables the restriction and allows all groups.
 */
const handler = async (m, { conn, args, usedPrefix, command }) => {
  // This fork's serialized message may not expose reply(); use the connection fallback.
  const reply = async text => {
    if (typeof m.reply === 'function') return m.reply(text)
    const chat = m.chat || m.key?.remoteJid
    if (!chat || typeof conn?.sendMessage !== 'function') throw new Error('Tidak dapat membalas: chat atau conn.sendMessage tidak tersedia.')
    return conn.sendMessage(chat, { text: String(text) }, m.key ? { quoted: m } : {})
  }

  const settings = global.db.data.settings || (global.db.data.settings = {})
  const access = settings.groupAccess || (settings.groupAccess = {
    enabled: true,
    allowedGroups: [],
    updatedAt: 0,
    updatedBy: ''
  })

  if (!Array.isArray(access.allowedGroups)) access.allowedGroups = []
  access.enabled = access.enabled !== false

  const action = String(args[0] || 'help').toLowerCase()
  const suppliedId = String(args[1] || '').trim()
  const save = async () => {
    access.updatedAt = Date.now()
    access.updatedBy = m.sender || 'unknown'
    await global.db.write()
  }
  const help = [
    '*🔐 PENGATURAN AKSES GRUP*',
    '',
    'Fitur ini membuat bot hanya memproses pesan dari grup yang masuk daftar izin.',
    '',
    '*Perintah:*',
    '• ' + usedPrefix + command + ' help — panduan',
    '• ' + usedPrefix + command + ' status — status fitur',
    '• ' + usedPrefix + command + ' list — daftar grup diizinkan',
    '• ' + usedPrefix + command + ' add <ID_GRUP> — izinkan grup',
    '• ' + usedPrefix + command + ' remove <ID_GRUP> — cabut izin grup',
    '• ' + usedPrefix + command + ' on — aktifkan pembatasan',
    '• ' + usedPrefix + command + ' off — nonaktifkan pembatasan',
    '',
    '*Cara kerja:*',
    '• ON: hanya grup yang terdaftar yang akan dilayani.',
    '• OFF: semua grup boleh menggunakan bot.',
    '• Chat pribadi tetap bisa digunakan untuk mengatur fitur ini.',
    '• Saat ON dan daftar kosong, semua grup akan diabaikan.',
    '',
    '*Format ID grup:* harus berakhiran @g.us',
    'Contoh: 120363012345678901@g.us',
    'ID grup bisa dilihat pada log terminal saat ada pesan masuk dari grup.'
  ].join('\n')

  if (action === 'help') return reply(help)

  if (action === 'status') {
    return reply([
      '*🔐 STATUS AKSES GRUP*',
      'Pembatasan: ' + (access.enabled ? 'AKTIF (allowlist)' : 'NONAKTIF (semua grup diizinkan)'),
      'Jumlah grup diizinkan: ' + access.allowedGroups.length,
      'Perilaku: ' + (access.enabled
        ? (access.allowedGroups.length ? 'Hanya grup dalam daftar yang direspons.' : 'Semua grup diblokir sampai ada grup yang ditambahkan.')
        : 'Semua grup dapat menggunakan bot.'),
      'Perintah bantuan: ' + usedPrefix + command + ' help'
    ].join('\n'))
  }

  if (action === 'list') {
    if (!access.allowedGroups.length) {
      return reply('Daftar izin grup masih kosong.\nTambahkan grup dengan:\n' + usedPrefix + command + ' add <ID_GRUP>')
    }
    return reply('*📋 GRUP YANG DIIZINKAN*\n\n' + access.allowedGroups.map((id, i) => (i + 1) + '. ' + id).join('\n'))
  }

  if (action === 'on') {
    access.enabled = true
    await save()
    return reply('✅ Pembatasan grup AKTIF. Bot hanya merespons grup dalam daftar izin.')
  }

  if (action === 'off') {
    access.enabled = false
    await save()
    return reply('⚠️ Pembatasan grup NONAKTIF. Semua grup kembali dapat menggunakan bot.')
  }

  if (action === 'add') {
    if (!suppliedId || !suppliedId.endsWith('@g.us') || /\s/.test(suppliedId)) {
      return reply('❌ ID grup tidak valid. ID harus berakhiran @g.us.\nContoh:\n' + usedPrefix + command + ' add 120363012345678901@g.us\n\nKetik ' + usedPrefix + command + ' help untuk panduan.')
    }
    if (access.allowedGroups.includes(suppliedId)) {
      return reply('ℹ️ Grup tersebut sudah ada dalam daftar izin:\n' + suppliedId)
    }
    access.allowedGroups.push(suppliedId)
    await save()
    return reply('✅ Grup berhasil diizinkan:\n' + suppliedId + '\n\nStatus pembatasan: ' + (access.enabled ? 'AKTIF' : 'NONAKTIF') + '.')
  }

  if (action === 'remove' || action === 'del' || action === 'delete') {
    if (!suppliedId) return reply('Gunakan: ' + usedPrefix + command + ' remove <ID_GRUP>')
    const before = access.allowedGroups.length
    access.allowedGroups = access.allowedGroups.filter(id => id !== suppliedId)
    if (access.allowedGroups.length === before) {
      return reply('ℹ️ Grup tidak ditemukan dalam daftar izin:\n' + suppliedId)
    }
    await save()
    return reply('✅ Izin grup dicabut:\n' + suppliedId + '\nJika pembatasan aktif, bot akan mengabaikan pesan berikutnya dari grup tersebut.')
  }

  return reply('❓ Perintah tidak dikenal.\n\n' + help)
}

handler.help = ['groupaccess']
handler.tags = ['owner']
handler.command = /^(groupaccess|gaccess)$/i
handler.owner = true
handler.private = true

export default handler
