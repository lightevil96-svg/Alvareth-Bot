import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import JSZip from 'jszip'

const BRANCH = process.env.AUTO_UPDATE_BRANCH || 'main'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024

// These are runtime/local files: never replace them from the repository.
const protectedPath = (rel) => {
  const p = rel.replaceAll('\\\\', '/').replace(/^\\/+/, '')
  const parts = p.split('/')
  return (
    !p || p.startsWith('.git/') || p === '.git' ||
    p === '.env' || p.startsWith('.env.') ||
    p === 'node_modules' || p.startsWith('node_modules/') ||
    p === 'sessions' || p.startsWith('sessions/') ||
    p === 'session' || p.startsWith('session/') ||
    p === 'tmp' || p.startsWith('tmp/') ||
    p === 'logs' || p.startsWith('logs/') ||
    p === 'data' || p.startsWith('data/') ||
    p.startsWith('.alvareth-bot-data/') ||
    parts.some(part => part === '..') ||
    p.includes(String.fromCharCode(0))
  )
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

const runNpmInstall = () => new Promise((resolve, reject) => {
  const child = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  child.once('error', reject)
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`npm install keluar dengan kode ${code}`)))
})

const handler = async (m, { conn, isOwner }) => {
  if (!isOwner) throw '❌ Perintah ini khusus owner bot.'
  if (global.__alvarethUpdateRunning) return m.reply('⏳ Update sedang berjalan, tunggu sampai selesai.')

  global.__alvarethUpdateRunning = true
  let changed = []
  let added = []
  let dependencyFilesChanged = false

  try {
    await m.reply('🔎 Memeriksa pembaruan Alvareth Bot di GitHub...')
    const url = `https://codeload.github.com/lightevil96-svg/Alvareth-Bot/zip/refs/heads/${encodeURIComponent(BRANCH)}`
    const response = await fetch(url, { headers: { 'User-Agent': 'Alvareth-Bot-Updater' } })
    if (!response.ok) throw new Error(`GitHub mengembalikan HTTP ${response.status}`)

    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > MAX_ARCHIVE_BYTES) throw new Error('Arsip update terlalu besar; dibatalkan demi keamanan.')
    const archiveBuffer = Buffer.from(await response.arrayBuffer())
    if (archiveBuffer.length > MAX_ARCHIVE_BYTES) throw new Error('Arsip update melebihi batas 100 MB; dibatalkan demi keamanan.')

    const zip = await JSZip.loadAsync(archiveBuffer, { checkCRC32: true })
    const entries = Object.values(zip.files).filter(entry => !entry.dir)
    if (!entries.length) throw new Error('Arsip GitHub kosong atau tidak valid.')

    // GitHub ZIPs include one top-level directory; strip that prefix.
    const firstSlash = entries[0].name.indexOf('/')
    const rootPrefix = firstSlash >= 0 ? entries[0].name.slice(0, firstSlash + 1) : ''
    const root = process.cwd()

    for (const entry of entries) {
      if (entry.name.startsWith('__MACOSX/')) continue
      const rel = (rootPrefix && entry.name.startsWith(rootPrefix))
        ? entry.name.slice(rootPrefix.length)
        : entry.name
      if (!rel || protectedPath(rel)) continue

      const normalized = path.posix.normalize(rel)
      if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) continue
      const destination = path.resolve(root, ...normalized.split('/'))
      if (destination !== root && !destination.startsWith(root + path.sep)) continue

      const remoteBuffer = await entry.async('nodebuffer')
      let localBuffer = null
      try {
        const stat = await fs.lstat(destination)
        if (stat.isSymbolicLink() || !stat.isFile()) continue
        localBuffer = await fs.readFile(destination)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }

      if (localBuffer && sha256(localBuffer) === sha256(remoteBuffer)) continue

      await fs.mkdir(path.dirname(destination), { recursive: true })
      const tempPath = destination + '.alvareth-update-tmp'
      await fs.writeFile(tempPath, remoteBuffer)
      await fs.rename(tempPath, destination)

      if (localBuffer) changed.push(normalized)
      else added.push(normalized)
      if (['package.json', 'package-lock.json', 'npm-shrinkwrap.json'].includes(normalized)) {
        dependencyFilesChanged = true
      }
    }

    if (dependencyFilesChanged) {
      await m.reply('📦 File dependensi berubah. Menjalankan npm install...')
      await runNpmInstall()
    }

    if (changed.length === 0 && added.length === 0) {
      await m.reply(`✅ Alvareth Bot sudah versi terbaru (branch ${BRANCH}). Tidak ada file yang ditulis ulang.`)
      return
    }

    const list = [
      changed.length ? `Diubah (${changed.length}):\\n${changed.slice(0, 20).map(f => '• ' + f).join('\\n')}` : '',
      added.length ? `Ditambahkan (${added.length}):\\n${added.slice(0, 20).map(f => '• ' + f).join('\\n')}` : ''
    ].filter(Boolean).join('\\n\\n')
    const extra = changed.length + added.length > 40 ? '\\n...daftar dipotong.' : ''
    await m.reply(`✅ Update berhasil diterapkan.\\n\\n${list}${extra}\\n\\n🔄 Bot akan restart sekarang. Sesi WhatsApp, .env, database, dan file lokal yang tidak berubah tetap dipertahankan.`)

    // index.js supervises this worker; the reset IPC asks the supervisor to
    // restart the worker so the panel's long-running parent process stays alive.
    setTimeout(() => {
      if (typeof process.send === 'function') process.send('reset')
      else process.exit(0)
    }, 1500)
  } catch (error) {
    console.error('[Alvareth updater]', error)
    await m.reply('❌ Update gagal dan restart dibatalkan.\\n' + (error?.message || String(error)))
  } finally {
    global.__alvarethUpdateRunning = false
  }
}

handler.help = ['update']
handler.tags = ['owner']
handler.command = /^update$/i
handler.owner = true

export default handler
