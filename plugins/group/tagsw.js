let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!m.isGroup) return m.reply('Khusus grup.')

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

  const captionOverride = typeof text === 'string' ? text.trim() : ''
  const quotedMessage =
    m.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.quoted?.message ||
    null

  let message

  // Reply media: forward the actual media payload into the group status.
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

      // Explicit text after .swgc takes priority; otherwise preserve media caption.
      if (mediaType === 'imageMessage' || mediaType === 'videoMessage' || mediaType === 'documentMessage') {
        media.caption = captionOverride || originalCaption
      }

      media.contextInfo = {
        ...(media.contextInfo || {}),
        ...statusContextInfo
      }

      message = { [mediaType]: media }
    }
  }

  // If no media was quoted, publish the provided text or quoted text as a text status.
  if (!message) {
    const statusText = captionOverride || m.quoted?.text || m.quoted?.caption || ''
    if (!statusText) {
      return m.reply(
        `Cara pakai:\n${usedPrefix + command} teks status\n\nAtau reply foto/video dengan .swgc [caption opsional]`
      )
    }

    message = {
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

  try {
    await conn.relayMessage(
      m.chat,
      {
        messageContextInfo: {
          messageSecret: 'BrRzGQ6/B0ddqBuasejEf+rJKLQ2pauxHtAw1nIMPvw='
        },
        groupStatusMessageV2: { message }
      },
      {}
    )

    await m.reply('✅ Status grup berhasil dikirim.')
  } catch (e) {
    console.error('[swgc]', e)
    await m.reply(`❌ Gagal mengirim status grup.\n\n${e.message || e}`)
  }
}

handler.help = ['swgc']
handler.tags = ['group']
handler.command = /^(swgc|upswgc)$/i
handler.group = true
handler.admin = true
handler.register = true

export default handler
