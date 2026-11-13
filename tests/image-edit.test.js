import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  getImageBuffer,
  editImageWithAiHorde,
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

// Mock alur AI Horde: submit -> check done -> status -> unduh hasil.
const hordeFetch = (submitBody) => async (url, options = {}) => {
  const target = String(url)
  if (target.includes('/generate/async')) {
    submitBody.captured = JSON.parse(options.body)
    return { ok: true, status: 202, json: async () => ({ id: 'job-1' }) }
  }
  if (target.includes('/generate/check/')) {
    return { ok: true, status: 200, json: async () => ({ done: true }) }
  }
  if (target.includes('/generate/status/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ generations: [{ img: 'https://example.com/result.jpg' }] })
    }
  }
  return imageResponse()
}

test('editImageWithAiHorde memakai img2img AI Horde dengan prompt pelindung', async () => {
  const submitBody = {}
  const result = await editImageWithAiHorde(tinyJpeg, 'turn into oil painting', {
    fetchImpl: hordeFetch(submitBody),
    prepareImpl: async (buffer) => ({ buffer, width: 64, height: 64 }),
    pollIntervalMs: 0
  })
  const body = submitBody.captured
  assert.equal(body.source_processing, 'img2img')
  assert.equal(body.models[0], 'stable_diffusion')
  // denoising 0.35: uji A/B 2026-11-13 menunjukkan 0.5 mengubah wajah
  // karakter anime jadi orang lain; 0.35 paling setia pada karakter asli.
  assert.equal(body.params.denoising_strength, 0.35)
  assert.match(body.params.negative_prompt, /different face/)
  assert.equal(body.nsfw, true)
  assert.equal(body.censor_nsfw, false)
  assert.match(body.prompt, /fully clothed/)
  assert.match(body.prompt, /keep the same subject/)
  assert.match(body.prompt, /same subject, face, character design/)
  assert.ok(body.source_image.length > 0)
  assert.deepEqual(result, tinyJpeg)
})

test('editImageWithAiHorde menolak bila Horde tidak menghasilkan gambar', async () => {
  await assert.rejects(
    editImageWithAiHorde(tinyJpeg, 'turn into oil painting', {
      fetchImpl: async (url) => {
        if (String(url).includes('/generate/async')) {
          return { ok: true, status: 202, json: async () => ({ id: 'job-1' }) }
        }
        if (String(url).includes('/generate/check/')) {
          return { ok: true, status: 200, json: async () => ({ done: true }) }
        }
        return { ok: true, status: 200, json: async () => ({ generations: [] }) }
      },
      prepareImpl: async (buffer) => ({ buffer, width: 64, height: 64 }),
      pollIntervalMs: 0
    }),
    /tidak menghasilkan gambar/
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
  const submitBody = {}
  const ok = await runImageStyle(m, {
    conn,
    command: 'tooil',
    prompt: 'turn into oil painting',
    usedPrefix: '.',
    fetchImpl: hordeFetch(submitBody),
    prepareImpl: async (buffer) => ({ buffer, width: 64, height: 64 }),
    pollIntervalMs: 0
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
  // Helper edit tidak boleh lagi memakai Pollinations: parameter image-nya
  // diabaikan di API gratis, jadi hasilnya gambar baru dari prompt saja.
  const helperRaw = fs.readFileSync(new URL('../lib/image-edit.js', import.meta.url), 'utf8')
  const helperCode = helperRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  for (const needle of ['pollinations', 'malvryx', 'uguu.se', 'buildPollinationsImageUrl']) {
    assert.ok(!helperCode.includes(needle), `lib/image-edit.js masih memakai ${needle}`)
  }
  assert.ok(helperCode.includes('aihorde.net'), 'lib/image-edit.js harus memakai AI Horde')
})
