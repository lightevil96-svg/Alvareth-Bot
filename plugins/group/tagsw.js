import { randomBytes } from 'node:crypto'

// WhatsApp hanya menampilkan maksimal 10 baris dalam satu daftar
// native-flow/single-select, dihitung untuk semua section. Kode lama
// memasukkan SEMUA grup ke satu section, sehingga bot yang tergabung
// di lebih dari 10 grup tidak bisa menampilkan seluruh daftar: pesan
// ditolak/dipotong oleh WhatsApp. Satu tombol .swgc tetap dipakai,
// tetapi daftarnya dipaginasi DI DALAM daftar yang sama: halaman
// pertama 9 grup + "Halaman berikutnya", halaman tengah 8 grup +
// "sebelumnya"/"berikutnya", halaman terakhir sisanya + "sebelumnya".
// Dengan begitu semua grup tetap bisa dicapai dari satu tombol awal,
// tanpa mengirim banyak pesan daftar terpisah.
export const SWGC_MAX_LIST_ROWS = 10

export function getSwgcPages(totalGroups) {
  const total = Math.max(0, Math.floor(Number(totalGroups) || 0))
  if (total <= SWGC_MAX_LIST_ROWS) return total ? [{ start: 0, count: total }] : []
  const pages = []
  let start = 0
  while (start < total) {
    const remaining = total - start
    let count
    if (start === 0) count = Math.min(remaining, SWGC_MAX_LIST_ROWS - 1)
    else if (remaining <= SWGC_MAX_LIST_ROWS - 1) count = remaining
    else count = SWGC_MAX_LIST_ROWS - 2
    pages.push({ start, count })
    start += count
  }
  return pages
}

export function getSwgcPage(groups, page) {
  const list = Array.isArray(groups) ? groups : []
  const pages = getSwgcPages(list.length)
  if (!pages.length) {
    return { groups: [], page: 0, totalPages: 0, hasPrev: false, hasNext: false, start: 0, end: 0 }
  }
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pages.length - 1)
  const { start, count } = pages[safePage]
  return {
    groups: list.slice(start, start + count),
    page: safePage,
    totalPages: pages.length,
    hasPrev: safePage > 0,
    hasNext: safePage < pages.length - 1,
    start,
    end: start + count
  }
}

export function buildSwgcPickerRows(groups, page, token, prefix) {
  const list = Array.isArray(groups) ? groups : []
  const pageInfo = getSwgcPage(list, page)
  const rows = pageInfo.groups.map((group, index) => ({
    header: '',
    title: String(pageInfo.start + index + 1) + '. ' + String(group.subject || 'Grup tanpa nama')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 60),
    description: 'Kirim Status Grup ke grup ini',
    id: prefix + 'swgcselect ' + token + ' ' + group.id
  }))
  if (pageInfo.hasPrev) {
    rows.push({
      header: '',
      title: '⬅️ Halaman sebelumnya',
      description: 'Kembali ke halaman ' + pageInfo.page + ' dari ' + pageInfo.totalPages,
      id: prefix + 'swgcpage ' + token + ' ' + (pageInfo.page - 1)
    })
  }
  if (pageInfo.hasNext) {
    const nextStart = pageInfo.end
    const nextEnd = Math.min(list.length, nextStart + getSwgcPages(list.length)[pageInfo.page + 1].count)
    rows.push({
      header: '',
      title: '➡️ Halaman berikutnya',
      description: 'Lihat grup ' + (nextStart + 1) + '–' + nextEnd + ' dari ' + list.length,
      id: prefix + 'swgcpage ' + token + ' ' + (pageInfo.page + 1)
    })
  }
  return { rows, page: pageInfo }
}

const PENDING_TTL_MS = 5 * 60 * 1000
const pendingSwgc = global.__ALVARETH_SWGC_PENDING || (global.__ALVARETH_SWGC_PENDING = new Map())

const statusContextInfo = {
  forwardingScore: 0,
  featureEligibilities: {
    canBeReshared: true,
    canReceiveMultiReact: true
  },
  statusSourceType: 4,
  statusAttributions: [{ type: 10 }],
  statusAudienceMetadata: { audienceType: 1 }
}

function cleanPending() {
  const now = Date.now()
  for (const [token, item] of pendingSwgc) {
    if (!item || now - item.createdAt > PENDING_TTL_MS || item.used) {
      pendingSwgc.delete(token)
    }
  }
}

function getPrefix(usedPrefix) {
  return typeof usedPrefix === 'string' && usedPrefix
    ? usedPrefix
    : (typeof global.prefix === 'string' ? global.prefix : '.')
}

function createStatusMessage(m, text) {
  const captionOverride = typeof text === 'string' ? text.trim() : ''
  const quotedMessage =
    m.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.quoted?.message ||
    null

  const mediaContainer = m.quoted?.mediaMessage || quotedMessage
  if (mediaContainer) {
    const mediaType = [
      'imageMessage',
      'videoMessage',
      'documentMessage',
      'audioMessage',
      'stickerMessage'
    ].find(type => mediaContainer[type])

    if (mediaType) {
      const media = { ...mediaContainer[mediaType] }
      const originalCaption =
        media.caption ||
        m.quoted?.caption ||
        m.quoted?.text ||
        ''

      if (['imageMessage', 'videoMessage', 'documentMessage'].includes(mediaType)) {
        media.caption = captionOverride || originalCaption
      }

      media.contextInfo = {
        ...(media.contextInfo || {}),
        ...statusContextInfo
      }

      return { [mediaType]: media }
    }
  }

  const statusText = captionOverride || m.quoted?.text || m.quoted?.caption || ''
  if (!statusText) return null

  return {
    extendedTextMessage: {
      text: statusText,
      textArgb: 4294967295,
      backgroundArgb: 4280669030,
      font: 5,
      previewType: 0,
      contextInfo: statusContextInfo
    }
  }
}

const SWGC_MIN_INTERVAL_MS = 15 * 1000
const SWGC_RATE_LIMIT_COOLDOWN_MS = 60 * 1000

function isRateLimitError(error) {
  return /rate-overlimit|rate[ -]over[ -]limit|too many requests|\\b429\\b/i.test(
    String(error?.message || error || '')
  )
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sendGroupStatus(conn, groupId, message) {
  // Serialize status posts and enforce a minimum interval. Group-status relay
  // is rate-limited by WhatsApp independently from ordinary sendMessage calls.
  const previous = global.__ALVARETH_SWGC_SEND_LOCK || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  global.__ALVARETH_SWGC_SEND_LOCK = previous.then(() => current)

  await previous
  try {
    const cooldownUntil = Number(global.__ALVARETH_SWGC_COOLDOWN_UNTIL || 0)
    if (cooldownUntil > Date.now()) {
      const waitSeconds = Math.ceil((cooldownUntil - Date.now()) / 1000)
      throw new Error('WhatsApp sedang membatasi pengiriman Status Grup. Tunggu sekitar ' + waitSeconds + ' detik sebelum mencoba lagi.')
    }

    const lastSentAt = Number(global.__ALVARETH_SWGC_LAST_SEND_AT || 0)
    const waitMs = SWGC_MIN_INTERVAL_MS - (Date.now() - lastSentAt)
    if (waitMs > 0) await sleep(waitMs)

    try {
      const result = await conn.relayMessage(
        groupId,
        {
          messageContextInfo: {
            messageSecret: 'BrRzGQ6/B0ddqBuasejEf+rJKLQ2pauxHtAw1nIMPvw='
          },
          groupStatusMessageV2: { message }
        },
        {}
      )
      global.__ALVARETH_SWGC_LAST_SEND_AT = Date.now()
      global.__ALVARETH_SWGC_COOLDOWN_UNTIL = 0
      return result
    } catch (error) {
      if (isRateLimitError(error)) {
        global.__ALVARETH_SWGC_COOLDOWN_UNTIL = Date.now() + SWGC_RATE_LIMIT_COOLDOWN_MS
        throw new Error('WhatsApp menolak Status Grup karena rate limit. Bot otomatis menghentikan percobaan ulang selama 60 detik agar tidak memperparah pembatasan. Setelah itu jalankan .swgc sekali lagi.')
      }
      throw error
    }
  } finally {
    release()
  }
}

async function sendGroupPicker(m, conn, pending, token, prefix, page = 0) {
  const { rows, page: pageInfo } = buildSwgcPickerRows(pending.groups, page, token, prefix)
  const pageText = pageInfo.totalPages > 1
    ? '\nHalaman ' + (pageInfo.page + 1) + ' dari ' + pageInfo.totalPages +
      ' (grup ' + (pageInfo.start + 1) + '–' + pageInfo.end + '). ' +
      'Pakai "Halaman berikutnya" di dalam daftar ini untuk melihat semua grup.'
    : ''

  return conn.sendMessage(m.chat, {
    text: 'Pilih grup tujuan untuk Status Grup.\nTotal tersedia: ' + pending.groups.length + ' grup.' + pageText,
    footer: global.namebot || 'Alvareth Bot',
    optionText: 'Pilih Grup',
    optionTitle: '📣 Kirim Status ke Grup',
    offerText: global.namebot || 'Alvareth Bot',
    offerCode: global.namebot || 'Alvareth Bot',
    offerUrl: global.botLink || 'https://spoo.me/Alvareth-Bot',
    offerExpiration: Date.now() + 86400000,
    nativeFlow: [{
      text: 'Pilih grup tujuan',
      sections: [{
        title: pageInfo.totalPages > 1
          ? 'Daftar grup ' + (pageInfo.start + 1) + '–' + pageInfo.end
          : 'Semua daftar grup',
        rows
      }],
      icon: 'image'
    }],
    interactiveAsTemplate: false
  }, { quoted: m, noAlvarethPreview: true })
}

async function showGroupButtons(m, conn, message, prefix) {
  cleanPending()

  const groups = Object.values(await conn.groupFetchAllParticipating())
    .filter(group => group?.id && group.id.endsWith('@g.us'))
    .sort((a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), 'id'))
    .map(group => ({ id: group.id, subject: group.subject || 'Grup tanpa nama' }))

  if (!groups.length) {
    return m.reply('❌ Bot belum tergabung di grup WhatsApp mana pun.')
  }

  const token = randomBytes(8).toString('hex')
  const pending = {
    sender: m.sender,
    message,
    groups,
    createdAt: Date.now(),
    used: false
  }
  pendingSwgc.set(token, pending)

  // Semua grup ditampilkan dari satu tombol .swgc; navigasi halaman
  // ada di dalam daftar yang sama (lihat getSwgcPages di atas).
  return sendGroupPicker(m, conn, pending, token, prefix)
}

const handler = async (m, { conn, text, usedPrefix, command, isAdmin, isOwner }) => {
  const action = String(command || '').toLowerCase()

  if (action === 'swgcpage') {
    const [token, pageText] = String(text || '').trim().split(/\s+/)
    const page = Number(pageText)
    if (!token || !Number.isInteger(page) || page < 0) {
      return m.reply('❌ Halaman daftar grup tidak valid. Jalankan ulang perintah .swgc pada pesan sumber.')
    }

    cleanPending()
    const pending = pendingSwgc.get(token)
    if (!pending) {
      return m.reply('⌛ Permintaan SWGC sudah kedaluwarsa atau tidak ditemukan. Reply ulang pesan sumber dengan .swgc.')
    }
    if (pending.sender !== m.sender) {
      return m.reply('❌ Tombol ini bukan milik kamu. Jalankan .swgc dari pesan sumber milikmu sendiri.')
    }
    if (pending.used) {
      return m.reply('⏳ Pengiriman SWGC ini sedang diproses atau sudah digunakan.')
    }
    if (page >= getSwgcPages(pending.groups.length).length) {
      return m.reply('❌ Halaman daftar grup tidak tersedia. Jalankan .swgc kembali.')
    }

    try {
      await sendGroupPicker(m, conn, pending, token, getPrefix(usedPrefix), page)
    } catch (error) {
      console.error('[SWGC] Gagal menampilkan halaman daftar grup:', error?.stack || error)
      return m.reply('❌ Tidak dapat menampilkan daftar grup.\n\n' + String(error?.message || error).slice(0, 500))
    }
    return
  }

  if (action === 'swgcselect') {
    const [token, groupId] = String(text || '').trim().split(/\s+/)
    if (!token || !groupId || !groupId.endsWith('@g.us')) {
      return m.reply('❌ Data pilihan grup tidak valid. Jalankan ulang perintah .swgc pada pesan sumber.')
    }

    cleanPending()
    const pending = pendingSwgc.get(token)
    if (!pending) {
      return m.reply('⌛ Permintaan SWGC sudah kedaluwarsa atau tidak ditemukan. Reply ulang pesan sumber dengan .swgc.')
    }
    if (pending.sender !== m.sender) {
      return m.reply('❌ Tombol ini bukan milik kamu. Jalankan .swgc dari pesan sumber milikmu sendiri.')
    }
    if (pending.used) {
      return m.reply('⏳ Pengiriman SWGC ini sedang diproses atau sudah digunakan.')
    }
    if (!pending.groups.some(group => group.id === groupId)) {
      return m.reply('❌ Grup tersebut tidak termasuk dalam daftar pilihan SWGC ini.')
    }

    pending.used = true
    try {
      const target = pending.groups.find(group => group.id === groupId)
      if (!target) {
        pendingSwgc.delete(token)
        return m.reply('❌ Grup tujuan tidak lagi tersedia dalam sesi pilihan ini. Jalankan .swgc kembali.')
      }

      await sendGroupStatus(conn, groupId, pending.message)
      pendingSwgc.delete(token)
      await m.reply('✅ Status grup berhasil dikirim ke *' + String(target.subject || 'grup tujuan') + '*.')
      await m.react?.('✅').catch(() => {})
    } catch (error) {
      pending.used = false
      console.error('[SWGC] Gagal mengirim status grup:', error?.stack || error)
      return m.reply('❌ Gagal mengirim status grup.\n\n' + String(error?.message || error).slice(0, 500))
    }
    return
  }

  // Keep the previous in-group workflow and its admin restriction intact.
  if (m.isGroup && !(isAdmin || isOwner)) {
    return m.reply('❌ Perintah .swgc di dalam grup hanya dapat digunakan oleh admin grup.')
  }

  const message = createStatusMessage(m, text)
  if (!message) {
    return m.reply(
      'Cara pakai .swgc:\n' +
      '1. Kirim foto/video beserta caption di chat pribadi atau chat biasa.\n' +
      '2. Reply pesan tersebut dengan .swgc.\n' +
      '3. Pilih grup tujuan dari tombol yang muncul. Kalau grupmu banyak, pakai "Halaman berikutnya" di dalam daftar yang sama untuk melihat semua grup.\n\n' +
      'Kamu juga bisa reply teks untuk membuat Status Grup berbentuk teks.'
    )
  }

  try {
    await showGroupButtons(m, conn, message, getPrefix(usedPrefix))
  } catch (error) {
    console.error('[SWGC] Gagal menampilkan pilihan grup:', error?.stack || error)
    return m.reply('❌ Tidak dapat menampilkan daftar grup.\n\n' + String(error?.message || error).slice(0, 500))
  }
}

handler.help = ['swgc']
handler.tags = ['group']
handler.command = /^(swgc|upswgc|swgcselect|swgcpage)$/i
handler.register = true

export default handler
