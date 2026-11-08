// ═══════════════════════════════════════════════════════════════
// ALVARETH BOT — main.js
// Pairing code/QR login, auto-reconnect, recursive plugin loader, lowdb
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config'
import './lib/whatsapp-temp-bootstrap.js'
import './config.js'

import { join, dirname, relative, sep, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { readdirSync, readFileSync, existsSync, statSync, lstatSync, watch, copyFileSync, cpSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
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
import { createPairingCodeRequester, normalizePairingPhoneNumber } from './lib/whatsapp-pairing.js'
import { getWhatsAppWebSocketState, isWhatsAppRestartRequired, isWhatsAppSocketOpen } from './lib/whatsapp-connection.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Keep user data outside the Git checkout so code updates cannot replace it.
const RUNTIME_DATA_DIR = process.env.ALVARETH_DATA_DIR
  ? resolve(process.env.ALVARETH_DATA_DIR)
  : join(homedir(), '.alvareth-bot-data')
mkdirSync(RUNTIME_DATA_DIR, { recursive: true })

const LEGACY_DATABASE_PATH = join(__dirname, 'database.json')
const DATABASE_PATH = join(RUNTIME_DATA_DIR, 'database.json')
// Expose the exact active path for the owner-only .cekdata diagnostic.
global.__ALVARETH_DATABASE_PATH = DATABASE_PATH
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

// Merge legacy records on every startup, not just the first one. This recovers
// registrations if the old database.json was restored/uploaded after the marker
// had already been created. Existing persistent values always take priority,
// and the legacy file is never deleted or modified.
if (existsSync(LEGACY_DATABASE_PATH)) {
  try {
    const legacyData = JSON.parse(readFileSync(LEGACY_DATABASE_PATH, 'utf8'))
    let persistentData = {}
    let persistentRaw = ''
    if (existsSync(DATABASE_PATH)) {
      persistentRaw = readFileSync(DATABASE_PATH, 'utf8')
      try {
        persistentData = JSON.parse(persistentRaw)
      } catch (error) {
        throw new Error(`database persisten tidak valid; file asli dipertahankan (${error.message})`)
      }
    }

    const merged = mergeMissing(persistentData, legacyData)
    const mergedRaw = JSON.stringify(merged, null, 2)
    if (mergedRaw !== (persistentRaw ? JSON.stringify(JSON.parse(persistentRaw), null, 2) : '')) {
      if (existsSync(DATABASE_PATH)) {
        mkdirSync(DATABASE_BACKUP_DIR, { recursive: true })
        copyFileSync(DATABASE_PATH, join(DATABASE_BACKUP_DIR, `database-before-legacy-merge-${Date.now()}.json`))
      }
      writeFileSync(DATABASE_PATH, mergedRaw)
      console.log('[DATA MIGRATION] Data lama digabung; data persisten yang sudah ada diprioritaskan.')
    } else {
      console.log('[DATA MIGRATION] Tidak ada data lama tambahan untuk digabung.')
    }
    if (!existsSync(DATABASE_MIGRATION_MARKER)) {
      writeFileSync(DATABASE_MIGRATION_MARKER, new Date().toISOString())
    }
  } catch (error) {
    console.error('[DATA MIGRATION] Gagal menggabungkan database lama; kedua file dipertahankan:', error.message)
  }
} else if (!existsSync(DATABASE_PATH)) {
  console.log('[DATA] Database belum ditemukan. Registrasi baru akan disimpan ke direktori data persisten.')
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
console.log('[DATABASE DIAGNOSTIC] Startup selesai:', JSON.stringify({
  path: DATABASE_PATH,
  exists: existsSync(DATABASE_PATH),
  usersLoaded: Object.keys(global.db?.data?.users || {}).length,
  registeredLoaded: Object.values(global.db?.data?.users || {}).filter(user => user?.registered === true).length,
  readError: global.db?.READ === true
}))

// Session & socket.
let { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)

// A registered session without creds.me.id cannot authenticate. Preserve the
// inconsistent directory as a backup, then create a clean session for pairing.
if (state.creds?.registered === true && !state.creds?.me?.id) {
  const sessionInfo = existsSync(SESSION_DIR) ? lstatSync(SESSION_DIR) : null
  if (!sessionInfo?.isDirectory() || sessionInfo.isSymbolicLink()) {
    console.error(chalk.red('❌ Sesi WhatsApp terdaftar tidak memiliki identitas akun, tetapi WA_SESSION_DIR bukan folder biasa. File sesi tidak diubah; periksa konfigurasi WA_SESSION_DIR.'))
    process.exit(1)
  }

  const backupSessionDir = SESSION_DIR + '.invalid-' + Date.now()
  try {
    renameSync(SESSION_DIR, backupSessionDir)
    mkdirSync(SESSION_DIR, { recursive: true })
    ;({ state, saveCreds } = await useMultiFileAuthState(SESSION_DIR))
    console.warn(chalk.yellow('⚠️ Sesi WhatsApp lama tidak konsisten (registered=true, me.id kosong). Folder lama dipertahankan sebagai backup: ' + backupSessionDir))
    console.log(chalk.cyan('🔐 Sesi baru disiapkan. Bot akan meminta pairing code; tautkan ulang akun melalui WhatsApp > Perangkat tertaut.'))
  } catch (error) {
    console.error(chalk.red('❌ Gagal menyiapkan sesi WhatsApp baru. Sesi lama tidak dihapus; periksa izin folder:'), error?.stack || error)
    process.exit(1)
  }
}
const configuredLoginMethod = String(process.env.WA_LOGIN_METHOD || 'pairing').trim().toLowerCase()
const loginMethod = ['pairing', 'qr'].includes(configuredLoginMethod) ? configuredLoginMethod : 'pairing'
if (loginMethod !== configuredLoginMethod) {
  console.warn(chalk.yellow(`WA_LOGIN_METHOD tidak dikenal ("${configuredLoginMethod}"); memakai pairing.`))
}
const pairingPhoneNumber = normalizePairingPhoneNumber(global.pairing)
const requestPairingCodeForSocket = createPairingCodeRequester({
  phoneNumber: pairingPhoneNumber,
  delayMs: 1500
})

async function requestPairingCodeWhileConnecting(activeSocket) {
  if (loginMethod !== 'pairing' || activeSocket?.authState?.creds?.registered) return null

  const result = await requestPairingCodeForSocket(
    activeSocket,
    socket => global.conn === socket
  )

  if (result?.status === 'generated') {
    clearReconnectHandshakeTimer()
    console.log(chalk.greenBright('\n🔐 PAIRING CODE WHATSAPP'))
    console.log(chalk.bold.bgGreen.black(` ${result.code} `))
    console.log(chalk.gray('WhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon.'))
    console.log(chalk.yellow('Kode bersifat sementara. Jangan bagikan kepada siapa pun.'))
  } else if (result?.status === 'invalid-phone') {
    console.error(chalk.red('❌ BOT_NUMBER tidak valid. Isi nomor WhatsApp dengan kode negara, angka internasional saja (contoh: 62812xxxxxxxx).'))
  } else if (result?.status === 'unsupported') {
    console.error(chalk.red('❌ Library Baileys tidak menyediakan requestPairingCode(); login QR akan digunakan sebagai fallback.'))
  } else if (result?.status === 'failed') {
    console.error(chalk.red('❌ Gagal meminta pairing code:'), String(result.error?.message || result.error || 'unknown error').slice(0, 200))
  }

  return result
}

const { version, isLatest } = await fetchLatestWaWebVersion()
console.log(chalk.cyan(`WA Web version: v${version.join('.')} (latest: ${isLatest})`))

if (loginMethod === 'pairing') {
  console.log(chalk.cyan('🔐 Mode login pairing code aktif. Kode tampil di Console saat sesi belum terdaftar.'))
} else {
  console.log(chalk.cyan('📷 Mode login QR aktif. Pindai QR dari WhatsApp > Perangkat Tertaut.'))
}

// conn sengaja memakai let karena socket diganti ketika reconnect.
let conn
const silentLogger = pino({ level: 'silent' })
const groupMetadataInFlight = new Map()
const groupMetadataRetryAfter = new Map()

function isWhatsAppRateLimit(error) {
  return /rate-overlimit|rate[ -]over[ -]limit|too many requests|429/i.test(
    String(error?.message || error || '')
  )
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getCachedGroupMetadata(jid) {
  const cached = conn?.chats?.[jid]?.metadata
  if (cached && Array.isArray(cached.participants)) return cached

  const pending = groupMetadataInFlight.get(jid)
  if (pending) return pending

  const request = (async () => {
    const retryAfter = groupMetadataRetryAfter.get(jid) || 0
    if (retryAfter > Date.now()) await sleep(retryAfter - Date.now())

    const activeConn = conn
    try {
      const metadata = await activeConn.groupMetadata(jid)
      if (metadata && Array.isArray(metadata.participants)) {
        const chats = activeConn.chats || (activeConn.chats = {})
        chats[jid] = {
          ...(chats[jid] || {}),
          id: jid,
          subject: metadata.subject || chats[jid]?.subject || '',
          metadata,
          isChats: true
        }
      }
      groupMetadataRetryAfter.delete(jid)
      return metadata
    } catch (error) {
      // Do not immediately issue a second groupMetadata IQ for every outgoing
      // message after WhatsApp returns rate-overlimit.
      if (isWhatsAppRateLimit(error)) {
        groupMetadataRetryAfter.set(jid, Date.now() + 5000)
      }
      throw error
    }
  })()

  groupMetadataInFlight.set(jid, request)
  try {
    return await request
  } finally {
    if (groupMetadataInFlight.get(jid) === request) groupMetadataInFlight.delete(jid)
  }
}

const connectionOptions = {
  version,
  logger: silentLogger,
  printQRInTerminal: false,
  auth: { ...state, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
  browser: ['Mac OS', 'Chrome', '14.4.1'],
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
  cachedGroupMetadata: getCachedGroupMetadata
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

// Handler utama dan event koneksi.
let { handler, participantsUpdate, groupsUpdate, deleteUpdate } = await import('./handler.js')

// Baileys may surface the same message more than once through messages.upsert
// (e.g. duplicate notify events during reconnect/sync). Claim each stable message
// ID before invoking plugins so one incoming message can only trigger one reply.
const RECENT_MESSAGE_TTL_MS = 2 * 60 * 1000
const MAX_RECENT_MESSAGE_IDS = 10000
const recentMessageIds = new Map()

function claimMessageOnce(message) {
  const key = message?.key
  const messageId = typeof key?.id === 'string' ? key.id : ''
  const chatId = typeof key?.remoteJid === 'string'
    ? key.remoteJid
    : (typeof key?.remoteJidAlt === 'string' ? key.remoteJidAlt : '')
  if (!messageId || !chatId) return true

  const now = Date.now()
  // Entries are inserted in chronological order, so only oldest entries need
  // to be checked until the first still-live ID is reached.
  while (recentMessageIds.size) {
    const oldestKey = recentMessageIds.keys().next().value
    const expiry = recentMessageIds.get(oldestKey)
    if (expiry > now) break
    recentMessageIds.delete(oldestKey)
  }

  const fingerprint = chatId + '\\0' + messageId
  if (recentMessageIds.has(fingerprint)) return false

  recentMessageIds.set(fingerprint, now + RECENT_MESSAGE_TTL_MS)
  while (recentMessageIds.size > MAX_RECENT_MESSAGE_IDS) {
    const oldestKey = recentMessageIds.keys().next().value
    if (oldestKey === undefined) break
    recentMessageIds.delete(oldestKey)
  }
  return true
}

let isInit = false
let reconnectTimer = null
let reconnectHandshakeTimer = null
let reconnectAttempts = 0
let reconnectInProgress = false
let reconnectQueued = null
let authRepairWarningShown = false

function clearReconnectHandshakeTimer() {
  if (!reconnectHandshakeTimer) return
  clearTimeout(reconnectHandshakeTimer)
  reconnectHandshakeTimer = null
}

function scheduleSocketReconnect(statusCode, reason = '') {
  if (reconnectTimer) return
  if (reconnectInProgress) {
    reconnectQueued = { statusCode, reason }
    return
  }

  clearReconnectHandshakeTimer()

  // A 405 is usually a rejected WhatsApp companion handshake, not a damaged
  // auth folder. Back off between attempts so we never hammer WhatsApp in a loop.
  const baseDelay = isWhatsAppRestartRequired(statusCode)
    ? 1000
    : statusCode === 405 ? 8000 : 3000
  const exponent = Math.min(reconnectAttempts, 4)
  const delay = Math.min(60000, baseDelay * (2 ** exponent))
  reconnectAttempts += 1

  const delaySeconds = Math.ceil(delay / 1000)
  console.log(chalk.yellow(
    `⏳ Reconnect dijadwalkan ${delaySeconds} detik lagi (percobaan ${reconnectAttempts}).` +
    (reason ? ' Detail: ' + String(reason).slice(0, 160) : '')
  ))

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    reconnectInProgress = true
    try {
      await global.reloadHandler(true)
    } catch (error) {
      console.error(chalk.red('Gagal membuat ulang socket WhatsApp:'), error?.stack || error)
    } finally {
      reconnectInProgress = false
      if (reconnectQueued) {
        const queued = reconnectQueued
        reconnectQueued = null
        queueMicrotask(() => scheduleSocketReconnect(queued.statusCode, queued.reason))
      }
    }
  }, delay)
  reconnectTimer.unref?.()
}

// A media send can discover a closed or unauthenticated socket before
// connection.update reports the disconnect. Reuse the coordinated reconnect path.
global.requestWhatsAppReconnect = function requestWhatsAppReconnect(reason = '') {
  const currentSocket = global.conn
  const currentCreds = currentSocket?.authState?.creds || state.creds || {}

  // Do not invalidate a companion-pairing attempt while the owner is entering
  // the code. Also stop futile reconnects for a registered session with no ID.
  if (currentCreds.registered !== true && currentCreds.pairingCode) {
    clearReconnectHandshakeTimer()
    return true
  }
  if (currentCreds.registered === true && !currentCreds.me?.id) {
    clearReconnectHandshakeTimer()
    if (!authRepairWarningShown) {
      authRepairWarningShown = true
      console.error(chalk.red('❌ Kredensial WhatsApp terdaftar tidak memiliki creds.me.id. Reconnect tidak akan memperbaiki sesi ini; folder sesi perlu dipulihkan dari backup atau dipasangkan ulang.'))
    }
    return true
  }

  if (isWhatsAppSocketOpen(currentSocket)) {
    clearReconnectHandshakeTimer()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectQueued = null
    reconnectAttempts = 0
    return false
  }

  if (reconnectTimer || reconnectInProgress || reconnectQueued) return true

  const transportState = getWhatsAppWebSocketState(currentSocket)
  if (transportState === 'connecting' || transportState === 'open') {
    // A WebSocket can be open before Baileys has attached the authenticated account.
    // Give the handshake 30 seconds, then replace a socket that never becomes ready.
    if (!reconnectHandshakeTimer) {
      const observedSocket = currentSocket
      console.warn(chalk.yellow(
        `⏳ Socket WhatsApp belum siap (transport=${transportState}, identitas=${currentSocket?.user?.id ? 'ada' : 'belum ada'}). Menunggu handshake 30 detik.`
      ))
      reconnectHandshakeTimer = setTimeout(() => {
        reconnectHandshakeTimer = null
        const activeSocket = global.conn
        if (isWhatsAppSocketOpen(activeSocket)) {
          reconnectAttempts = 0
          reconnectQueued = null
          return
        }
        scheduleSocketReconnect(
          428,
          (reason || 'Socket WhatsApp belum siap untuk mengirim media.') +
          ' Socket tidak terautentikasi dalam 30 detik' +
          (activeSocket !== observedSocket ? ' setelah pergantian socket.' : '.')
        )
      }, 30_000)
      reconnectHandshakeTimer.unref?.()
    }
    return true
  }

  scheduleSocketReconnect(428, reason || 'Socket WhatsApp terdeteksi tertutup saat pengiriman media.')
  return Boolean(reconnectTimer || reconnectInProgress || reconnectQueued)
}

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
    // Lepas listener agar penutupan socket lama tidak memicu reconnect ganda.
    try { oldConn?.ev?.removeAllListeners() } catch { /* socket sudah berhenti */ }
    // Baileys end() juga membersihkan keepalive, event buffer, dan signal repository.
    // ws.close() hanya menjadi fallback untuk implementasi socket yang lebih lama.
    try {
      if (typeof oldConn?.end === 'function') await oldConn.end()
      else if (typeof oldConn?.ws?.close === 'function') await oldConn.ws.close()
    } catch (error) {
      console.warn(chalk.yellow('⚠️ Pembersihan socket WhatsApp lama gagal:'), error?.message || error)
      try { await oldConn?.ws?.close?.() } catch { /* socket sudah berhenti */ }
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
      // Newsletter/channel events (including empty QuestionReply payloads) are not chat messages.
      const remoteJid = String(message.key?.remoteJid || message.key?.remoteJidAlt || '')
      if (remoteJid.endsWith('@newsletter')) continue
      if (!claimMessageOnce(message)) {
        console.warn('[MESSAGE-DEDUP] Pesan duplikat diabaikan:', {
          chat: message.key?.remoteJid || message.key?.remoteJidAlt || null,
          id: message.key?.id || null,
          type: update?.type || null
        })
        continue
      }
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
  const activeSocket = this && this.ws ? this : conn
  const { connection, lastDisconnect, isNewLogin, qr } = update
  if (isNewLogin) conn.isInit = true

  // Request pairing during the initial connecting event as well as supporting
  // QR fallback. This avoids depending on a QR event that may arrive late.
  if (connection === 'connecting' && loginMethod === 'pairing' &&
      !activeSocket?.authState?.creds?.registered) {
    await requestPairingCodeWhileConnecting(activeSocket)
  }

  // Pairing code is requested once per socket. If it cannot be issued, retain
  // QR login as a safe fallback.
  if (qr) {
    let pairingResult = null
    if (loginMethod === 'pairing' && !activeSocket?.authState?.creds?.registered) {
      pairingResult = await requestPairingCodeForSocket(
        activeSocket,
        socket => global.conn === socket
      )
    }

    const pairingStatus = pairingResult?.status === 'already-attempted'
      ? pairingResult.previous
      : pairingResult?.status

    const pairingCodeIssued = Boolean(activeSocket?.authState?.creds?.pairingCode)
    if ((pairingStatus === 'generated' || pairingStatus === 'pending') && pairingCodeIssued) {
      if (pairingResult?.status === 'generated') {
        console.log(chalk.greenBright('\n🔐 PAIRING CODE WHATSAPP'))
        console.log(chalk.bold.bgGreen.black(` ${pairingResult.code} `))
        console.log(chalk.gray('WhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon.'))
        console.log(chalk.yellow('Kode bersifat sementara. Jangan bagikan kepada siapa pun.'))
      }
    } else {
      if (loginMethod === 'pairing' && pairingResult && pairingResult.status !== 'already-attempted') {
        if (pairingResult.status === 'invalid-phone') {
          console.error(chalk.red('❌ BOT_NUMBER tidak valid. Isi nomor WhatsApp dengan kode negara, angka internasional saja (contoh: 62812xxxxxxxx).'))
        } else if (pairingResult.status === 'unsupported') {
          console.error(chalk.red('❌ Library Baileys tidak menyediakan requestPairingCode(); beralih ke login QR.'))
        } else if (pairingResult.status === 'failed') {
          console.error(chalk.red('❌ Gagal meminta pairing code:'), String(pairingResult.error?.message || pairingResult.error || 'unknown error').slice(0, 200))
        }
      }

      try {
        console.log(chalk.cyan('\n📱 Pindai QR ini melalui WhatsApp > Perangkat tertaut > Tautkan perangkat:'))
        console.log(await QRCode.toString(qr, { type: 'terminal', small: true }))
      } catch (error) {
        console.error(chalk.red('Gagal menampilkan QR WhatsApp:'), error?.message || error)
      }
    }
  }

  if (connection === 'close') {
    if (activeSocket !== global.conn) {
      console.warn(chalk.yellow('⚠️ Event disconnect dari socket WhatsApp lama diabaikan.'))
      return
    }
    clearReconnectHandshakeTimer()
    const statusCode = lastDisconnect?.error?.output?.statusCode
      || lastDisconnect?.error?.statusCode
      || 0
    const disconnectReason = lastDisconnect?.error?.data?.reason
      || lastDisconnect?.error?.output?.payload?.message
      || lastDisconnect?.error?.message
      || ''

    if (isWhatsAppRestartRequired(statusCode)) {
      reconnectAttempts = 0
      console.log(chalk.cyan('🔄 WhatsApp meminta socket baru setelah pairing/login (515). Membuat ulang koneksi dengan jeda singkat.'))
      scheduleSocketReconnect(statusCode, disconnectReason || 'restartRequired (515)')
    } else if (statusCode === DisconnectReason?.badSession) {
      console.error(chalk.red('❌ Sesi ditolak sebagai badSession (500). Hentikan bot dan pairing ulang hanya jika log memang menunjukkan sesi rusak.'))
      process.exit(1)
    } else if (statusCode === DisconnectReason?.connectionReplaced) {
      console.error(chalk.red('❌ Sesi WhatsApp dipakai koneksi lain (440). Pastikan hanya satu instance bot aktif.'))
      process.exit(1)
    } else if (statusCode === DisconnectReason?.loggedOut) {
      console.error(chalk.red('❌ WhatsApp mengeluarkan sesi (401). Hentikan bot, lalu lakukan pairing ulang.'))
      process.exit(1)
    } else {
      if (statusCode === 405) {
        console.error(chalk.red(
          '❌ WhatsApp menolak handshake (405). Ini bukan bukti sesi rusak; kode startup sekarang mem-patch UserAgent platform ke MACOS sebelum socket dibuat.'
        ))
      } else {
        console.log(chalk.yellow(`⚠️ Koneksi terputus (${statusCode}).`))
      }
      scheduleSocketReconnect(statusCode, disconnectReason)
    }
  } else if (connection === 'open') {
    if (activeSocket !== global.conn) {
      console.warn(chalk.yellow('⚠️ Event open dari socket WhatsApp lama diabaikan.'))
      return
    }
    const authCreds = activeSocket?.authState?.creds || state.creds || {}
    const hasIdentity = Boolean(activeSocket?.user?.id || authCreds.me?.id)
    const pairingPending = authCreds.registered !== true && Boolean(authCreds.pairingCode)
    if (pairingPending) {
      clearReconnectHandshakeTimer()
      console.log(chalk.yellow('⏳ WebSocket terbuka; menunggu persetujuan pairing code. Socket dipertahankan agar kode tidak terputus.'))
      return
    }
    if (!isWhatsAppSocketOpen(activeSocket)) {
      const transportState = getWhatsAppWebSocketState(activeSocket)
      console.warn(chalk.yellow(
        `⚠️ Event open diterima, tetapi socket belum siap (transport=${transportState}, registered=${authCreds.registered === true}, identitas=${hasIdentity ? 'ada' : 'belum ada'}). Menunggu watchdog handshake.`
      ))
      if (authCreds.registered === true && !hasIdentity) {
        console.error(chalk.red('❌ Sesi ditandai terdaftar tetapi creds.me.id kosong. Periksa backup sesi; pairing ulang diperlukan.'))
      }
      global.requestWhatsAppReconnect(
        `Event open diterima, tetapi socket belum siap (transport=${transportState}, registered=${authCreds.registered === true}, identitas=${hasIdentity ? 'ada' : 'belum ada'}).`
      )
      return
    }
    clearReconnectHandshakeTimer()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectQueued = null
    reconnectAttempts = 0
    const { id, name } = activeSocket.user || {}
    console.log(chalk.greenBright('✅ Bot terhubung:'), chalk.white(name || '-'), chalk.gray(`(${id || '-'})`))
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

// Reuse the protected owner updater automatically; no .update command is required.


// HTTP health-check opsional untuk hosting.
if (opts.server || process.env.PORT || process.env.SERVER_PORT) {
  try {
    const { default: connect } = await import('./server.js')
    connect(Number(process.env.PORT || process.env.SERVER_PORT || 3000))
  } catch (error) {
    console.error(chalk.red('Gagal menjalankan server.js:'), format(error))
  }
}
