const MESSAGE_WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'deviceSentMessage',
  'editedMessage'
]

function unwrapRenderMessageContent(source) {
  let current = source
  const seen = new Set()

  for (let depth = 0; depth < 10; depth++) {
    if (!current || typeof current !== 'object' || seen.has(current)) return null
    seen.add(current)

    const wrapper = MESSAGE_WRAPPER_KEYS.find(key => {
      const nested = current[key]?.message
      return nested && typeof nested === 'object'
    })
    if (wrapper) {
      current = current[wrapper].message
      continue
    }

    const document = current.documentMessage
    if (document && typeof document === 'object') return document

    const primaryKey = Object.keys(current).find(key =>
      key !== 'messageContextInfo' && key !== 'senderKeyDistributionMessage'
    )
    if (primaryKey === 'documentMessage' && current[primaryKey] && typeof current[primaryKey] === 'object') {
      return current[primaryKey]
    }

    return null
  }

  return null
}

function normalizeSessionJid(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''

  const withoutDevice = raw.replace(/:\d+(?=@)/, '')
  if (/^\+?\d{8,15}$/.test(withoutDevice)) {
    return withoutDevice.replace(/\D/g, '') + '@s.whatsapp.net'
  }
  return withoutDevice
}

export function createRenderSessionKey(messageInfo) {
  const chat = normalizeSessionJid(messageInfo?.chat || messageInfo?.key?.remoteJid)
  const sender = normalizeSessionJid(
    messageInfo?.senderPN ||
    messageInfo?.sender ||
    messageInfo?.key?.participantAlt ||
    messageInfo?.key?.participant ||
    messageInfo?.key?.remoteJidAlt ||
    messageInfo?.key?.remoteJid
  )
  return chat && sender ? chat + '|' + sender : ''
}

export function getCurrentRenderDocument(messageInfo) {
  const type = String(messageInfo?.mtype || '').toLowerCase()
  if (type.includes('document')) {
    try {
      const direct = messageInfo?.msg
      if (direct && typeof direct === 'object') return direct
    } catch {
      // Fall back to the original raw Baileys message below.
    }
  }

  const sources = [
    messageInfo?.rawMessage?.message,
    messageInfo?.message
  ]
  for (const source of sources) {
    const document = unwrapRenderMessageContent(source)
    if (document) return document
  }

  return null
}

export function isRenderDocumentEvent(messageInfo) {
  if (getCurrentRenderDocument(messageInfo)) return true
  if (String(messageInfo?.mtype || '').toLowerCase().includes('document')) return true

  for (const source of [messageInfo?.rawMessage?.message, messageInfo?.message]) {
    if (!source || typeof source !== 'object') continue
    let current = source
    for (let depth = 0; depth < 10 && current && typeof current === 'object'; depth++) {
      if (Object.prototype.hasOwnProperty.call(current, 'documentMessage')) return true
      const wrapper = MESSAGE_WRAPPER_KEYS.find(key => current[key]?.message && typeof current[key].message === 'object')
      if (!wrapper) break
      current = current[wrapper].message
    }
  }
  return false
}
