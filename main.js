// ═══════════════════════════════════════════════════════════════
// ALVARETH BOT — main.js
// QR login, auto-reconnect, recursive plugin loader, lowdb
// ═══════════════════════════════════════════════════════════════

import './config.js'

import { join, dirname, relative, sep, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { readdirSync, readFileSync, existsSync, statSync, watch, copyFileSync, cpSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { format } from 'util'
import yargs from 'yargs'
import pino from 'pino'
import chalk from 'chalk'
import QRCode from 'qrcode'
import _ from 'lodash'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import syntaxerror from 'syntax-error'
import { useMultiFileAuthState, fetchLatestWaWebVersion, makeCacheableSignalKeyStore, DisconnectReason } from 'baileys'
import { makeWASocket } from './lib/simple.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Keep user data outside the Git checkout so code updates cannot replace it.
const RUNTIME_DATA_DIR = process.env.ALVARETH_DATA_DIR
  ? resolve(process.env.ALVARETH_DATA_DIR)
  : join(homedir(), '.alvareth-bot-data')
mkdirSync(RUNTIME_DATA_DIR, { recursive: true })

const LEGACY_DATABASE_PATH = join(__dirname, 'database.json')
const DATABASE_PATH = join(RUNTIME_DATA_DIR, 'database.json')
const LEGACY_SESSION_DIR = join(__dirname, 'sessions')
const SESSION_DIR = process.env.WA_SESSION_DIR
  ? resolve(process.env.WA_SESSION_DIR)
  : join(RUNTIME_DATA_DIR, 'sessions')
const DATABASE_BACKUP_DIR = join(RUNTIME_DATA_DIR, 'backups')

// Preserve user registrations across code updates and migrate older databases safely.
// Never delete the original database. Merge legacy records only once: old values fill
// missing fields, while values already in the persistent database always take priority.
const DATABASE_MIGRATION_MARKER = join(RUNTIME_DATA_DIR, '.legacy-database-merged-v1')
function mergeMissing(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target
  if (!target || typeof target !== 'object' || Array.isArray(target)) target = {}
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target) || target[key] == null) {
      target[key] = value
    } else if (
      value && target[key] &&
      typeof value === 'object' && typeof target[key] === 'object' &&
      !Array.isArray(value) && !Array.isArray(target[key])
    ) {
      target[key] = mergeMissing(target[key], value)
    }
  }
  return target
}
if (existsSync(LEGACY_DATABASE_PATH) && !existsSync(DATABASE_MIGRATION_MARKER)) {
  try {
    const legacyData = JSON.parse(readFileSync(LEGACY_DATABASE_PATH, 'utf8'))
    let persistentData = {}
    if (existsSync(DATABASE_PATH)) {
      try {
        persistentData = JSON.parse(readFileSync(DATABASE_PATH, 'utf8'))
      } catch (error) {
        // Keep the unreadable file for inspection; do not overwrite it automatically.
        throw new Error(`database persisten tidak valid; file asli dipertahankan (${error.message})`)
      }
    }
    const merged = mergeMissing(persistentData, legacyData)
    if (existsSync(DATABASE_PATH)) {
      mkdirSync(DATABASE_BACKUP_DIR, { recursive: true })
      copyFileSync(DATABASE_PATH, join(DATABASE_BACKUP_DIR, `database-before-legacy-merge-${Date.now()}.json`))
    }
    writeFileSync(DATABASE_PATH, JSON.stringify(merged, null, 2))
    writeFileSync(DATABASE_MIGRATION_MARKER, new Date().toISOString())
    console.log('Database lama digabung dengan data persisten; data yang sudah ada tidak ditimpa.')
  } catch (error) {
    console.error('[DATA MIGRATION] Gagal menggabungkan database lama; kedua file dipertahankan:', error.message)
  }
} else if (!existsSync(DATABASE_PATH) && !existsSync(LEGACY_DATABASE_PATH)) {
  console.log('[DATA] Database baru akan dibuat. Pastikan direktori data lama yang berisi pendaftaran tersedia sebelum menjalankan bot.')
}

// Migrate existing WhatsApp session files without deleting the originals.
if (existsSync(LEGACY_SESSION_DIR)) {
  mkdirSync(SESSION_DIR, { recursive: true })
  if (readdirSync(SESSION_DIR).length === 0) {
    for (const entry of readdirSync(LEGACY_SESSION_DIR)) {
      cpSync(join(LEGACY_SESSION_DIR, entry), join(SESSION_DIR, entry), { recursive: true })
    }
    if (readdirSync(LEGACY_SESSION_DIR).length > 0) {
      console.log('Sesi WhatsApp lama disalin ke lokasi data persisten.')
    }
  }
}

// Keep up to 10 startup snapshots for recovery if a database write goes wrong.
function backupPersistentDatabase() {
  if (!existsSync(DATABASE_PATH)) return
  try {
    mkdirSync(DATABASE_BACKUP_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(DATABASE_PATH, join(DATABASE_BACKUP_DIR, `database-${stamp}.json`))
    const backups = readdirSync(DATABASE_BACKUP_DIR)
      .filter(name => /^database-.*\.json$/.test(name))
      .sort()
    while (backups.length > 10) {
      unlinkSync(join(DATABASE_BACKUP_DIR, backups.shift()))
    }
  } catch (error) {
    console.warn('[DATA BACKUP] Gagal membuat backup database:', error?.message || error)
  }
}
backupPersistentDatabase()

// Gunakan named exports resmi dari fork Baileys agar fungsi auth tidak undefined.

// Helper path/URL yang kompatibel di Windows dan Linux.
function urlToHttpURL(value) {
  if (/^https?:\/\//i.test(value) || /^file:\/\//i.test(value)) return value
  return pathToFileURL(value).href
}
global.__filename = (pathURL = import.meta.url, rmPrefix = process.platform !== 'win32') => {
  if (!rmPrefix) return urlToHttpURL(pathURL)
  return /^file:\/\//i.test(pathURL) ? fileURLToPath(pathURL) : pathURL
}

// Opsi CLI.
const opts = yargs(process.argv.slice(2)).exitProcess(false).parse()
global.opts = opts
const prefixChars = opts.prefix || '‎xzXZ/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.-'
global.prefix = new RegExp('^[' + String(prefixChars).replace(/[|\\{}()[\]^$+*?.\-]/g, '\\$&') + ']')

// Database lowdb.
global.db = new Low(new JSONFile(DATABASE_PATH), { users: {}, chats: {}, stats: {}, msgs: {}, sticker: {}, settings: {} })
global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (!global.db.READ) {
          clearInterval(timer)
          resolve(global.db.data == null ? global.loadDatabase() : global.db.data)
        }
      }, 100)
    })
  }
  if (global.db.data !== null) return global.db.data

  global.db.READ = true
  try {
    await global.db.read()
  } catch (error) {
    console.error(chalk.red('Gagal membaca database:'), error)
  } finally {
    global.db.READ = false
  }

  global.db.data = {
    users: {}, chats: {}, stats: {}, msgs: {}, sticker: {}, settings: {},
    ...(global.db.data || {})
  }
  global.db.chain = _.chain(global.db.data)
  return global.db.data
}
await global.loadDatabase()

// Session & socket.
const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
const { version, isLatest } = await fetchLatestWaWebVersion()
console.log(chalk.cyan(`WA Web version: v${version.join('.')} (latest: ${isLatest})`))

console.log(chalk.cyan('📷 Mode login QR aktif. Pindai QR dari WhatsApp > Perangkat Tertaut.'))

// conn sengaja memakai let karena socket diganti ketika reconnect.
let conn
const silentLogger = pino({ level: 'silent' })
const connectionOptions = {
  version,
  logger: silentLogger,
  printQRInTerminal: true,
  auth: { ...state, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
  browser: ['Ubuntu', 'Chrome', '22.04.4'],
  markOnlineOnConnect: true,
  generateHighQualityLinkPreview: true,
  msgRetryCounterCache: new Map(),
  defaultQueryTimeoutMs: undefined,
  getMessage: async (key) => {
    try {
      if (typeof conn?.loadMessage !== 'function') return undefined
      const message = await conn.loadMessage(key?.id)
      return message?.message || undefined
    } catch {
      return undefined
    }
  },
  cachedGroupMetadata: async (jid) => {
    try {
      return await conn.groupMetadata(jid)
    } catch {
      return null
    }
  }
}

conn = global.conn = makeWASocket(connectionOptions)

// Bind store agar cache kontak/grup tetap tersedia pada socket aktif.
const storeModule = await import('./lib/store.js')
const storeBind = storeModule.default?.bind || storeModule.bind
if (typeof storeBind === 'function') storeBind(conn)

// Resolver @lid → nomor untuk handler.js.
conn.findUserId = async (lid) => {
  try {
    if (!lid || typeof lid !== 'string' || !lid.endsWith('@lid')) return null
    const mapping = conn.signalRepository?.lidMapping
    if (mapping && typeof mapping.getPhoneNumber === 'function') {
      const phone = await mapping.getPhoneNumber(lid)
      if (phone) {
        const phoneNumber = String(phone)
        return { phoneNumber: phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net` }
      }
    }
  } catch {
    // Nomor tidak selalu bisa di-resolve; handler tetap dapat memakai LID.
  }
  return null
}

// Login hanya menggunakan QR; pairing code dinonaktifkan.

// Handler utama dan event koneksi.
let { handler, participantsUpdate, groupsUpdate, deleteUpdate } = await import('./handler.js')
let isInit = false

global.reloadHandler = async function reloadHandler(restartSocket = false) {
  try {
    const loaded = await import(`./handler.js?update=${Date.now()}`).catch(error => {
      console.error(chalk.red('Gagal memuat ulang handler:'), error)
      return null
    })
    if (loaded?.handler) {
      handler = loaded.handler
      participantsUpdate = loaded.participantsUpdate
      groupsUpdate = loaded.groupsUpdate
      deleteUpdate = loaded.deleteUpdate
    }
  } catch (error) {
    console.error(error)
  }

  if (restartSocket) {
    const oldChats = global.conn?.chats || {}
    const oldConn = global.conn
    // Lepas listener terlebih dahulu supaya event close dari socket lama tidak memicu reconnect ganda.
    try { oldConn?.ev?.removeAllListeners() } catch { /* socket sudah berhenti */ }
    try { oldConn?.ws?.close() } catch {
      try { oldConn?.end?.() } catch { /* socket sudah berhenti */ }
    }

    conn = global.conn = makeWASocket(connectionOptions, { chats: oldChats })
    if (typeof storeBind === 'function') storeBind(conn)
    conn.findUserId = async (lid) => {
      try {
        if (!lid || typeof lid !== 'string' || !lid.endsWith('@lid')) return null
        const mapping = conn.signalRepository?.lidMapping
        if (mapping && typeof mapping.getPhoneNumber === 'function') {
          const phone = await mapping.getPhoneNumber(lid)
          if (phone) {
            const value = String(phone)
            return { phoneNumber: value.includes('@') ? value : `${value}@s.whatsapp.net` }
          }
        }
      } catch { /* ignore unresolved LID */ }
      return null
    }
    isInit = true
  }

  if (!isInit) {
    if (conn.handler) conn.ev.off('messages.upsert', conn.handler)
    if (conn.participantsUpdate) conn.ev.off('group-participants.update', conn.participantsUpdate)
    if (conn.groupsUpdate) conn.ev.off('groups.update', conn.groupsUpdate)
    if (conn.onDelete) conn.ev.off('message.delete', conn.onDelete)
    if (conn.connectionUpdate) conn.ev.off('connection.update', conn.connectionUpdate)
    if (conn.credsUpdate) conn.ev.off('creds.update', conn.credsUpdate)
  }

  conn.welcome = 'Hai @user!\nSelamat datang di grup @subject\n\n@desc'
  conn.bye = 'Selamat tinggal @user 👋'
  conn.spromote = '@user sekarang menjadi admin ✨'
  conn.sdemote = '@user tidak lagi menjadi admin ❌'
  conn.sDesc = 'Deskripsi grup diubah menjadi:\n@desc'
  conn.sSubject = 'Nama grup diubah menjadi:\n@subject'
  conn.sIcon = 'Ikon grup telah diubah!'
  conn.sRevoke = 'Link grup diubah menjadi:\n@revoke'
  conn.sAnnounceOn = 'Grup ditutup, hanya admin yang bisa mengirim pesan.'
  conn.sAnnounceOff = 'Grup dibuka, semua peserta bisa mengirim pesan.'
  conn.sRestrictOn = 'Edit info grup: hanya admin.'
  conn.sRestrictOff = 'Edit info grup: semua peserta.'

  // Baileys can batch multiple messages in one upsert. Process each item separately;
  // otherwise a trailing system update without sender/chat can hide a real command.
  conn.handler = async function handleMessageBatch(update) {
    const messages = Array.isArray(update?.messages) ? update.messages : []
    for (const message of messages) {
      if (!message) continue
      // Temporary, narrow diagnostics for live text messages to determine whether
      // .menu reaches Baileys before command parsing.
      if (update?.type === 'notify' && message.message) {
        const content = message.message
        const text = content.conversation ||
          content.extendedTextMessage?.text ||
          content.imageMessage?.caption ||
          content.videoMessage?.caption ||
          content.documentMessage?.caption ||
          content.buttonsResponseMessage?.selectedButtonId ||
          content.listResponseMessage?.singleSelectReply?.selectedRowId ||
          ''
        if (typeof text === 'string' && /^\s*[.!/](menu|help)(?:\s|$)/i.test(text)) {
          console.log('[DIAG menu-upsert]', JSON.stringify({
            type: update.type,
            chat: message.key?.remoteJid || null,
            participant: message.key?.participant || null,
            fromMe: Boolean(message.key?.fromMe),
            text
          }))
        }
      }
      await handler.call(conn, { ...update, messages: [message] })
    }
  }
  conn.participantsUpdate = (participantsUpdate || (() => {})).bind(conn)
  conn.groupsUpdate = (groupsUpdate || (() => {})).bind(conn)
  conn.onDelete = (deleteUpdate || (() => {})).bind(conn)
  conn.connectionUpdate = connectionUpdate.bind(conn)
  conn.credsUpdate = saveCreds.bind(conn)

  conn.ev.on('messages.upsert', conn.handler)
  conn.ev.on('group-participants.update', conn.participantsUpdate)
  conn.ev.on('groups.update', conn.groupsUpdate)
  conn.ev.on('message.delete', conn.onDelete)
  conn.ev.on('connection.update', conn.connectionUpdate)
  conn.ev.on('creds.update', conn.credsUpdate)
  isInit = false
  return true
}

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin, qr } = update
  if (isNewLogin) conn.isInit = true

  // Render QR explicitly; some Baileys forks no longer honor printQRInTerminal.
  if (qr) {
    try {
      console.log(chalk.cyan('\n📱 Pindai QR ini melalui WhatsApp > Perangkat tertaut > Tautkan perangkat:'))
      console.log(await QRCode.toString(qr, { type: 'terminal', small: true }))
    } catch (error) {
      console.error(chalk.red('Gagal menampilkan QR WhatsApp:'), error?.message || error)
    }
  }

  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode
      || lastDisconnect?.error?.statusCode
      || 0

    if (statusCode === DisconnectReason?.badSession) {
      console.error(chalk.red('❌ Sesi rusak. Hapus folder sessions/ lalu lakukan pairing ulang.'))
      process.exit(1)
    } else if (statusCode === DisconnectReason?.connectionReplaced) {
      console.error(chalk.red('❌ Sesi sedang dipakai koneksi lain. Tutup sesi ganda terlebih dahulu.'))
      process.exit(1)
    } else if (statusCode === DisconnectReason?.loggedOut) {
      console.error(chalk.red('❌ WhatsApp logout. Hapus folder sessions/ lalu lakukan pairing ulang.'))
      process.exit(1)
    } else {
      console.log(chalk.yellow(`⚠️ Koneksi terputus (${statusCode}). Menyambung ulang...`))
      await global.reloadHandler(true).catch(console.error)
    }
  } else if (connection === 'open') {
    const { jid, name } = conn.user || {}
    console.log(chalk.greenBright('✅ Bot terhubung:'), chalk.white(name || '-'), chalk.gray(`(${jid || '-'})`))
  }
}

// Loader plugin rekursif.
const pluginFolder = join(__dirname, 'plugins')
const pluginFilter = filename => /\.js$/i.test(filename)
global.plugins = {}

async function filesInit(folder = pluginFolder) {
  if (!existsSync(folder)) {
    console.warn(chalk.yellow(`Folder plugin tidak ditemukan: ${folder}`))
    return
  }
  for (const filename of readdirSync(folder)) {
    const filepath = join(folder, filename)
    let stats
    try { stats = statSync(filepath) } catch { continue }
    if (stats.isDirectory()) {
      await filesInit(filepath)
      continue
    }
    if (!pluginFilter(filename)) continue

    const key = relative(pluginFolder, filepath).split(sep).join('/')
    try {
      const module = await import(pathToFileURL(filepath).href)
      global.plugins[key] = module.default || module
    } catch (error) {
      console.error(chalk.red(`Gagal memuat plugin '${key}':`), format(error))
      delete global.plugins[key]
    }
  }
}

global.reload = async (_event, filename) => {
  if (!filename) return
  const key = String(filename).split(sep).join('/')
  if (!pluginFilter(key)) return
  const filepath = join(pluginFolder, key)
  const exists = existsSync(filepath)

  if (key in global.plugins) {
    if (exists) console.log(chalk.cyan(`♻️ Plugin diperbarui: ${key}`))
    else {
      console.log(chalk.yellow(`🗑️ Plugin dihapus: ${key}`))
      delete global.plugins[key]
      return
    }
  } else {
    if (!exists) return
    console.log(chalk.green(`➕ Plugin baru: ${key}`))
  }

  let source
  try { source = readFileSync(filepath, 'utf8') } catch (error) {
    console.error(chalk.red(`Tidak dapat membaca plugin '${key}':`), error)
    return
  }

  const error = syntaxerror(source, key, { sourceType: 'module' })
  if (error) {
    console.error(chalk.red(`Syntax error '${key}':\n${format(error)}`))
    return
  }
  try {
    const module = await import(pathToFileURL(filepath).href + '?update=' + Date.now())
    global.plugins[key] = module.default || module
  } catch (importError) {
    console.error(chalk.red(`Error plugin '${key}':\n${format(importError)}`))
  } finally {
    global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b)))
  }
}

const pluginWatchers = new Map()
function watchPlugins(folder = pluginFolder) {
  if (!existsSync(folder) || pluginWatchers.has(folder)) return
  try {
    const watcher = watch(folder, (_event, filename) => {
      if (!filename) return
      const filepath = join(folder, String(filename))
      const key = relative(pluginFolder, filepath).split(sep).join('/')
      global.reload(_event, key).catch(console.error)
      // File watcher tidak selalu mengawasi subfolder baru; sinkronkan watcher setelah perubahan.
      let changedDir = dirname(filepath)
      try { if (existsSync(filepath) && statSync(filepath).isDirectory()) changedDir = filepath } catch { /* file dihapus saat event diproses */ }
      if (changedDir.startsWith(pluginFolder)) watchPlugins(changedDir)
    })
    pluginWatchers.set(folder, watcher)
  } catch (error) {
    console.error(chalk.yellow(`Tidak dapat memantau folder plugin ${folder}:`), error?.message || error)
    return
  }
  for (const filename of readdirSync(folder)) {
    const filepath = join(folder, filename)
    try {
      if (statSync(filepath).isDirectory()) watchPlugins(filepath)
    } catch { /* file mungkin dihapus saat proses berjalan */ }
  }
}

// Pasang handler seawal mungkin agar event koneksi tidak terlewat ketika plugin sedang dimuat.
await global.reloadHandler()
await filesInit()
console.log(chalk.green(`✔ ${Object.keys(global.plugins).length} plugin dimuat`))
watchPlugins()

// HTTP health-check opsional untuk hosting.
if (opts.server || process.env.PORT) {
  try {
    const { default: connect } = await import('./server.js')
    connect(Number(process.env.PORT || 3000))
  } catch (error) {
    console.error(chalk.red('Gagal menjalankan server.js:'), format(error))
  }
}
