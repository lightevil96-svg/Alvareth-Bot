import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getQuotedMediaInfo,
  getQuotedStanzaId,
  resolveQuotedMediaInfo,
  downloadQuotedMedia
} from '../lib/simple.js'

const imageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const videoBuffer = Buffer.from('mock-video-bytes')
const refMessage = (quotedMessage, stanzaId = 'original-media-123') => ({
  rawMessage: {
    message: {
      extendedTextMessage: {
        text: '.s',
        contextInfo: { stanzaId, quotedMessage }
      }
    }
  }
})

test('Sticker reply recognizes a quoted photo with missing MIME', () => {
  const m = refMessage({ imageMessage: { fileSha256: Buffer.from('abc') } })
  const info = getQuotedMediaInfo(m)
  assert.equal(info?.type, 'imageMessage')
  assert.equal(getQuotedStanzaId(m), 'original-media-123')
})

test('Sticker reply recognizes a quoted video and duration', () => {
  const m = refMessage({ videoMessage: { seconds: 7 } })
  const info = getQuotedMediaInfo(m)
  assert.equal(info?.type, 'videoMessage')
  assert.equal(info?.media?.seconds, 7)
})

test('Reply media is resolved through the saved original when quote only has text', async () => {
  const m = refMessage({ extendedTextMessage: { text: 'Foto dengan caption' } })
  const conn = {
    loadMessage: id => id === 'original-media-123'
      ? { key: { id }, message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from('key') } } }
      : null,
    downloadM: async (media, type) => {
      assert.equal(type, 'image')
      assert.equal(media.mimetype, 'image/jpeg')
      return imageBuffer
    }
  }
  assert.equal(getQuotedMediaInfo(m), null)
  const info = await resolveQuotedMediaInfo(m, conn)
  assert.equal(info?.type, 'imageMessage')
  assert.deepEqual(await downloadQuotedMedia(m, conn), imageBuffer)
})

test('Prefer full source message when quoted photo contains only a thumbnail', async () => {
  const m = refMessage({ imageMessage: { jpegThumbnail: imageBuffer } })
  const conn = {
    loadMessage: id => ({
      key: { id },
      message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from('key') } }
    }),
    downloadM: async media => {
      if (!media.mediaKey) throw new Error('Preview cannot be downloaded')
      return imageBuffer
    }
  }
  const info = await resolveQuotedMediaInfo(m, conn)
  assert.equal(info?.media?.mimetype, 'image/jpeg')
  assert.deepEqual(await downloadQuotedMedia(m, conn), imageBuffer)
})

test('A full quoted video can be downloaded directly without the message cache', async () => {
  const m = refMessage({ videoMessage: { mimetype: 'video/mp4', seconds: 5 } })
  const conn = {
    downloadM: async (media, type) => {
      assert.equal(type, 'video')
      assert.equal(media.seconds, 5)
      return videoBuffer
    }
  }
  assert.deepEqual(await downloadQuotedMedia(m, conn), videoBuffer)
})

test('No quoted media means a clean null rather than a crash', async () => {
  const m = { rawMessage: { message: { conversation: '.s' } } }
  assert.equal(getQuotedMediaInfo(m), null)
  assert.equal(getQuotedStanzaId(m), '')
  assert.equal(await resolveQuotedMediaInfo(m, {}), null)
  assert.equal(await downloadQuotedMedia(m, {}), null)
})
