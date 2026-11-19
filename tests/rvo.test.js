import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../plugins/tools/rvo.js'

const imageBuffer = Buffer.from('mock-image-bytes')
const makeReply = quotedMessage => ({
  chat: '6281234567890@s.whatsapp.net',
  rawMessage: {
    message: {
      extendedTextMessage: {
        text: '.rvo',
        contextInfo: {
          stanzaId: 'rvo-source-message',
          quotedMessage
        }
      }
    }
  }
})

test('.rvo downloads and re-sends quoted media from the raw WhatsApp payload', async () => {
  const m = makeReply({
    imageMessage: {
      mimetype: 'image/jpeg',
      fileName: 'foto-asli.jpg',
      caption: 'caption asli',
      mediaKey: Buffer.from('media-key')
    }
  })
  let sent
  const conn = {
    downloadM: async (media, type) => {
      assert.equal(type, 'image')
      assert.equal(media.mimetype, 'image/jpeg')
      return imageBuffer
    },
    sendFile: async (...args) => { sent = args }
  }

  await handler(m, { conn })

  assert.equal(sent[0], m.chat)
  assert.deepEqual(sent[1], imageBuffer)
  assert.equal(sent[2], 'foto-asli.jpg')
  assert.equal(sent[3], 'caption asli')
  assert.equal(sent[4], m)
})

test('.rvo infers a safe filename when quoted media has no MIME or filename', async () => {
  const m = makeReply({
    imageMessage: { mediaKey: Buffer.from('media-key') }
  })
  let sent
  const conn = {
    downloadM: async () => imageBuffer,
    sendFile: async (...args) => { sent = args }
  }

  await handler(m, { conn })

  assert.equal(sent[2], 'media.jpg')
})

test('.rvo reads and re-sends a quoted View Once photo (its namesake purpose)', async () => {
  const m = makeReply({
    viewOnceMessageV2: {
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          fileName: 'sekali-lihat.jpg',
          caption: 'foto sekali lihat',
          mediaKey: Buffer.from('view-once-key')
        }
      }
    }
  })
  let sent
  const conn = {
    downloadM: async (media, type) => {
      assert.equal(type, 'image')
      assert.equal(media.mimetype, 'image/jpeg')
      return imageBuffer
    },
    sendFile: async (...args) => { sent = args }
  }

  await handler(m, { conn })

  assert.equal(sent[0], m.chat)
  assert.deepEqual(sent[1], imageBuffer)
  assert.equal(sent[2], 'sekali-lihat.jpg')
  assert.equal(sent[3], 'foto sekali lihat')
})

test('.rvo reads a quoted View Once video wrapped in viewOnceMessage v1', async () => {
  const videoBuffer = Buffer.from('mock-view-once-video')
  const m = makeReply({
    viewOnceMessage: {
      message: {
        videoMessage: {
          mimetype: 'video/mp4',
          seconds: 5,
          mediaKey: Buffer.from('view-once-video-key')
        }
      }
    }
  })
  let sent
  const conn = {
    downloadM: async (media, type) => {
      assert.equal(type, 'video')
      return videoBuffer
    },
    sendFile: async (...args) => { sent = args }
  }

  await handler(m, { conn })

  assert.deepEqual(sent[1], videoBuffer)
  assert.equal(sent[2], 'media.mp4')
})

test('.rvo explains clearly when a View Once media can no longer be downloaded', async () => {
  const m = makeReply({
    viewOnceMessageV2: {
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          mediaKey: Buffer.from('expired-view-once-key')
        }
      }
    }
  })
  const conn = {
    downloadM: async () => { throw new Error('media not found') },
    sendFile: async () => assert.fail('Expired View Once media must not be re-sent')
  }

  await assert.rejects(
    handler(m, { conn }),
    error => String(error).includes('Lihat Sekali') && String(error).includes('mengirim ulang')
  )
})

test('.rvo gives a clear instruction when the command is not replying to media', async () => {
  const m = {
    chat: '6281234567890@s.whatsapp.net',
    rawMessage: { message: { conversation: '.rvo' } }
  }

  await assert.rejects(
    handler(m, { conn: {} }),
    error => String(error).includes('Balas pesan')
  )
})
