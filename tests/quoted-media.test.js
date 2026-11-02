import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getQuotedMediaInfo,
  getQuotedStanzaId,
  resolveQuotedMediaInfo,
  downloadQuotedMedia,
  cloneMessageForMediaCache
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

test('Original cached media is downloaded before a quoted thumbnail fallback', async () => {
  const preview = Buffer.from([0x01, 0x02])
  const original = Buffer.from([0xff, 0xd8, 0xff, 0x11])
  const m = refMessage({ imageMessage: { jpegThumbnail: preview } })
  let previewDownloadCalls = 0
  Object.defineProperty(m, 'quoted', {
    get() {
      return {
        download: async () => {
          previewDownloadCalls++
          return preview
        }
      }
    }
  })
  const conn = {
    loadMessage: id => ({
      key: { id },
      message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from('full-media-key') } }
    }),
    downloadM: async media => {
      assert.ok(media.mediaKey, 'the original upload must be selected')
      return original
    }
  }

  assert.deepEqual(await downloadQuotedMedia(m, conn), original)
  assert.equal(previewDownloadCalls, 0, 'the thumbnail download must not win over the original upload')
})

test('Quoted media inside an ephemeral wrapper is recognized', () => {
  const m = refMessage({
    ephemeralMessage: {
      message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from('wrapped-key') } }
    }
  })
  assert.equal(getQuotedMediaInfo(m)?.type, 'imageMessage')
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


test('Media cache clone preserves Buffer and Uint8Array encryption fields', () => {
  const original = {
    key: { id: 'binary-cache-test' },
    message: {
      imageMessage: {
        mediaKey: Buffer.from([1, 2, 3, 4]),
        fileEncSha256: new Uint8Array([5, 6, 7]),
        fileSha256: Buffer.from([8, 9]),
        jpegThumbnail: Buffer.from([10, 11])
      }
    }
  }
  const cached = cloneMessageForMediaCache(original)
  assert.notEqual(cached, original)
  assert.notEqual(cached.message, original.message)
  assert.ok(Buffer.isBuffer(cached.message.imageMessage.mediaKey))
  assert.ok(cached.message.imageMessage.fileEncSha256 instanceof Uint8Array)
  assert.ok(Buffer.isBuffer(cached.message.imageMessage.fileSha256))
  assert.ok(Buffer.isBuffer(cached.message.imageMessage.jpegThumbnail))
  assert.deepEqual(cached.message.imageMessage.mediaKey, original.message.imageMessage.mediaKey)
  assert.deepEqual(cached.message.imageMessage.fileEncSha256, original.message.imageMessage.fileEncSha256)
  cached.message.imageMessage.mediaKey[0] = 99
  assert.equal(original.message.imageMessage.mediaKey[0], 1)
})

test('Prefer cached original media even when the quoted preview has its own media key', async () => {
  const previewKey = Buffer.from('preview-key')
  const originalKey = Buffer.from('original-key')
  const m = refMessage({
    imageMessage: {
      mimetype: 'image/jpeg',
      mediaKey: previewKey,
      fileEncSha256: Buffer.from('preview-encrypted-hash')
    }
  })
  const conn = {
    loadMessage: id => ({
      key: { id },
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          mediaKey: originalKey,
          fileEncSha256: Buffer.from('original-encrypted-hash')
        }
      }
    }),
    downloadM: async media => {
      assert.deepEqual(media.mediaKey, originalKey)
      return imageBuffer
    }
  }
  const resolved = await resolveQuotedMediaInfo(m, conn)
  assert.deepEqual(resolved?.media?.mediaKey, originalKey)
  assert.deepEqual(await downloadQuotedMedia(m, conn), imageBuffer)
})
