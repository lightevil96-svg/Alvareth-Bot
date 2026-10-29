import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { setTimeout as delay } from 'timers/promises'

const DATA_DIR = process.env.ALVARETH_DATA_DIR
  ? resolve(process.env.ALVARETH_DATA_DIR)
  : join(homedir(), '.alvareth-bot-data')
const FEATURE_DIR = join(DATA_DIR, 'ragebait')
const MEMORY_DIR = join(FEATURE_DIR, 'memory')
const CONFIG_PATH = join(FEATURE_DIR, 'config.json')
const MAX_CONTEXT_MESSAGES = 24
const MAX_MESSAGE_CHARS = 2500
const MIN_REPLY_INTERVAL_MS = 5000
const MAX_REPLIES_PER_HOUR = 20
const lastReplyAt = new Map()
const hourlyCounts = new Map()
const inFlight = new Set()

mkdirSync(MEMORY_DIR, { recursive: true })

function readConfig() {
  try {
    const value = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return {
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
      enabled: value.enabled === true,
      targets: Array.isArray(value.targets) ? value.targets : [],
      optedIn: Array.isArray(value.optedIn) ? value.optedIn : []
    }
  } catch {
    return { apiKey: '', enabled: false, targets: [], optedIn: [] }
  }
}

function writeConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  try { chmodSync(CONFIG_PATH, 0o600) } catch {}
}

function normalizeNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '')
}

function jidNumber(jid) {
  return normalizeNumber(String(jid || '').split('@')[0].split(':')[0])
}

function memoryPath(jid) {
  const safe = jidNumber(jid)
  return join(MEMORY_DIR, safe + '.jsonl')
}

function readRecentMemory(jid) {
  const path = memoryPath(jid)
  if (!existsSync(path)) return []
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-MAX_CONTEXT_MESSAGES).flatMap(line => {
      try {
        const item = JSON.parse(line)
        if (!['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') return []
        return [{ role: item.role, content: item.content.slice(0, MAX_MESSAGE_CHARS) }]
      } catch { return [] }
    })
  } catch (error) {
    console.error('[ragebait] Gagal membaca memori:', error?.message || error)
    return []
  }
}

function saveMemory(jid, role, content) {
  appendFileSync(memoryPath(jid), JSON.stringify({
    at: new Date().toISOString(),
    role,
    content: String(content || '').slice(0, MAX_MESSAGE_CHARS)
  }) + '\n', { mode: 0o600 })
}

async function groqChat(apiKey, messages) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.85,
        max_tokens: 350
      }),
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = data?.error?.message || ('HTTP ' + response.status)
      throw new Error('Groq API: ' + String(message).slice(0, 180))
    }
    const result = data?.choices?.[0]?.message?.content?.trim()
    if (!result) throw new Error('Groq tidak mengembalikan jawaban.')
    return result.slice(0, 1800)
  } finally {
    clearTimeout(timer)
  }
}

function getText(m) {
  if (typeof m.text === 'string' && m.text.trim()) return m.text.trim()
  const content = m.message || {}
  return String(
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  ).trim()
}

const handler = async (m, { text = '', isROwner, conn }) => {
  const args = String(text).trim()
  const [subcommand = 'help', ...rest] = args.split(/\s+/)
  const value = rest.join(' ').trim()
  const config = readConfig()

  if (subcommand.toLowerCase() === 'join') {
    if (m.isGroup) return m.reply('Persetujuan hanya bisa dilakukan lewat chat pribadi dengan bot.')
    const number = jidNumber(m.sender)
    if (!number) return m.reply('Nomor tidak dapat dibaca.')
    if (config.targets.length && !config.targets.includes(number)) {
      return m.reply('Nomor ini belum dipilih owner untuk sesi AI Banter.')
    }
    if (!config.optedIn.includes(number)) config.optedIn.push(number)
    writeConfig(config)
    return m.reply('✅ Kamu menyetujui sesi AI Banter. AI akan membalas dengan gaya bercanda/sarkastik ringan dan menyimpan konteks chat untuk menjaga alur. Ketik .ragebait leave kapan saja untuk berhenti.')
  }

  if (subcommand.toLowerCase() === 'leave') {
    const number = jidNumber(m.sender)
    config.optedIn = config.optedIn.filter(item => item !== number)
    writeConfig(config)
    return m.reply('Sesi AI Banter dinonaktifkan untuk nomor ini. Riwayat yang sudah tersimpan tidak otomatis dihapus; gunakan .ragebait forget untuk menghapus memori chat ini.')
  }

  if (subcommand.toLowerCase() === 'forget') {
    if (m.isGroup) return m.reply('Perintah ini hanya bisa dipakai lewat chat pribadi.')
    const path = memoryPath(m.sender)
    try {
      if (existsSync(path)) writeFileSync(path, '', { mode: 0o600 })
      return m.reply('🧹 Memori percakapan untuk chat ini sudah dikosongkan.')
    } catch (error) {
      return m.reply('Gagal menghapus memori: ' + (error?.message || error))
    }
  }

  if (!isROwner) return m.reply('Perintah konfigurasi ini khusus owner.')

  if (subcommand.toLowerCase() === 'apikey') {
    if (!value) return m.reply('Format: .ragebait apikey gsk_xxx\nKirim key hanya di chat pribadi dengan bot. Setelah tersimpan, hapus pesan yang berisi key dari riwayat chat.')
    if (!/^gsk_[A-Za-z0-9_-]{20,}$/.test(value)) return m.reply('Format API key tidak dikenali. Periksa key Groq kamu.')
    config.apiKey = value
    writeConfig(config)
    return m.reply('✅ API key Groq tersimpan di file privat konfigurasi fitur. Bot tidak akan menampilkan key kembali.')
  }

  if (subcommand.toLowerCase() === 'target') {
    const number = normalizeNumber(value)
    if (number.length < 8 || number.length > 15) return m.reply('Format: .ragebait target 628123456789')
    if (!config.targets.includes(number)) config.targets.push(number)
    writeConfig(config)
    return m.reply('Target dicatat. Nomor tersebut tetap harus menyetujui sesi sendiri dengan mengirim .ragebait join ke bot sebelum AI membalas.')
  }

  if (subcommand.toLowerCase() === 'untarget') {
    const number = normalizeNumber(value)
    config.targets = config.targets.filter(item => item !== number)
    config.optedIn = config.optedIn.filter(item => item !== number)
    writeConfig(config)
    return m.reply('Target dihapus dan sesi AI dinonaktifkan untuk nomor tersebut.')
  }

  if (subcommand.toLowerCase() === 'on') {
    if (!config.apiKey) return m.reply('API key belum diatur. Kirim .ragebait apikey gsk_xxx di chat pribadi.')
    config.enabled = true
    writeConfig(config)
    return m.reply('✅ AI Banter aktif. Hanya kontak yang sudah ditargetkan dan menyetujui sesi yang akan menerima balasan otomatis.')
  }

  if (subcommand.toLowerCase() === 'off') {
    config.enabled = false
    writeConfig(config)
    return m.reply('⏸️ AI Banter dinonaktifkan.')
  }

  if (subcommand.toLowerCase() === 'status') {
    return m.reply([
      '*AI Banter — Status*',
      'Fitur: ' + (config.enabled ? 'Aktif' : 'Nonaktif'),
      'API key: ' + (config.apiKey ? 'Tersimpan' : 'Belum diatur'),
      'Target: ' + config.targets.length,
      'Persetujuan aktif: ' + config.optedIn.length,
      'Memori: ' + MEMORY_DIR,
      '',
      'Perintah:',
      '.ragebait apikey gsk_xxx',
      '.ragebait target 628xxxxxxxxxx',
      '.ragebait untarget 628xxxxxxxxxx',
      '.ragebait on / off',
      '.ragebait join (kontak yang menyetujui)',
      '.ragebait leave',
      '.ragebait forget (hapus memori chat sendiri)'
    ].join('\n'))
  }

  return m.reply([
    '*AI Banter / Ragebait (bercanda)*',
    '.ragebait apikey gsk_xxx — simpan API key Groq (owner)',
    '.ragebait target 628xxxxxxxxxx — pilih target (owner)',
    '.ragebait untarget 628xxxxxxxxxx — hapus target (owner)',
    '.ragebait on — aktifkan',
    '.ragebait off — matikan',
    '.ragebait status — status fitur',
    '.ragebait join — setujui sesi (dari nomor sendiri)',
    '.ragebait leave — berhenti ikut',
    '.ragebait forget — hapus memori chat sendiri'
  ].join('\n'))
}

handler.before = async function (m, { conn }) {
  try {
    if (!m || m.fromMe || m.isGroup || !m.sender || !m.chat) return false
    const text = getText(m)
    if (!text || text.startsWith('.') || text.startsWith('!') || text.startsWith('/')) return false
    if (m.chat !== m.sender && jidNumber(m.chat) !== jidNumber(m.sender)) return false

    const config = readConfig()
    const number = jidNumber(m.sender)
    if (!config.enabled || !config.apiKey || !config.targets.includes(number) || !config.optedIn.includes(number)) return false
    if (inFlight.has(number)) return true

    const now = Date.now()
    const previous = lastReplyAt.get(number) || 0
    if (now - previous < MIN_REPLY_INTERVAL_MS) return true
    const hour = Math.floor(now / 3600000)
    const countState = hourlyCounts.get(number)
    const count = countState?.hour === hour ? countState.count : 0
    if (count >= MAX_REPLIES_PER_HOUR) return true

    inFlight.add(number)
    lastReplyAt.set(number, now)
    hourlyCounts.set(number, { hour, count: count + 1 })

    try {
      const recent = readRecentMemory(m.sender)
      saveMemory(m.sender, 'user', text)
      const messages = [
        {
          role: 'system',
          content: 'Kamu adalah AI Banter milik Alvareth Bot. Lawan bicara telah menyetujui sesi AI ini dan tahu bahwa ia sedang berbicara dengan AI. Balas dalam bahasa yang sama dengan lawan bicara, natural, singkat (1-4 kalimat), jenaka, sedikit sarkastik, dan boleh berdebat secara playful. Jangan mengaku sebagai manusia. Jangan gunakan ancaman, hinaan berdasarkan identitas, doxing, pemerasan, dorongan menyakiti diri, atau mengeksploitasi trauma/rahasia pribadi untuk memancing emosi. Jika lawan bicara meminta berhenti, akhiri dengan sopan dan jangan membalas lagi.'
        },
        ...recent,
        { role: 'user', content: text.slice(0, MAX_MESSAGE_CHARS) }
      ]
      const reply = await groqChat(config.apiKey, messages)
      saveMemory(m.sender, 'assistant', reply)
      await conn.sendMessage(m.chat, { text: reply }, { quoted: m })
    } catch (error) {
      console.error('[ragebait] Auto-reply gagal:', error?.message || error)
      if (/401|invalid api key|unauthorized/i.test(String(error?.message || error))) {
        await conn.sendMessage(m.chat, { text: '⚠️ API key Groq ditolak. Minta owner memperbarui dengan .ragebait apikey gsk_xxx' }, { quoted: m }).catch(() => {})
      }
    } finally {
      inFlight.delete(number)
    }
    return true
  } catch (error) {
    console.error('[ragebait] Plugin error:', error?.stack || error)
    return false
  }
}

handler.help = ['ragebait']
handler.tags = ['owner']
handler.command = /^ragebait$/i
export default handler
