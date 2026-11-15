import {
  ASISTEN_MODEL, normalizeAsistenNumber, senderAsistenNumber, isAsistenPlainText,
  isValidGroqKey, loadAsistenConfig, updateAsistenConfig, getAsistenApiKey,
  asistenIsActiveFor, askAsistenGroq
} from '../../lib/owner-assistant.js'
import { wasBotSentMessage } from '../../lib/auto-download.js'

const pending = global.__alvarethAsistenPending || (global.__alvarethAsistenPending = new Map())
const conversations = global.__alvarethAsistenConversations || (global.__alvarethAsistenConversations = new Map())
const processed = global.__alvarethAsistenProcessed || (global.__alvarethAsistenProcessed = new Map())
const busy = global.__alvarethAsistenBusy || (global.__alvarethAsistenBusy = new Set())
const PROMPT_TTL = 5 * 60 * 1000
const REPLY_COOLDOWN = 15 * 1000
const CONVERSATION_TTL = 30 * 60 * 1000
const FALLBACK = 'Halo! Saya asisten otomatis owner. Saat ini owner sedang tidak tersedia untuk membalas langsung. Kalau ada yang ingin disampaikan, silakan titip pesan di sini ya 😊'

function pendingKey(m) { return String(m.chat || '') + ':' + String(m.sender || '') }
function cleanMessageId(m) { return String(m.id || m.key?.id || '') }
function hasCommandPrefix(text) { return /^[.!/#]/.test(String(text || '').trim()) }
// Outgoing prompt echoes can arrive before sendMessage's ID tracking is registered.
// This narrow fallback only rejects the assistant's own setup instructions.
function isOwnSetupPromptEcho(m, text) {
  if (!m?.fromMe && m?.key?.fromMe !== true && m?.rawMessage?.key?.fromMe !== true) return false
  return /^(?:🔑 \*API KEY GROQ\*|🎯 \*TAMBAH TARGET\*|💤 \*OWNER SEDANG NGAPAIN\?\*)/.test(String(text || '').trim())
}
function isOwnerPrivate(m, context) {
  return context?.isROwner === true && !m.isGroup && !String(m.chat || '').endsWith('@g.us')
}
function textContent(m) {
  const raw = m.rawMessage?.message || m.message || {}
  let current = raw
  for (let i = 0; i < 6; i++) {
    const next = current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message || current?.viewOnceMessageV2?.message
    if (!next) break
    current = next
  }
  return typeof current?.conversation === 'string'
    ? current.conversation
    : typeof current?.extendedTextMessage?.text === 'string'
      ? current.extendedTextMessage.text : ''
}
async function reply(m, text) { return m.reply(text) }
function prompt(m, kind) {
  pending.set(pendingKey(m), {
    kind, trigger: cleanMessageId(m), expires: Date.now() + PROMPT_TTL
  })
}
function statusDescription(config) {
  return [
    '🤖 *ASISTEN OTOMATIS ALVARETH*',
    '',
    'Status: ' + (config.enabled ? '🟢 Aktif' : '🔴 Nonaktif'),
    'Target: ' + config.targets.length + ' kontak',
    'Owner: ' + config.ownerStatus,
    'Groq: ' + (getAsistenApiKey(config) ? '✅ Tersedia' : '❌ Belum diatur'),
    'Model: ' + ASISTEN_MODEL,
    '',
    'Pilih salah satu dari tiga tombol berikut.',
    'Perintah tambahan: .asisten on | off | target list | target hapus NOMOR | apikey status | apikey clear'
  ].join('\n')
}
async function showMenu(m, conn) {
  const config = await loadAsistenConfig()
  const intro = statusDescription(config)
  try {
    return await conn.sendMessage(m.chat, {
      text: intro,
      footer: global.namebot || 'Alvareth Bot',
      buttons: [
        { buttonId: '.asisten target', buttonText: { displayText: '🎯 Target' }, type: 1 },
        { buttonId: '.asisten status', buttonText: { displayText: '💤 Owner sedang ngapain' }, type: 1 },
        { buttonId: '.asisten apikey', buttonText: { displayText: '🔑 Apikey' }, type: 1 }
      ],
      headerType: 1
    }, { quoted: m })
  } catch {
    return reply(m, intro + '\n\n1. .asisten target\n2. .asisten status\n3. .asisten apikey')
  }
}
async function handleTarget(m, args) {
  const config = await loadAsistenConfig()
  const action = args[0] || ''
  if (action === 'list' || action === 'daftar') {
    return reply(m, config.targets.length
      ? '🎯 *TARGET ASISTEN*\n' + config.targets.map((n, i) => (i + 1) + '. ' + n).join('\n')
      : 'Belum ada target. Ketik .asisten target untuk menambah.')
  }
  if (action === 'hapus' || action === 'remove' || action === 'delete') {
    const number = normalizeAsistenNumber(args[1])
    if (!number) return reply(m, 'Contoh: .asisten target hapus 6281234567890')
    const after = await updateAsistenConfig(cfg => ({
      ...cfg, targets: cfg.targets.filter(value => value !== number)
    }))
    return reply(m, after.targets.includes(number) ? 'Gagal menghapus target.' : '✅ Target dihapus: ' + number)
  }
  const candidate = normalizeAsistenNumber(action === 'tambah' || action === 'add' ? args[1] : args[0])
  if (candidate) return addTarget(m, candidate)
  prompt(m, 'target')
  return reply(m, '🎯 *TAMBAH TARGET*\n\nKirim nomor WhatsApp target sebagai pesan teks berikutnya (contoh: 6281234567890).\nBisa juga langsung: .asisten target tambah 6281234567890\nSesi berlaku 5 menit. Batalkan dengan .asisten batal.')
}
async function addTarget(m, number) {
  let already = false
  const config = await updateAsistenConfig(cfg => {
    already = cfg.targets.includes(number)
    if (!already && cfg.targets.length >= 30) throw new Error('Maksimal 30 target')
    return { ...cfg, targets: already ? cfg.targets : [...cfg.targets, number] }
  })
  return reply(m, (already ? 'ℹ️ Target sudah terdaftar: ' : '✅ Target ditambahkan: ') + number +
    '\nTotal target: ' + config.targets.length + '\nGunakan .asisten on untuk mengaktifkan.')
}
async function handleStatus(m, text) {
  if (text) {
    if (text.length > 700) return reply(m, 'Status owner maksimal 700 karakter.')
    await updateAsistenConfig(cfg => ({ ...cfg, ownerStatus: text }))
    return reply(m, '✅ Status owner diperbarui:\n' + text)
  }
  prompt(m, 'status')
  return reply(m, '💤 *OWNER SEDANG NGAPAIN?*\n\nKirim status owner sebagai pesan teks berikutnya.\nContoh: Owner sedang off dan beristirahat. Kalau ada yang mau dibantu silakan titip pesan.\nSesi berlaku 5 menit. Batalkan dengan .asisten batal.')
}
async function handleApiKey(m, args) {
  const action = args[0] || ''
  const config = await loadAsistenConfig()
  if (action === 'status') {
    return reply(m, '🔑 Groq API key: ' + (getAsistenApiKey(config) ? 'sudah tersedia' : 'belum tersedia') +
      '\nSumber: ' + (config.groqApiKey ? 'file privat server' : getAsistenApiKey(config) ? 'environment' : 'tidak ada') +
      '\nNilai key tidak akan ditampilkan.')
  }
  if (['clear', 'hapus', 'delete'].includes(action)) {
    await updateAsistenConfig(cfg => ({ ...cfg, groqApiKey: '' }))
    return reply(m, '🗑️ API key lokal dihapus. GROQ_API_KEY di environment, jika ada, tetap berlaku.')
  }
  prompt(m, 'apikey')
  return reply(m, '🔑 *API KEY GROQ*\n\nKirim Groq API key sebagai pesan teks berikutnya di chat pribadi owner ini.\nModel: ' + ASISTEN_MODEL +
    '\nSesi berlaku 5 menit. Batalkan dengan .asisten batal.\nSetelah disimpan, hapus pesan API key dari riwayat WhatsApp.')
}
const handler = async (m, { conn, text }) => {
  if (m.isGroup) return reply(m, 'Atur asisten hanya melalui chat pribadi owner.')
  const raw = String(text || '').trim()
  const [first = '', ...rest] = raw.split(/\s+/)
  const action = first.toLowerCase()
  if (!action || action === 'menu' || action === 'help') return showMenu(m, conn)
  if (action === 'batal' || action === 'cancel') {
    pending.delete(pendingKey(m))
    return reply(m, '✅ Sesi input dibatalkan.')
  }
  if (action === 'on' || action === 'off') {
    if (action === 'on') {
      const current = await loadAsistenConfig()
      if (!current.targets.length) return reply(m, 'Tambahkan target terlebih dahulu melalui .asisten target.')
      if (!getAsistenApiKey(current)) return reply(m, 'Atur Groq API key terlebih dahulu melalui .asisten apikey.')
    }
    const updated = await updateAsistenConfig(cfg => ({ ...cfg, enabled: action === 'on' }))
    return reply(m, updated.enabled ? '🟢 Asisten otomatis aktif untuk target yang dipilih.' : '🔴 Asisten otomatis dinonaktifkan.')
  }
  if (action === 'target') return handleTarget(m, rest)
  if (['status', 'owner', 'kegiatan'].includes(action)) return handleStatus(m, raw.slice(first.length).trim())
  if (action === 'apikey') return handleApiKey(m, rest.map(value => value.toLowerCase()))
  return showMenu(m, conn)
}
handler.help = ['asisten', 'asisten on', 'asisten off', 'asisten target', 'asisten status', 'asisten apikey']
handler.tags = ['owner']
handler.command = /^asisten$/i
handler.rowner = true
handler.private = true

handler.all = async function (m, context = {}) {
  if (!m?.chat || m.isGroup || m.chat === 'status@broadcast') return
  // Root owner may use the same WhatsApp account as the linked bot. In that case
  // the bot's outbound prompt also appears with isROwner/fromMe. Ignore bot
  // message IDs while still allowing manually typed fromMe messages.
  if (wasBotSentMessage(m) || isOwnSetupPromptEcho(m, textContent(m))) return
  const key = pendingKey(m)
  const input = pending.get(key)
  if (input && isOwnerPrivate(m, context) && isAsistenPlainText(m) &&
      cleanMessageId(m) !== input.trigger) {
    const submitted = textContent(m).trim()
    if (submitted && !hasCommandPrefix(submitted)) {
      pending.delete(key)
      // Replace owner-provided private configuration text before any other plugin/logger sees it.
      m.text = input.kind === 'apikey' ? '[ASISTEN KEY REDACTED]' : '[ASISTEN INPUT]'
      if (Date.now() > input.expires) {
        await reply(m, 'Sesi input sudah kedaluwarsa. Ulangi .asisten ' + input.kind + '.')
        return
      }
      if (input.kind === 'apikey') {
        if (!isValidGroqKey(submitted)) return reply(m, 'Format API key Groq tidak valid. Buka .asisten apikey untuk mencoba lagi.')
        try {
          await updateAsistenConfig(cfg => ({ ...cfg, groqApiKey: submitted }))
          await reply(m, '✅ Groq API key tersimpan di penyimpanan privat server. Hapus pesan yang berisi API key dari riwayat WhatsApp.')
        } catch {
          await reply(m, '❌ Gagal menyimpan key. Periksa izin folder ALVARETH_DATA_DIR.')
        }
        return
      }
      if (input.kind === 'target') {
        const number = normalizeAsistenNumber(submitted)
        if (!number) return reply(m, 'Nomor tidak valid. Buka .asisten target lalu masukkan nomor internasional (contoh 6281234567890).')
        try { await addTarget(m, number) }
        catch { await reply(m, 'Gagal menambah target (maksimal 30 nomor).') }
        return
      }
      if (input.kind === 'status') {
        if (submitted.length > 700) return reply(m, 'Status maksimal 700 karakter. Ulangi .asisten status.')
        await updateAsistenConfig(cfg => ({ ...cfg, ownerStatus: submitted }))
        await reply(m, '✅ Status owner berhasil diperbarui.')
        return
      }
    }
  }

  // Incoming target messages only: never reply in groups, to self, or to the owner's setup commands.
  if (m.fromMe || !isAsistenPlainText(m) || hasCommandPrefix(m.text)) return
  const sender = senderAsistenNumber(m)
  if (!sender) return
  const config = await loadAsistenConfig()
  if (!asistenIsActiveFor(m, config) || !getAsistenApiKey(config)) return
  const messageId = cleanMessageId(m)
  if (!messageId) return
  const dedupeKey = m.chat + ':' + messageId
  const now = Date.now()
  for (const [id, at] of processed) if (now - at > 5 * 60 * 1000) processed.delete(id)
  if (processed.has(dedupeKey) || busy.has(m.chat)) return
  const session = conversations.get(m.chat)
  if (session && now - session.lastReply < REPLY_COOLDOWN) return
  processed.set(dedupeKey, now)
  busy.add(m.chat)
  try {
    const history = session && now - session.updatedAt < CONVERSATION_TTL ? session.history : []
    const incomingText = textContent(m).trim()
    const answer = await askAsistenGroq({
      apiKey: getAsistenApiKey(config),
      ownerStatus: config.ownerStatus,
      incomingText, history
    }).catch(error => {
      console.warn('[ASISTEN] Groq gagal:', error?.status || error?.name || 'request-error')
      return FALLBACK.replace('sedang tidak tersedia untuk membalas langsung', config.ownerStatus)
    })
    await this.sendMessage(m.chat, { text: answer }, { quoted: m })
    conversations.set(m.chat, {
      lastReply: Date.now(), updatedAt: Date.now(),
      history: [...history, { role: 'user', content: incomingText.slice(0, 900) },
        { role: 'assistant', content: answer.slice(0, 900) }].slice(-6)
    })
  } catch (error) {
    console.warn('[ASISTEN] Pengiriman balasan gagal:', error?.code || error?.name || 'send-error')
  } finally {
    busy.delete(m.chat)
  }
}
export default handler
