import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  getImageBuffer,
  editImageWithPollinations,
  upscaleImageBuffer,
  runImageStyle
} from '../lib/image-edit.js'
import to3d, { STYLE_PROMPTS as to3dPrompts } from '../plugins/image/to3d.js'
import tohitam, { STYLE_PROMPTS as tohitamPrompts } from '../plugins/image/tohitam.js'

// 1x1 JPEG, cukup untuk file-type mendeteksi image/jpeg.
const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==',
  'base64'
)
const imageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const refMessage = (quotedMessage) => ({
  rawMessage: {
    message: {
      extendedTextMessage: { text: '.tooil', contextInfo: { quotedMessage } }
    }
  }
})

const imageResponse = (buffer = tinyJpeg) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : '') },
  arrayBuffer: async () => buffer,
  text: async () => ''
})

test('getImageBuffer membaca reply gambar walau MIME tidak terbawa', async () => {
  const m = refMessage({ imageMessage: { fileSha256: Buffer.from('abc') } })
  const conn = { downloadM: async () => imageBuffer }
  assert.deepEqual(await getImageBuffer(m, conn), imageBuffer)
})

test('getImageBuffer membaca gambar yang dikirim langsung dengan caption', async () => {
  const m = {
    mtype: 'imageMessage',
    msg: { mimetype: 'image/jpeg' },
    download: async () => imageBuffer
  }
  assert.deepEqual(await getImageBuffer(m, {}), imageBuffer)
})

test('getImageBuffer mengembalikan null bila tidak ada gambar', async () => {
  const m = { text: '.tooil' }
  assert.equal(await getImageBuffer(m, {}), null)
})

test('editImageWithPollinations memakai Pollinations + URL upload', async () => {
  let seenUrl = ''
  const result = await editImageWithPollinations(tinyJpeg, 'turn into oil painting', {
    uploadImpl: async () => 'https://d.uguu.se/test.jpg',
    fetchImpl: async (url) => {
      seenUrl = String(url)
      return imageResponse()
    }
  })
  assert.ok(seenUrl.includes('image.pollinations.ai'))
  assert.ok(seenUrl.includes('image=' + encodeURIComponent('https://d.uguu.se/test.jpg')))
  assert.deepEqual(result, tinyJpeg)
})

test('editImageWithPollinations menolak respons bukan gambar', async () => {
  await assert.rejects(
    editImageWithPollinations(tinyJpeg, 'turn into oil painting', {
      uploadImpl: async () => 'https://d.uguu.se/test.jpg',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        arrayBuffer: async () => Buffer.from('{}'),
        text: async () => '{}'
      })
    }),
    /bukan gambar/
  )
})

test('upscaleImageBuffer memakai Sharpify lalu mengunduh hasilnya', async () => {
  const result = await upscaleImageBuffer(tinyJpeg, {
    sharpifyImpl: async () => ({ url: 'https://example.com/up.jpg' }),
    fetchImpl: async () => imageResponse()
  })
  assert.deepEqual(result, tinyJpeg)
})

test('runImageStyle membalas cara pakai bila tidak ada gambar, tanpa memakai limit', async () => {
  const replies = []
  const m = {
    chat: '123@s.whatsapp.net',
    reply: async (text) => { replies.push(text); return true },
    react: async () => true
  }
  const ok = await runImageStyle(m, {
    conn: {},
    command: 'tooil',
    prompt: 'turn into oil painting',
    usedPrefix: '.'
  })
  assert.equal(ok, false)
  assert.equal(m.skipLimit, true)
  assert.match(replies.join('\n'), /\.tooil/)
})

test('runImageStyle mengirim hasil dan memakai limit hanya bila sukses', async () => {
  const m = {
    chat: '123@s.whatsapp.net',
    mtype: 'imageMessage',
    msg: { mimetype: 'image/jpeg' },
    download: async () => tinyJpeg,
    reply: async () => true,
    react: async () => true
  }
  const sent = []
  const conn = {
    sendMessage: async (chat, content) => {
      sent.push(content)
      return { key: { id: 'msg-1' } }
    }
  }
  const ok = await runImageStyle(m, {
    conn,
    command: 'tooil',
    prompt: 'turn into oil painting',
    usedPrefix: '.',
    uploadImpl: async () => 'https://d.uguu.se/test.jpg',
    fetchImpl: async () => imageResponse()
  })
  assert.equal(ok, true)
  assert.equal(m.skipLimit, false)
  assert.equal(sent.length, 1)
  assert.ok(Buffer.isBuffer(sent[0].image))
  assert.match(sent[0].caption, /tooil/)
})

test('Semua command to3d dan tohitam punya prompt dan regex yang cocok', () => {
  for (const [name, prompts, handler] of [
    ['to3d', to3dPrompts, to3d],
    ['tohitam', tohitamPrompts, tohitam]
  ]) {
    assert.deepEqual(handler.help.slice().sort(), Object.keys(prompts).sort(), name)
    for (const cmd of handler.help) {
      assert.ok(prompts[cmd], `${name}: ${cmd} tanpa prompt`)
      assert.ok(handler.command.test(cmd), `${name}: regex tidak cocok ${cmd}`)
    }
  }
  // Tidak ada lagi command ganda: handler hanya menjalankan plugin pertama.
  const overlap = to3d.help.filter((cmd) => tohitam.help.includes(cmd))
  assert.deepEqual(overlap, [])
  assert.ok(!tohitam.help.includes('toghibli'))
  assert.ok(!tohitam.help.includes('tojepang'))
  assert.ok(!tohitam.help.includes('tolego'))
})

test('Plugin image tidak lagi memakai backend mati', () => {
  const dead = ['kyzzz', 'api-faa.my.id', 'nanobanana', 'live3d', 'picsart.com']
  for (const file of ['to3d.js', 'tohitam.js', 'toblonde.js', 'hitamkan.js', 'img2img.js', 'picsart.js']) {
    const raw = fs.readFileSync(new URL(`../plugins/image/${file}`, import.meta.url), 'utf8')
    // Komentar penjelas boleh menyebut backend lama; yang dicek adalah kode.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    for (const needle of dead) {
      assert.ok(!src.includes(needle), `${file} masih memakai ${needle}`)
    }
  }
})
