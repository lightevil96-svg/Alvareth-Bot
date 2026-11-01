import fs from 'fs'
import os from 'os'
import path from 'path'

const digits = value => String(value || '').replace(/\D/g, '')
const jidNumber = value => digits(String(value || '').split('@')[0])

const handler = async (m) => {
  try {
    const dataDir = process.env.ALVARETH_DATA_DIR
      ? path.resolve(process.env.ALVARETH_DATA_DIR)
      : path.join(os.homedir(), '.alvareth-bot-data')
    const databasePath = path.join(dataDir, 'database.json')
    const exists = fs.existsSync(databasePath)
    const stat = exists ? fs.statSync(databasePath) : null

    let diskData = null
    let diskError = ''
    if (exists) {
      try {
        diskData = JSON.parse(fs.readFileSync(databasePath, 'utf8'))
      } catch (error) {
        diskError = error?.message || String(error)
      }
    }

    const memoryData = global.db?.data || {}
    const diskUsers = diskData?.users && typeof diskData.users === 'object' ? diskData.users : {}
    const memoryUsers = memoryData.users && typeof memoryData.users === 'object' ? memoryData.users : {}
    const sender = String(m.sender || '')
    const senderPN = String(m.senderPN || '')
    const senderDigits = jidNumber(senderPN || sender)

    const exactKey = Object.prototype.hasOwnProperty.call(memoryUsers, sender)
      ? sender
      : Object.prototype.hasOwnProperty.call(diskUsers, sender)
        ? sender
        : ''

    const phoneMatches = [...new Set([
      ...Object.keys(memoryUsers),
      ...Object.keys(diskUsers)
    ])].filter(key => senderDigits && jidNumber(key) === senderDigits)

    const matchedKey = exactKey || phoneMatches[0] || ''
    const matchedUser = matchedKey
      ? (memoryUsers[matchedKey] || diskUsers[matchedKey] || {})
      : {}

    const registeredCount = Object.values(diskUsers).filter(user => user?.registered === true).length
    const memoryRegisteredCount = Object.values(memoryUsers).filter(user => user?.registered === true).length
    const currentUserExists = Boolean(exactKey || phoneMatches.length)

    const report = [
      '🔎 *DIAGNOSTIK DATABASE ALVARETH*',
      '',
      '*Lokasi penyimpanan*',
      'Folder data: ' + dataDir,
      'File database: ' + databasePath,
      'File ditemukan: ' + (exists ? 'YA' : 'TIDAK'),
      'Ukuran file: ' + (stat ? (stat.size / 1024).toFixed(2) + ' KB' : '-'),
      'Database dapat dibaca: ' + (diskData ? 'YA' : (diskError ? 'TIDAK' : 'BELUM ADA')),
      diskError ? 'Kesalahan baca: ' + diskError.slice(0, 300) : '',
      '',
      '*Ringkasan data*',
      'Pengguna di file: ' + Object.keys(diskUsers).length,
      'Pengguna terdaftar di file: ' + registeredCount,
      'Pengguna di memori bot: ' + Object.keys(memoryUsers).length,
      'Pengguna terdaftar di memori: ' + memoryRegisteredCount,
      '',
      '*Pemeriksaan akun pengirim*',
      'JID saat ini: ' + (sender || '-'),
      'JID nomor terhubung: ' + (senderPN || '-'),
      'Data akun ditemukan: ' + (currentUserExists ? 'YA' : 'TIDAK'),
      'Kecocokan identitas: ' + (exactKey ? 'JID persis' : phoneMatches.length ? 'Nomor telepon sama (' + phoneMatches.length + ' data)' : 'Tidak ditemukan'),
      matchedKey ? 'Status terdaftar: ' + (matchedUser.registered === true ? 'YA' : 'TIDAK') : '',
      matchedKey ? 'Level: ' + (matchedUser.level ?? 0) : '',
      matchedKey ? 'EXP: ' + (matchedUser.exp ?? 0) : '',
      matchedKey ? 'Limit: ' + (matchedUser.limit ?? 0) : '',
      '',
      'ℹ️ Pemeriksaan ini hanya membaca data. Tidak ada database atau profil yang diubah.'
    ].filter(Boolean).join('\n')

    await m.reply(report)
  } catch (error) {
    await m.reply('❌ Diagnostik gagal dijalankan: ' + (error?.message || String(error)))
  }
}

handler.help = ['cekdata']
handler.tags = ['owner']
handler.command = /^cekdata$/i
handler.owner = true
handler.register = false

export default handler
