import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { proto } from 'baileys'
import {
  baileysSupportsSoundSticker,
  classifyStickerAudioSource,
  extractAudioFromVideoBuffer,
  makeVideoFromImageAndAudio,
  normalizeAudioBuffer,
  parseStickerAudioArgs,
  sendNativeSoundSticker,
  stickerAudioLimits
} from '../lib/sticker-audio.js'
import { createStickerFromBuffer } from '../plugins/sticker/sticker-engine.js'

function ffmpegAvailable(t) {
  const version = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (version.error?.code === 'ENOENT') {
    t.skip('FFmpeg tidak tersedia pada runner ini.')
    return false
  }
  return true
}

async function makeTestVideoWithAudio(directory) {
  const inputPath = join(directory, 'input.mp4')
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-t', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-shortest',
    '-movflags', '+faststart',
    '-y', inputPath
  ], { encoding: 'utf8', timeout: 30_000 })
  if (generated.error || generated.status !== 0) {
    throw new Error('Gagal membuat fixture video bersuara: ' + (generated.stderr || generated.error?.message || ''))
  }
  return readFile(inputPath)
}

async function makeTestVideoSilent(directory) {
  const inputPath = join(directory, 'silent.mp4')
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=12',
    '-t', '1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-an',
    '-y', inputPath
  ], { encoding: 'utf8', timeout: 30_000 })
  if (generated.error || generated.status !== 0) {
    throw new Error('Gagal membuat fixture video diam: ' + (generated.stderr || generated.error?.message || ''))
  }
  return readFile(inputPath)
}

async function makeTestAudio(directory) {
  const inputPath = join(directory, 'input.ogg')
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
    '-t', '2',
    '-c:a', 'libopus', '-b:a', '64k',
    '-y', inputPath
  ], { encoding: 'utf8', timeout: 30_000 })
  if (generated.error || generated.status !== 0) {
    throw new Error('Gagal membuat fixture audio: ' + (generated.stderr || generated.error?.message || ''))
  }
  return readFile(inputPath)
}

async function makeLongTestAudio(directory, seconds = 35) {
  const inputPath = join(directory, 'long.ogg')
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=660:duration=${seconds}`,
    '-t', String(seconds),
    '-c:a', 'libopus', '-b:a', '64k',
    '-y', inputPath
  ], { encoding: 'utf8', timeout: 30_000 })
  if (generated.error || generated.status !== 0) {
    throw new Error('Gagal membuat fixture audio panjang: ' + (generated.stderr || generated.error?.message || ''))
  }
  return readFile(inputPath)
}

async function probeOggDurationSeconds(directory, buffer) {
  const probePath = join(directory, 'probe.ogg')
  await writeFile(probePath, buffer)
  const probed = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', probePath
  ], { encoding: 'utf8', timeout: 30_000 })
  const seconds = Number((probed.stdout || '').trim())
  if (!Number.isFinite(seconds)) {
    throw new Error('ffprobe tidak bisa membaca durasi Ogg: ' + (probed.stderr || ''))
  }
  return seconds
}

test('Argumen .sa mengikuti format packname|author seperti .s', () => {
  assert.deepEqual(parseStickerAudioArgs('Ibuki - Arisu Soft'), {
    packname: 'Ibuki - Arisu Soft',
    author: ''
  })
  assert.deepEqual(parseStickerAudioArgs('My Pack | Me'), {
    packname: 'My Pack',
    author: 'Me'
  })
  assert.deepEqual(parseStickerAudioArgs(''), { packname: '', author: '' })
})

test('Klasifikasi sumber: reply video, gambar + reply audio, dan penolakan', () => {
  assert.equal(classifyStickerAudioSource({
    directType: '', directMime: '',
    quotedType: 'videoMessage', quotedMime: 'video/mp4'
  }), 'video')
  assert.equal(classifyStickerAudioSource({
    directType: 'videoMessage', directMime: 'video/mp4',
    quotedType: '', quotedMime: ''
  }), 'video')
  // Contoh pertama di screenshot: gambar dibalas ke audio.
  assert.equal(classifyStickerAudioSource({
    directType: 'imageMessage', directMime: 'image/jpeg',
    quotedType: 'audioMessage', quotedMime: 'audio/ogg; codecs=opus'
  }), 'image+audio')
  assert.equal(classifyStickerAudioSource({
    directType: 'imageMessage', directMime: 'image/jpeg',
    quotedType: '', quotedMime: ''
  }), 'image-only')
  assert.equal(classifyStickerAudioSource({
    directType: '', directMime: '',
    quotedType: 'audioMessage', quotedMime: 'audio/ogg'
  }), 'audio-only')
  assert.equal(classifyStickerAudioSource({}), 'unsupported')
})

test('Batas stiker audio .sa: video dan suara maksimal 30 detik', () => {
  assert.equal(stickerAudioLimits.maxSoundSeconds, 30)
  assert.equal(stickerAudioLimits.maxVideoSeconds, 30)
  assert.equal(stickerAudioLimits.maxInputBytes, 25 * 1024 * 1024)
})

test('Proto Baileys yang terpasang membawa audio di StickerMessage (field 26)', () => {
  // Penjaga regresi untuk upgrade Baileys: di 0.3.18-final field ini
  // tidak ada dan encode/decode diam-diam membuangnya, jadi .sa hanya
  // bisa mengirim stiker diam. Di >= 0.4.0 field 26 (tag 0xD2 0x01)
  // bertahan dan stiker suara native bisa dikirim.
  assert.equal(baileysSupportsSoundSticker(), true)
  const encoded = proto.Message.StickerMessage.encode({
    url: 'https://example.invalid/sticker.webp',
    mimetype: 'image/webp',
    audioMessage: {
      url: 'https://example.invalid/audio.ogg',
      mimetype: 'audio/ogg; codecs=opus',
      seconds: 3
    }
  }).finish()
  assert.ok(
    Buffer.from(encoded).includes(Buffer.from([0xD2, 0x01])),
    'field 26 (audioMessage) harus ada di bytes hasil encode'
  )
  const decoded = proto.Message.StickerMessage.decode(encoded)
  assert.equal(decoded.audioMessage?.mimetype, 'audio/ogg; codecs=opus')
  assert.equal(decoded.audioMessage?.seconds, 3)
})

test('sendNativeSoundSticker: satu pesan stiker membawa audioMessage', async () => {
  const prepared = []
  const fakePrepare = async message => {
    prepared.push(message)
    if (message.audio) {
      return { audioMessage: { url: 'https://example.invalid/a.ogg', mimetype: 'audio/ogg; codecs=opus', seconds: 2 } }
    }
    return { stickerMessage: { url: 'https://example.invalid/s.webp', mimetype: 'image/webp', isAnimated: true } }
  }
  let built = null
  const fakeBuild = async (chat, content, options) => {
    built = { chat, content, options }
    return { key: { id: 'native-1' }, message: content }
  }
  const relayed = []
  const conn = {
    waUploadToServer: async () => ({ url: 'https://example.invalid', directPath: '/x' }),
    user: { id: 'bot@s.whatsapp.net' },
    async relayMessage(chat, message, options) { relayed.push({ chat, message, options }) }
  }
  const id = await sendNativeSoundSticker(conn, '123@s.whatsapp.net', {
    stickerBuffer: Buffer.from('webp'),
    audioOgg: Buffer.from('OggS'),
    prepareMedia: fakePrepare,
    buildMessage: fakeBuild
  })
  assert.equal(id, 'native-1')
  assert.equal(Buffer.from(prepared[0].audio).toString('ascii'), 'OggS', 'audio disiapkan dulu')
  assert.ok(prepared[1].sticker, 'lalu stiker disiapkan')
  assert.equal(built.content.stickerMessage.audioMessage?.mimetype, 'audio/ogg; codecs=opus')
  assert.equal(relayed.length, 1)
  assert.equal(relayed[0].message.stickerMessage.audioMessage?.seconds, 2)
  assert.equal(relayed[0].options.messageId, 'native-1')
})

test('sendNativeSoundSticker: tanpa waUploadToServer langsung gagal (pemicu fallback v1)', async () => {
  const conn = { async relayMessage() {} }
  await assert.rejects(
    sendNativeSoundSticker(conn, '123@s.whatsapp.net', {
      stickerBuffer: Buffer.from('webp'),
      audioOgg: Buffer.from('OggS')
    }),
    /waUploadToServer/i
  )
})

test('Audio video bersuara diekstrak jadi Ogg Opus', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const video = await makeTestVideoWithAudio(directory)
    const audio = await extractAudioFromVideoBuffer(video, { maxSeconds: 10 })
    assert.ok(audio.length > 0)
    assert.equal(audio.subarray(0, 4).toString('ascii'), 'OggS')
    assert.ok(audio.length <= stickerAudioLimits.maxAudioOutputBytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Audio panjang dipangkas ke batas 30 detik .sa', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const audio = await makeLongTestAudio(directory, 35)
    const normalized = await normalizeAudioBuffer(audio)
    assert.equal(normalized.subarray(0, 4).toString('ascii'), 'OggS')
    const seconds = await probeOggDurationSeconds(directory, normalized)
    assert.ok(seconds >= 29 && seconds <= 31, `durasi audio harus ~30 detik, dapat ${seconds}`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Video tanpa audio ditolak dengan pesan yang jelas', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const video = await makeTestVideoSilent(directory)
    await assert.rejects(
      extractAudioFromVideoBuffer(video, { maxSeconds: 10 }),
      /tidak memiliki trek audio/i
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Gambar + audio digabung jadi MP4 lalu jadi stiker animasi', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const image = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: { r: 240, g: 80, b: 50, alpha: 1 }
      }
    }).png().toBuffer()
    const audio = await makeTestAudio(directory)
    const normalized = await normalizeAudioBuffer(audio, { maxSeconds: 10 })
    assert.equal(normalized.subarray(0, 4).toString('ascii'), 'OggS')

    const video = await makeVideoFromImageAndAudio(image, audio, { maxSeconds: 10 })
    assert.equal((await fileTypeFromBuffer(video))?.mime, 'video/mp4')

    const sticker = await createStickerFromBuffer(video, {
      mimeHint: 'video/mp4',
      mediaType: 'videoMessage',
      packname: 'Alvareth Audio Test',
      author: 'Sticker Audio Test'
    })
    assert.ok(sticker.length > 0)
    assert.equal((await fileTypeFromBuffer(sticker))?.mime, 'image/webp')
    // Gambar diam memang jadi stiker statis (FFmpeg libwebp_anim
    // menggabungkan frame identik jadi satu frame) — bunyinya dibawa
    // oleh trek audio, seperti stiker suara dari gambar di WhatsApp.
    assert.ok(sticker.length <= 100 * 1024)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Plugin .sa: reply video bersuara mengirim stiker + audio (fallback v1)', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const video = await makeTestVideoWithAudio(directory)
    const { default: handler } = await import('../plugins/sticker/stickeraudio.js')
    const sent = []
    // Fake conn ini sengaja tanpa relayMessage/waUploadToServer, jadi
    // pengiriman native gagal dan plugin menempuh fallback v1
    // (stiker + audio terpisah) — persis jalur yang diuji di sini.
    const conn = {
      async sendMessage(chat, content) {
        sent.push({ chat, content })
        return { key: { id: 'test-' + sent.length } }
      }
    }
    const m = {
      chat: '12345@s.whatsapp.net',
      key: { id: 'msg-1', remoteJid: '12345@s.whatsapp.net' },
      mediaType: 'videoMessage',
      mtype: 'videoMessage',
      mimetype: 'video/mp4',
      msg: { seconds: 2, mimetype: 'video/mp4' },
      quoted: null,
      download: async () => video
    }
    await handler(m, { conn, args: ['Ibuki - Arisu Soft'], usedPrefix: '.', command: 'sa' })

    const stickerMsg = sent.find(item => item.content?.sticker)
    assert.ok(stickerMsg, 'plugin harus mengirim stiker')
    assert.equal(stickerMsg.content.mimetype, 'image/webp')
    assert.equal((await fileTypeFromBuffer(Buffer.from(stickerMsg.content.sticker)))?.mime, 'image/webp')
    const audioMsg = sent.find(item => item.content?.audio)
    assert.ok(audioMsg, 'plugin harus mengirim audio stikernya')
    assert.equal(audioMsg.content.mimetype, 'audio/ogg; codecs=opus')
    assert.equal(Buffer.from(audioMsg.content.audio).subarray(0, 4).toString('ascii'), 'OggS')
    const fallbackNote = sent.find(item => typeof item.content?.text === 'string' && /terpisah/i.test(item.content.text))
    assert.ok(fallbackNote, 'plugin harus jujur kalau native gagal dan audio dikirim terpisah')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Plugin .sa: video 31 detik ditolak dengan batas 30 detik', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const video = await makeTestVideoWithAudio(directory)
    const { default: handler } = await import('../plugins/sticker/stickeraudio.js')
    const sent = []
    const conn = {
      async sendMessage(chat, content) {
        sent.push({ chat, content })
        return { key: { id: 'test-' + sent.length } }
      }
    }
    const m = {
      chat: '12345@s.whatsapp.net',
      key: { id: 'msg-1', remoteJid: '12345@s.whatsapp.net' },
      mediaType: 'videoMessage',
      mtype: 'videoMessage',
      mimetype: 'video/mp4',
      msg: { seconds: 31, mimetype: 'video/mp4' },
      quoted: null,
      download: async () => video
    }
    await handler(m, { conn, args: [], usedPrefix: '.', command: 'sa' })

    assert.ok(sent.find(item => typeof item.content?.text === 'string' && /Maksimal 30 detik/i.test(item.content.text)), 'video 31 detik harus ditolak dengan pesan batas 30 detik')
    assert.equal(sent.find(item => item.content?.sticker), undefined, 'video yang ditolak tidak boleh mengirim stiker')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Plugin .sa: video 30 detik lolos batas dan terkirim', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const video = await makeTestVideoWithAudio(directory)
    const { default: handler } = await import('../plugins/sticker/stickeraudio.js')
    const sent = []
    const conn = {
      async sendMessage(chat, content) {
        sent.push({ chat, content })
        return { key: { id: 'test-' + sent.length } }
      }
    }
    const m = {
      chat: '12345@s.whatsapp.net',
      key: { id: 'msg-1', remoteJid: '12345@s.whatsapp.net' },
      mediaType: 'videoMessage',
      mtype: 'videoMessage',
      mimetype: 'video/mp4',
      msg: { seconds: 30, mimetype: 'video/mp4' },
      quoted: null,
      download: async () => video
    }
    await handler(m, { conn, args: [], usedPrefix: '.', command: 'sa' })

    assert.ok(!sent.find(item => typeof item.content?.text === 'string' && /terlalu panjang/i.test(item.content.text)), 'video 30 detik tidak boleh ditolak')
    assert.ok(sent.find(item => item.content?.sticker), 'video 30 detik harus mengirim stiker')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Plugin .sa: video tanpa audio tetap mengirim stiker + peringatan', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const video = await makeTestVideoSilent(directory)
    const { default: handler } = await import('../plugins/sticker/stickeraudio.js')
    const sent = []
    const conn = {
      async sendMessage(chat, content) {
        sent.push({ chat, content })
        return { key: { id: 'test-' + sent.length } }
      }
    }
    const m = {
      chat: '12345@s.whatsapp.net',
      key: { id: 'msg-2', remoteJid: '12345@s.whatsapp.net' },
      mediaType: 'videoMessage',
      mtype: 'videoMessage',
      mimetype: 'video/mp4',
      msg: { seconds: 1, mimetype: 'video/mp4' },
      quoted: null,
      download: async () => video
    }
    await handler(m, { conn, args: [], usedPrefix: '.', command: 'sa' })
    assert.ok(sent.find(item => item.content?.sticker), 'stiker tetap dikirim untuk video diam')
    assert.ok(!sent.find(item => item.content?.audio), 'tidak ada audio untuk video diam')
    assert.ok(sent.find(item => typeof item.content?.text === 'string' && /tidak ada audionya/i.test(item.content.text)))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test('Video bersuara utuh jadi stiker animasi (jalur .sa utama)', async t => {
  if (!ffmpegAvailable(t)) return
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-test-'))
  try {
    const video = await makeTestVideoWithAudio(directory)
    const audio = await extractAudioFromVideoBuffer(video, { maxSeconds: 10 })
    assert.equal(audio.subarray(0, 4).toString('ascii'), 'OggS')
    const sticker = await createStickerFromBuffer(video, {
      mimeHint: 'video/mp4',
      mediaType: 'videoMessage',
      packname: 'Alvareth Audio Test',
      author: 'Sticker Audio Test'
    })
    assert.ok(sticker.length > 0)
    assert.ok(sticker.length <= 500 * 1024)
    assert.equal((await fileTypeFromBuffer(sticker))?.mime, 'image/webp')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
