import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'

const TIME_ZONE = 'Asia/Jakarta'
const DATA_DIR = process.env.ALVARETH_DATA_DIR
  ? resolve(process.env.ALVARETH_DATA_DIR)
  : join(homedir(), '.alvareth-bot-data')
const STATE_FILE = join(DATA_DIR, 'group-digest.json')
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_MESSAGES = 20000
const MAX_REPORT_GROUPS = 15
const MAX_REPORT_LENGTH = 12000

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  return match ? match[1] + ':' + match[2] : ''
}

function freshState() {
  return {
    version: 1,
    enabled: true,
    dailyTime: normalizeTime(process.env.GROUP_DIGEST_TIME) || '21:00',
    lastAutoSentDate: '',
    groups: {},
    messages: []
  }
}

let state = null
let loading = null
let saveTimer = null
let saveQueue = Promise.resolve()
let schedulerTimer = null
let schedulerInFlight = false
const seenMessageIds = new Set()
const metadataInFlight = new Map()

function messageKey(message) {
  return String(message.chat || '') + '|' + String(message.id || '')
}

async function ensureState() {
  if (state) return state
  if (loading) return loading

  loading = (async () => {
    const defaults = freshState()
    try {
      const raw = await readFile(STATE_FILE, 'utf8')
      const parsed = JSON.parse(raw)
      state = {
        ...defaults,
        ...parsed,
        groups: parsed?.groups && typeof parsed.groups === 'object' ? parsed.groups : {},
        messages: Array.isArray(parsed?.messages) ? parsed.messages : []
      }
      state.enabled = state.enabled !== false
      state.dailyTime = normalizeTime(state.dailyTime) || defaults.dailyTime
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('[GROUP DIGEST] Tidak dapat membaca data lama; data baru akan digunakan:', error?.message || error)
      }
      state = defaults
    }

    const cutoff = Date.now() - RETENTION_MS
    state.messages = state.messages
      .filter(item => item && typeof item.chat === 'string' && typeof item.text === 'string' && Number(item.ts) >= cutoff)
      .slice(-MAX_MESSAGES)
    seenMessageIds.clear()
    for (const item of state.messages) {
      if (item.id) seenMessageIds.add(messageKey(item))
    }
    return state
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

async function persistState() {
  await ensureState()
  const snapshot = JSON.stringify(state, null, 2)
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await mkdir(DATA_DIR, { recursive: true })
    const temporary = STATE_FILE + '.tmp'
    await writeFile(temporary, snapshot, 'utf8')
    await rename(temporary, STATE_FILE)
  })
  return saveQueue
}

function queueSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistState().catch(error => {
      console.error('[GROUP DIGEST] Gagal menyimpan data:', error?.message || error)
    })
  }, 800)
  if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

function isAcademicGroupName(name) {
  return /\b(kuliah|kuliahan|perkuliahan|kampus|kelas|pgmi|pgsd|matkul|mata kuliah|dosen|mahasiswa|angkatan|semester|uts|uas|praktikum|bimbingan|skripsi|tugas)\b/i.test(String(name || ''))
}

function isPriorityGroup(group) {
  const name = group?.name || ''
  return Boolean(group?.focus || (!group?.focusOverride && isAcademicGroupName(name)))
}

function cachedGroupName(conn, jid) {
  const cached = conn?.chats?.[jid]
  return cached?.subject || cached?.name || cached?.metadata?.subject || ''
}

function refreshGroupMetadata(conn, jid, group) {
  if (typeof conn?.groupMetadata !== 'function' || metadataInFlight.has(jid)) return
  if (Date.now() - Number(group.metadataAttemptAt || 0) < 60 * 60 * 1000) return
  group.metadataAttemptAt = Date.now()
  metadataInFlight.set(jid, true)

  Promise.resolve()
    .then(() => conn.groupMetadata(jid))
    .then(metadata => {
      if (metadata?.subject && state?.groups?.[jid]) {
        state.groups[jid].name = String(metadata.subject).slice(0, 120)
        state.groups[jid].metadataUpdatedAt = Date.now()
        queueSave()
      }
    })
    .catch(error => {
      console.warn('[GROUP DIGEST] Tidak dapat membaca nama grup:', jid, error?.message || error)
    })
    .finally(() => metadataInFlight.delete(jid))
}

function ensureGroup(conn, jid, now) {
  const knownName = cachedGroupName(conn, jid)
  let group = state.groups[jid]
  if (!group) {
    group = state.groups[jid] = {
      name: knownName || '',
      focus: false,
      focusOverride: false,
      firstSeenAt: now,
      lastSeenAt: now,
      metadataAttemptAt: 0,
      messageCount: 0
    }
  }
  if (knownName && (!group.name || group.name === jid)) group.name = knownName
  group.lastSeenAt = now
  refreshGroupMetadata(conn, jid, group)
  return group
}

const COMMAND_ONLY = /^\s*[.!/](?:ringkaswa|ringkasgrup|ringkasgc|pantauwa|groupdigest|grouppantau)\b/i

export async function recordGroupMessage(conn, message, upsertType) {
  try {
    if (upsertType && upsertType !== 'notify') return false
    const jid = typeof message?.chat === 'string' ? message.chat : ''
    if (!jid.endsWith('@g.us')) return false

    const text = typeof message?.text === 'string'
      ? message.text.replace(/\u200e/g, '').trim()
      : ''
    if (text.length < 3 || COMMAND_ONLY.test(text)) return false
    if (!/[a-zA-ZÀ-ÿ0-9]{2}/.test(text)) return false

    await ensureState()
    if (!state.enabled) return false

    const id = String(message?.id || message?.key?.id || '')
    const key = jid + '|' + id
    if (id && seenMessageIds.has(key)) return false

    const timestampValue = Number(message?.messageTimestamp)
    const timestamp = timestampValue > 1000000000000
      ? timestampValue
      : timestampValue > 0 ? timestampValue * 1000 : Date.now()
    const group = ensureGroup(conn, jid, timestamp)

    const record = {
      id,
      chat: jid,
      groupName: group.name || jid,
      text: text.slice(0, 1400),
      ts: timestamp
    }
    state.messages.push(record)
    if (id) seenMessageIds.add(key)
    group.messageCount = Number(group.messageCount || 0) + 1

    const cutoff = Date.now() - RETENTION_MS
    if (state.messages.length > MAX_MESSAGES || state.messages.length % 100 === 0) {
      const previous = state.messages
      state.messages = previous
        .filter(item => Number(item.ts) >= cutoff)
        .slice(-MAX_MESSAGES)
      seenMessageIds.clear()
      for (const item of state.messages) {
        if (item.id) seenMessageIds.add(messageKey(item))
      }
    }
    queueSave()
    return true
  } catch (error) {
    console.error('[GROUP DIGEST] Gagal mencatat pesan grup:', error?.message || error)
    return false
  }
}

const ANALYSIS_RULES = [
  {
    category: 'Tugas/tenggat',
    weight: 5,
    pattern: /\b(tugas|deadline|tenggat|dikumpul(?:kan|in)?|pengumpulan|paling lambat|batas waktu|remedial|makalah|presentasi|ppt|powerpoint|laporan|resume|review|proposal|ujian|uts|uas|kuis|quiz|dikerjakan|kerjakan|dikumpulin|upload|unggah|submit|classroom|lms|lembar kerja|lkpd|soal)\b/i
  },
  {
    category: 'Jadwal/kegiatan',
    weight: 4,
    pattern: /\b(besok|lusa|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|hari ini|jadwal|pertemuan|kuliah|zoom|google meet|meet\b|offline|online|kelas|libur|reschedule|ditunda|diundur|dimajukan|pukul|jam \d|masuk pukul|mulai pukul)\b/i
  },
  {
    category: 'Biaya/administrasi',
    weight: 5,
    pattern: /\b(bayar|pembayaran|biaya|iuran|ukt|spp|transfer|rekening|administrasi|pendaftaran|registrasi|denda|kwitansi|bukti tf|bukti transfer)\b/i
  },
  {
    category: 'Keputusan',
    weight: 4,
    pattern: /\b(disepakati|diputuskan|keputusan|hasil rapat|kesimpulan|sudah ditentukan|ketentuan|perubahan jadwal|fix ya|jadi kita|final)\b/i
  },
  {
    category: 'Pengumuman',
    weight: 3,
    pattern: /\b(pengumuman|mohon|dimohon|harap|wajib|informasi penting|diberitahukan|diumumkan|perhatian|disampaikan|diinfokan|info penting|jangan lupa)\b/i
  },
  {
    category: 'Tautan penting',
    weight: 4,
    pattern: /(https?:\/\/|www\.|forms\.gle\/|meet\.google\.com\/|drive\.google\.com\/|classroom\.google\.com\/|chat\.whatsapp\.com\/)/i
  },
  {
    category: 'Perlu konfirmasi',
    weight: 2,
    pattern: /\b(konfirmasi|ada yang tahu|ada yg tahu|ada yg tau|siapa yang|siapa yg|kapan ya|bagaimana kalau|gimana kalau|tolong jawab|mohon jawab|mohon info)\b|\?/i
  }
]

function analyzeMessage(text) {
  let score = 0
  const hits = []
  for (const rule of ANALYSIS_RULES) {
    if (rule.pattern.test(text)) {
      score += rule.weight
      hits.push(rule)
    }
  }

  const hasDateOrTime = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{1,2}[.:]\d{2}\b|\b\d{1,2}\s+(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)\b/i.test(text)
  if (hasDateOrTime) score += 2
  if (text.length >= 100) score += 1
  if (/[!?]/.test(text)) score += 1

  if (score < 3) return null
  hits.sort((a, b) => b.weight - a.weight)
  return {
    score,
    category: hits[0]?.category || (hasDateOrTime ? 'Tanggal/jam' : 'Poin penting'),
    text
  }
}

function jakartaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  return Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]))
}

function formatMessageTime(timestamp) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(timestamp))
}

function formatReportDate(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date)
}

function periodLabel(hours) {
  if (hours <= 1) return '1 jam terakhir'
  if (hours % 24 === 0) return (hours / 24) + ' hari terakhir'
  return hours + ' jam terakhir'
}

function shorten(text, max = 230) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1).trimEnd() + '…'
}

function uniqueCandidates(records) {
  const candidates = []
  const seenText = new Set()
  for (const message of records) {
    const analyzed = analyzeMessage(message.text)
    if (!analyzed) continue
    const key = message.text.toLowerCase().replace(/https?:\/\/\S+/g, 'LINK').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (seenText.has(key)) continue
    seenText.add(key)
    candidates.push({ ...analyzed, ts: message.ts })
  }
  candidates.sort((a, b) => (b.score - a.score) || (b.ts - a.ts))

  const chosen = []
  const usedCategories = new Set()
  for (const candidate of candidates) {
    if (!usedCategories.has(candidate.category)) {
      chosen.push(candidate)
      usedCategories.add(candidate.category)
      if (chosen.length >= 3) return chosen
    }
  }
  for (const candidate of candidates) {
    if (chosen.includes(candidate)) continue
    chosen.push(candidate)
    if (chosen.length >= 3) break
  }
  return chosen
}

export async function buildGroupDigest(options = {}) {
  await ensureState()
  const hours = Math.max(1, Math.min(168, Number(options.hours) || 24))
  const groupQuery = String(options.groupQuery || '').trim().toLocaleLowerCase('id-ID')
  const now = Date.now()
  const from = now - hours * 60 * 60 * 1000

  const availableGroups = Object.entries(state.groups).map(([jid, group]) => ({
    jid,
    name: String(group.name || jid),
    group
  }))
  const matchingGroups = groupQuery
    ? availableGroups.filter(item => (item.name + ' ' + item.jid).toLocaleLowerCase('id-ID').includes(groupQuery))
    : availableGroups
  if (groupQuery && matchingGroups.length === 0) {
    return '❌ Tidak menemukan grup dengan nama yang cocok dengan "' + groupQuery + '".\nKetik .pantauwa daftar untuk melihat nama grup yang sudah terdeteksi.'
  }

  const matchingIds = new Set(matchingGroups.map(item => item.jid))
  const recent = state.messages.filter(item =>
    Number(item.ts) >= from &&
    Number(item.ts) <= now + 60000 &&
    matchingIds.has(item.chat)
  )

  const activeGroupIds = [...new Set(recent.map(item => item.chat))]
  const totalMessages = recent.length
  const summaryGroups = []

  for (const jid of activeGroupIds) {
    const groupMeta = state.groups[jid] || {}
    const groupMessages = recent.filter(item => item.chat === jid)
    const items = uniqueCandidates(groupMessages)
    if (!items.length) continue
    summaryGroups.push({
      jid,
      name: String(groupMeta.name || groupMessages[0]?.groupName || jid),
      priority: isPriorityGroup(groupMeta) || isAcademicGroupName(groupMessages[0]?.groupName),
      messageCount: groupMessages.length,
      score: items.reduce((sum, item) => sum + item.score, 0),
      items
    })
  }

  summaryGroups.sort((a, b) =>
    (Number(b.priority) - Number(a.priority)) ||
    (b.score - a.score) ||
    (b.messageCount - a.messageCount)
  )

  const header = [
    '📚 RINGKASAN GRUP WHATSAPP',
    '🗓️ ' + formatReportDate(new Date(now)),
    '⏱️ Periode: ' + periodLabel(hours),
    '👥 Grup aktif: ' + activeGroupIds.length + '  |  💬 Pesan teks: ' + totalMessages,
    '🧠 Analisis lokal gratis: tugas, tenggat, jadwal, pengumuman, keputusan, biaya, tautan, dan pertanyaan.'
  ].join('\n')

  if (!recent.length) {
    return header + '\n\nBelum ada pesan teks baru yang tersimpan pada periode ini. Fitur hanya merangkum pesan sejak pemantauan aktif dan tidak mengambil riwayat chat lama.'
  }
  if (!summaryGroups.length) {
    return header + '\n\nBelum terdeteksi poin penting dari pesan-pesan tersebut. Tetap cek grup secara langsung untuk memastikan tidak ada informasi yang terlewat.'
  }

  const displayed = summaryGroups.slice(0, MAX_REPORT_GROUPS)
  const sections = []
  for (const group of displayed) {
    const badge = group.priority ? '⭐ ' : '👥 '
    const lines = [badge + group.name + ' (' + group.messageCount + ' pesan)']
    for (const item of group.items) {
      lines.push('• [' + item.category + '] ' + shorten(item.text, 230) + '  [' + formatMessageTime(item.ts) + ' WIB]')
    }
    sections.push(lines.join('\n'))
  }

  if (summaryGroups.length > displayed.length) {
    sections.push('ℹ️ ' + (summaryGroups.length - displayed.length) + ' grup aktif lain tidak ditampilkan karena batas panjang ringkasan. Gunakan .ringkaswa <kata nama grup> untuk memeriksa grup tertentu.')
  }
  const report = header + '\n\n' + sections.join('\n\n') +
    '\n\nCatatan: ini ringkasan otomatis berbasis aturan lokal, bukan model bahasa besar. Periksa pesan asli untuk memastikan konteks dan tenggat.'
  if (report.length <= MAX_REPORT_LENGTH) return report
  return report.slice(0, MAX_REPORT_LENGTH - 100).trimEnd() +
    '\n\n…Ringkasan dipotong agar pesan tetap ringkas. Gunakan .ringkaswa <nama grup> untuk detail.'
}

export async function getGroupDigestStatus() {
  await ensureState()
  const cutoff = Date.now() - RETENTION_MS
  const recent = state.messages.filter(item => Number(item.ts) >= cutoff)
  const groups = new Set(recent.map(item => item.chat))
  return {
    enabled: state.enabled,
    dailyTime: state.dailyTime,
    groups: groups.size,
    messages: recent.length,
    lastAutoSentDate: state.lastAutoSentDate || ''
  }
}

export async function listGroupDigestGroups() {
  await ensureState()
  const counts = new Map()
  for (const message of state.messages) {
    counts.set(message.chat, (counts.get(message.chat) || 0) + 1)
  }
  return Object.entries(state.groups)
    .map(([jid, group]) => ({
      jid,
      name: String(group.name || jid),
      priority: isPriorityGroup(group),
      focus: Boolean(group.focus),
      messageCount: counts.get(jid) || 0,
      lastSeenAt: Number(group.lastSeenAt || 0)
    }))
    .sort((a, b) =>
      (Number(b.priority) - Number(a.priority)) ||
      (b.lastSeenAt - a.lastSeenAt) ||
      a.name.localeCompare(b.name, 'id')
    )
}

export async function setGroupDigestEnabled(enabled) {
  await ensureState()
  state.enabled = Boolean(enabled)
  queueSave()
  await persistState()
  return state.enabled
}

export async function setGroupDigestTime(time) {
  await ensureState()
  const normalized = normalizeTime(time)
  if (!normalized) throw new Error('Format jam harus HH:MM, contoh 21:00 atau 06:30.')
  state.dailyTime = normalized
  queueSave()
  await persistState()
  return normalized
}

export async function setGroupFocusByQuery(query, focused = true) {
  await ensureState()
  const value = String(query || '').trim().toLocaleLowerCase('id-ID')
  if (!value) return { matched: [], query: value }
  const matched = []
  for (const [jid, group] of Object.entries(state.groups)) {
    const name = String(group.name || jid)
    if ((name + ' ' + jid).toLocaleLowerCase('id-ID').includes(value)) {
      group.focus = Boolean(focused)
      group.focusOverride = true
      matched.push({ jid, name, priority: isPriorityGroup(group) })
    }
  }
  if (matched.length) {
    queueSave()
    await persistState()
  }
  return { matched, query: value }
}

export async function clearGroupDigestMessages() {
  await ensureState()
  const count = state.messages.length
  state.messages = []
  seenMessageIds.clear()
  for (const group of Object.values(state.groups)) group.messageCount = 0
  queueSave()
  await persistState()
  return count
}

function ownerRecipient(conn) {
  const ownerNumber = String(process.env.OWNER_NUMBER || global.nomorown || '').replace(/\D/g, '')
  if (ownerNumber) return ownerNumber + '@s.whatsapp.net'
  const ownId = conn?.user?.id || ''
  if (typeof conn?.decodeJid === 'function') return conn.decodeJid(ownId) || ownId
  return ownId
}

async function runDailyCheck(getConnection) {
  if (schedulerInFlight) return
  const current = await ensureState()
  if (!current.enabled) return

  const parts = jakartaParts()
  const today = parts.year + '-' + parts.month + '-' + parts.day
  const currentTime = parts.hour + ':' + parts.minute
  if (currentTime < current.dailyTime || current.lastAutoSentDate === today) return

  const conn = typeof getConnection === 'function' ? getConnection() : getConnection
  const recipient = ownerRecipient(conn)
  if (!conn?.user?.id || !recipient || typeof conn?.sendMessage !== 'function') return

  schedulerInFlight = true
  try {
    const report = await buildGroupDigest({ hours: 24 })
    await conn.sendMessage(recipient, { text: report })
    current.lastAutoSentDate = today
    await persistState()
    console.log('[GROUP DIGEST] Ringkasan harian berhasil dikirim ke owner pada ' + currentTime + ' WIB.')
  } catch (error) {
    console.error('[GROUP DIGEST] Gagal mengirim ringkasan harian; akan dicoba ulang:', error?.message || error)
  } finally {
    schedulerInFlight = false
  }
}

export function startGroupDigestScheduler(getConnection) {
  if (schedulerTimer) return
  ensureState()
    .then(current => {
      console.log('[GROUP DIGEST] Pemantauan lokal ' + (current.enabled ? 'aktif' : 'nonaktif') +
        '; ringkasan harian dijadwalkan pukul ' + current.dailyTime + ' WIB.')
    })
    .catch(error => console.error('[GROUP DIGEST] Gagal memuat pengaturan:', error?.message || error))

  schedulerTimer = setInterval(() => {
    runDailyCheck(getConnection).catch(error => console.error('[GROUP DIGEST] Scheduler error:', error?.message || error))
  }, 30000)
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref()
}
