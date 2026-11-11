import { randomBytes } from 'node:crypto'

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

async function sendGroupStatus(conn, groupId, message) {
  return conn.relayMessage(
    groupId,
    {
      messageContextInfo: {
        messageSecret: 'BrRzGQ6/B0ddqBuasejEf+rJKLQ2pauxHtAw1nIMPvw='
      },
      groupStatusMessageV2: { message }
    },
    {}
  )
}

async function sendGroupPicker(m, conn, pending, token, prefix) {
  const rows = pending.groups.map((group, index) => ({
    header: '',
    title: String(index + 1) + '. ' + String(group.subject || 'Grup tanpa nama')
      .replace(/[\\r\\n]+/g, ' ')
      .trim()
      .slice(0, 60),
    description: 'Kirim Status Grup ke grup ini',
    id: prefix + 'swgcselect ' + token + ' ' + group.id
  }))

  return conn.sendMessage(m.chat, {
    text: 'Pilih grup tujuan untuk Status Grup.\nTotal tersedia: ' + pending.groups.length + ' grup.',
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
        title: 'Semua daftar grup',
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

  // Semua grup ditampilkan dalam satu menu interaktif, tanpa mengirim halaman terpisah.
  return sendGroupPicker(m, conn, pending, token, prefix)
}

const handler = async (m, { conn, text, usedPrefix, command, isAdmin, isOwner }) => {
  const action = String(command || '').toLowerCase()

  if (action === 'swgcselect') {
    const [token, groupId] = String(text || '').trim().split(/\\s+/)
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
      const groups = await conn.groupFetchAllParticipating()
      const target = groups[groupId]
      if (!target) {
        pendingSwgc.delete(token)
        return m.reply('❌ Bot sudah tidak tergabung di grup tujuan tersebut. Jalankan .swgc kembali untuk memilih grup lain.')
      }

      await sendGroupStatus(conn, groupId, pending.message)
      pendingSwgc.delete(token)
      await m.reply('✅ Status grup berhasil dikirim ke *' + String(target.subject || 'grup tujuan') + '*.')
      await m.react?.('✅').catch(() => {})
    } catch (error) {
      pending.used = false
      console.error('[SWGC] Gagal mengirim status grup:', error?.stack || error)
      return m.reply('❌ Gagal mengirim status grup.\\n\\n' + String(error?.message || error).slice(0, 500))
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
      'Cara pakai .swgc:\\n' +
      '1. Kirim foto/video beserta caption di chat pribadi atau chat biasa.\\n' +
      '2. Reply pesan tersebut dengan .swgc.\\n' +
      '3. Pilih grup tujuan dari tombol yang muncul.\\n\\n' +
      'Kamu juga bisa reply teks untuk membuat Status Grup berbentuk teks.'
    )
  }

  try {
    await showGroupButtons(m, conn, message, getPrefix(usedPrefix))
  } catch (error) {
    console.error('[SWGC] Gagal menampilkan pilihan grup:', error?.stack || error)
    return m.reply('❌ Tidak dapat menampilkan daftar grup.\\n\\n' + String(error?.message || error).slice(0, 500))
  }
}

handler.help = ['swgc']
handler.tags = ['group']
handler.command = /^(swgc|upswgc|swgcselect)$/i
handler.register = true

export default handler
