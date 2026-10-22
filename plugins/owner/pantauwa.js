import {
  buildGroupDigest,
  clearGroupDigestMessages,
  getGroupDigestStatus,
  listGroupDigestGroups,
  setGroupDigestEnabled,
  setGroupDigestTime,
  setGroupFocusByQuery
} from '../../lib/group-digest.js'

const handler = async (m, { args, usedPrefix, command }) => {
  const reply = async text => {
    if (typeof m.reply === 'function') return m.reply(String(text))
    if (typeof this?.sendMessage === 'function' && m.chat) {
      return this.sendMessage(m.chat, { text: String(text) }, m.key ? { quoted: m } : {})
    }
    throw new Error('Tidak dapat mengirim balasan ke chat ini.')
  }

  const action = String(args[0] || 'help').toLowerCase()
  const rest = args.slice(1).join(' ').trim()
  const help = [
    '*📚 PEMANTAU & RINGKASAN GRUP WA*',
    '',
    'Fitur mencatat pesan teks baru dari semua grup yang terlihat oleh akun WhatsApp ini. Data diproses lokal tanpa API key/login AI dan diringkas otomatis setiap hari.',
    '',
    '*Perintah (gunakan di chat pribadi bot):*',
    '• ' + usedPrefix + command + ' status — status pemantauan',
    '• ' + usedPrefix + command + ' on / off — aktifkan atau hentikan pemantauan',
    '• ' + usedPrefix + command + ' daftar — daftar nama grup yang terdeteksi',
    '• ' + usedPrefix + command + ' fokus <nama grup> — prioritaskan grup kuliah',
    '• ' + usedPrefix + command + ' unfokus <nama grup> — hapus prioritas manual',
    '• ' + usedPrefix + command + ' jam 21:00 — ubah jam laporan (WIB)',
    '• ' + usedPrefix + command + ' hapusdata — hapus riwayat pesan tersimpan',
    '',
    '*Minta ringkasan kapan saja:*',
    '• .ringkaswa — 24 jam terakhir dari semua grup',
    '• .ringkaswa 3h — 3 jam terakhir',
    '• .ringkaswa 7d — 7 hari terakhir',
    '• .ringkaswa 24h PGMI — 24 jam terakhir dari grup yang namanya cocok',
    '',
    'Riwayat pesan disimpan lokal maksimal 7 hari. Grup yang bernama mengandung kata kuliah, kelas, kampus, PGMI, dosen, atau tugas otomatis diprioritaskan. Pemantauan tidak bisa mengambil pesan sebelum bot dipasang.'
  ].join('\n')

  if (action === 'help') return reply(help)

  if (action === 'status') {
    const status = await getGroupDigestStatus()
    return reply([
      '*📊 STATUS RINGKASAN GRUP*',
      'Pemantauan: ' + (status.enabled ? 'AKTIF ✅' : 'NONAKTIF ⏸️'),
      'Jadwal laporan: setiap hari pukul ' + status.dailyTime + ' WIB',
      'Grup dengan pesan tersimpan: ' + status.groups,
      'Pesan tersimpan (maks. 7 hari): ' + status.messages,
      'Terakhir dikirim: ' + (status.lastAutoSentDate || 'belum ada')
    ].join('\n'))
  }

  if (action === 'on' || action === 'aktif') {
    await setGroupDigestEnabled(true)
    return reply('✅ Pemantauan grup diaktifkan. Pesan baru akan mulai diringkas; jadwal harian tetap berjalan sesuai jam yang ditetapkan.')
  }

  if (action === 'off' || action === 'nonaktif') {
    await setGroupDigestEnabled(false)
    return reply('⏸️ Pemantauan dihentikan. Ringkasan otomatis juga berhenti. Riwayat yang sudah tersimpan tidak dihapus; gunakan .pantauwa hapusdata bila ingin menghapusnya.')
  }

  if (action === 'jam' || action === 'waktu') {
    try {
      const time = await setGroupDigestTime(rest)
      return reply('✅ Jadwal ringkasan harian diubah menjadi pukul ' + time + ' WIB.')
    } catch (error) {
      return reply('❌ ' + (error?.message || 'Jam tidak valid.') + '\nContoh: .pantauwa jam 21:00')
    }
  }

  if (action === 'daftar' || action === 'list') {
    const groups = await listGroupDigestGroups()
    if (!groups.length) {
      return reply('Belum ada grup yang terdeteksi. Setelah bot menerima pesan teks baru dari grup, nama grup akan muncul di sini.')
    }
    const rows = groups.slice(0, 40).map((group, index) => {
      const marker = group.focus ? '🎯' : group.priority ? '⭐' : '•'
      return (index + 1) + '. ' + marker + ' ' + group.name +
        '\n   Pesan tersimpan: ' + group.messageCount +
        '\n   ID: ' + group.jid
    })
    if (groups.length > 40) rows.push('…dan ' + (groups.length - 40) + ' grup lain.')
    return reply('*📋 GRUP YANG TERDETEKSI*\n' + rows.join('\n'))
  }

  if (action === 'fokus' || action === 'priority') {
    if (!rest) return reply('Masukkan sebagian nama grup.\nContoh: .pantauwa fokus PGMI\nLihat nama grup dengan .pantauwa daftar')
    const result = await setGroupFocusByQuery(rest, true)
    if (!result.matched.length) return reply('❌ Nama grup "' + rest + '" belum cocok dengan grup yang terdeteksi. Ketik .pantauwa daftar, lalu coba sebagian nama yang tepat.')
    return reply('🎯 Grup diprioritaskan:\n' + result.matched.map(item => '• ' + item.name).join('\n') + '\n\nGrup ini akan ditampilkan lebih awal dalam ringkasan.')
  }

  if (action === 'unfokus' || action === 'normal') {
    if (!rest) return reply('Masukkan sebagian nama grup.\nContoh: .pantauwa unfokus PGMI')
    const result = await setGroupFocusByQuery(rest, false)
    if (!result.matched.length) return reply('❌ Nama grup "' + rest + '" tidak ditemukan. Ketik .pantauwa daftar.')
    return reply('✅ Prioritas manual dihapus dari:\n' + result.matched.map(item => '• ' + item.name).join('\n'))
  }

  if (action === 'hapusdata' || action === 'clear') {
    const count = await clearGroupDigestMessages()
    return reply('🧹 Riwayat pesan ringkasan dihapus (' + count + ' pesan). Nama grup dan pengaturan prioritas tetap disimpan.')
  }

  return reply(help)
}

handler.help = ['pantauwa', 'ringkaswa']
handler.tags = ['owner']
handler.command = /^(pantauwa|groupdigest|grouppantau)$/i
handler.owner = true
handler.private = true

export default handler
