import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadIncomingImage } from '../plugins/owner/render.js'

// Regression for the live failure 2026-11-27: all four template photos were
// rejected with "Cannot destructure property 'mediaKey' of 'undefined'".
// The old downloadIncomingImage relied on the smsg getters (m.download /
// m.msg), but this Baileys fork's protobuf conversion can drop the serializer
// getters (handler.js warns not to rely on them), so m.msg was undefined and
// downloadContentFromMessage threw while destructuring it. These tests use a
// plain-object message with NO getters at all, exactly like the live case.

function imagePayload(overrides = {}) {
  return {
    mimetype: 'image/jpeg',
    mediaKey: Buffer.from('k'.repeat(32)),
    directPath: '/direct/path/image.jpg',
    url: 'https://mmg.whatsapp.net/direct/path/image.jpg',
    fileLength: 12345,
    caption: '',
    ...overrides
  }
}

function plainMessage(payload) {
  const content = { imageMessage: payload }
  return {
    key: { id: '3EB0TESTMSGID123456', remoteJid: '62812xxxx@s.whatsapp.net', fromMe: false },
    message: content,
    rawMessage: { key: { id: '3EB0TESTMSGID123456' }, message: content },
    mtype: 'imageMessage'
    // NOTE: no `msg` property and no `download` method on purpose.
  }
}

test('foto template terunduh dari payload mentah walau m.msg undefined', async () => {
  const payload = imagePayload()
  const m = plainMessage(payload)
  assert.equal(m.msg, undefined)
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
  const seen = []
  const conn = {
    async downloadM(media, type) {
      seen.push({ media, type })
      return Buffer.from(jpeg)
    }
  }
  const buffer = await downloadIncomingImage(m, conn)
  assert.deepEqual(buffer, jpeg)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].media, payload)
  assert.equal(seen[0].type, 'image')
})

test('payload tanpa url/directPath tidak melempar error destructure mediaKey', async () => {
  const payload = imagePayload({ url: undefined, directPath: undefined })
  const m = plainMessage(payload)
  const conn = {
    async downloadM() { return Buffer.alloc(0) },
    async loadMessage() { return null }
  }
  await assert.rejects(
    () => downloadIncomingImage(m, conn),
    error => {
      assert.match(error.message, /Foto tidak dapat diunduh dari WhatsApp/)
      assert.doesNotMatch(error.message, /mediaKey/)
      return true
    }
  )
})

test('fallback ke pesan tersimpan saat payload mentah hanya berisi thumbnail', async () => {
  const thinPayload = imagePayload({ url: undefined, directPath: undefined })
  const fullPayload = imagePayload()
  const m = plainMessage(thinPayload)
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02])
  const conn = {
    async downloadM(media) {
      return media === fullPayload ? Buffer.from(jpeg) : Buffer.alloc(0)
    },
    async loadMessage(id) {
      assert.equal(id, '3EB0TESTMSGID123456')
      return { key: { id }, message: { imageMessage: fullPayload } }
    }
  }
  const buffer = await downloadIncomingImage(m, conn)
  assert.deepEqual(buffer, jpeg)
})

test('m.download() dipakai sebagai jalan terakhir bila tidak ada payload mentah', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x03, 0x04])
  const m = {
    key: { id: '3EB0TESTMSGID999999' },
    message: {},
    mtype: 'imageMessage',
    async download() { return Buffer.from(jpeg) }
  }
  const conn = {}
  const buffer = await downloadIncomingImage(m, conn)
  assert.deepEqual(buffer, jpeg)
})
