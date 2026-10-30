import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const MIN_AGE_MS = 2 * 60 * 60 * 1000
const PREFIX = 'alvareth-tiktok-'

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return (bytes / (1024 ** index)).toFixed(index ? 2 : 0) + ' ' + units[index]
}

async function measureSize(target) {
  let total = 0
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(target, entry.name)
    try {
      if (entry.isDirectory()) total += await measureSize(fullPath)
      else if (entry.isFile()) total += (await fs.stat(fullPath)).size
    } catch { /* file may disappear while cleanup is running */ }
  }
  return total
}

async function cleanTikTokTemps(root, cutoff) {
  let removed = 0
  let bytes = 0
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(PREFIX)) continue
    const target = path.join(root, entry.name)
    try {
      const info = await fs.stat(target)
      if (info.mtimeMs > cutoff) continue
      const size = await measureSize(target)
      await fs.rm(target, { recursive: true, force: false, maxRetries: 2, retryDelay: 200 })
      removed += 1
      bytes += size
    } catch (error) {
      console.warn('[CLEAN] Tidak dapat membersihkan', target, error?.message || error)
    }
  }
  return { removed, bytes }
}

const handler = async (m) => {
  await m.reply('🧹 Memeriksa file sementara milik Alvareth...\nFile aktif dan data penting tidak akan disentuh.')
  const roots = new Set([os.tmpdir(), process.env.ALVARETH_TIKTOK_TMPDIR].filter(Boolean).map(value => path.resolve(value)))
  const cutoff = Date.now() - MIN_AGE_MS
  let removed = 0
  let bytes = 0

  for (const root of roots) {
    const result = await cleanTikTokTemps(root, cutoff)
    removed += result.removed
    bytes += result.bytes
  }

  let diskInfo = 'Tidak tersedia'
  try {
    const stats = await fs.statfs(process.cwd())
    diskInfo = formatBytes(Number(stats.bavail) * Number(stats.bsize)) + ' tersedia'
  } catch { /* statfs is not supported on every hosting runtime */ }

  await m.reply(
    '✅ *Pembersihan selesai*\n\n' +
    '• Folder sementara TikTok dihapus: ' + removed + '\n' +
    '• Perkiraan ruang dibebaskan: ' + formatBytes(bytes) + '\n' +
    '• Ruang tersedia pada filesystem bot: ' + diskInfo + '\n\n' +
    'Catatan: hanya folder sementara bernama alvareth-tiktok-* yang berusia lebih dari 2 jam yang dibersihkan. Sesi WhatsApp, database, backup, konfigurasi, dan file unduhan pengguna tidak dihapus.'
  )
}

handler.help = ['clean']
handler.tags = ['owner']
handler.command = /^clean$/i
handler.owner = true

export default handler
