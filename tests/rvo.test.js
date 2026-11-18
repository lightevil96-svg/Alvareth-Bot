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

test('.rvo keeps View Once media blocked before any download attempt', async () => {
  const m = makeReply({
    viewOnceMessageV2: {
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          mediaKey: Buffer.from('view-once-key')
        }
      }
    }
  })
  let downloadCalls = 0
  const conn = {
    downloadM: async () => {
      downloadCalls++
      return imageBuffer
    },
    sendFile: async () => assert.fail('View Once media must not be re-sent')
  }

  await assert.rejects(
    handler(m, { conn }),
    error => String(error).includes('Lihat Sekali')
  )
  assert.equal(downloadCalls, 0)
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
