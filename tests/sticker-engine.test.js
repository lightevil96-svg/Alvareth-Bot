import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import webp from 'node-webpmux'
import { fileTypeFromBuffer } from 'file-type'
import { createStickerFromBuffer, stickerLimits } from '../plugins/sticker/sticker-engine.js'

test('PNG image becomes a valid 512px WebP sticker with WhatsApp EXIF', async () => {
  const input = await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: { r: 240, g: 80, b: 50, alpha: 1 }
    }
  }).png().toBuffer()

  const output = await createStickerFromBuffer(input, {
    mimeHint: 'image/png',
    mediaType: 'imageMessage',
    packname: 'Alvareth Test',
    author: 'Sticker Test'
  })

  assert.ok(output.length > 0)
  assert.ok(output.length <= stickerLimits.maxStaticStickerBytes)
  assert.deepEqual(await fileTypeFromBuffer(output), {
    ext: 'webp',
    mime: 'image/webp'
  })

  const image = new webp.Image()
  await image.load(output)
  assert.ok(Buffer.isBuffer(image.exif))
  assert.match(image.exif.toString('utf8'), /Alvareth Test/)
  assert.match(image.exif.toString('utf8'), /Sticker Test/)
})

test('MP4 video becomes an animated WebP sticker within the WhatsApp size limit', async t => {
  const version = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (version.error?.code === 'ENOENT') {
    t.skip('FFmpeg tidak tersedia pada runner ini.')
    return
  }

  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-test-'))
  const inputPath = join(directory, 'input.mp4')
  try {
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=12',
      '-t', '1',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', inputPath
    ], { encoding: 'utf8', timeout: 30_000 })

    if (generated.error || generated.status !== 0) {
      t.skip('Runner FFmpeg tidak memiliki encoder H.264 untuk membuat fixture video.')
      return
    }

    const input = await readFile(inputPath)
    const output = await createStickerFromBuffer(input, {
      mimeHint: 'video/mp4',
      mediaType: 'videoMessage',
      packname: 'Alvareth Video Test',
      author: 'Sticker Test'
    })

    assert.ok(output.length > 0)
    assert.ok(output.length <= stickerLimits.maxStickerBytes)
    assert.equal((await fileTypeFromBuffer(output))?.mime, 'image/webp')
    assert.ok(output.includes(Buffer.from('ANIM')), 'hasil video harus berupa WebP animasi')

    const image = new webp.Image()
    await image.load(output)
    assert.ok(Buffer.isBuffer(image.exif))
    assert.match(image.exif.toString('utf8'), /Alvareth Video Test/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Static and animated sticker limits match WhatsApp constraints', () => {
  assert.equal(stickerLimits.maxStaticStickerBytes, 100 * 1024)
  assert.equal(stickerLimits.maxStickerBytes, 500 * 1024)
  assert.equal(stickerLimits.maxVideoSeconds, 10)
})

test('Text or unsupported binary is rejected with a useful error', async () => {
  await assert.rejects(
    createStickerFromBuffer(Buffer.from('not an image or video'), {
      mimeHint: 'text/plain',
      mediaType: 'extendedTextMessage'
    }),
    /Format media tidak didukung/
  )
})

test('Oversized input is rejected before conversion', async () => {
  const input = Buffer.alloc(stickerLimits.maxInputBytes + 1)
  await assert.rejects(
    createStickerFromBuffer(input, { mimeHint: 'image/png', mediaType: 'imageMessage' }),
    /melebihi batas/
  )
})

// Durasi total WebP animasi (ms) dari jumlah durasi tiap frame ANMF.
// ffprobe, sharp, dan node-webpmux tidak melaporkan durasi frame WebP
// animasi, jadi tes ini membaca langsung struktur chunk RIFF WebP: tiap
// chunk 'ANMF' membawa durasi frame 24-bit (ms) di offset 12 payload-nya.
function animatedWebpDurationMs(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Buffer bukan file WebP (RIFF/WEBP).')
  }
  let totalMs = 0
  let frames = 0
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const payloadStart = offset + 8
    if (payloadStart + size > buffer.length) break
    if (id === 'ANMF' && size >= 16) {
      totalMs += buffer[payloadStart + 12] |
        (buffer[payloadStart + 13] << 8) |
        (buffer[payloadStart + 14] << 16)
      frames++
    }
    offset = payloadStart + size + (size % 2)
  }
  if (!frames) throw new Error('WebP animasi tidak punya frame ANMF.')
  return totalMs
}

test('Video 12 detik: default dipangkas 10 detik, opsi maxVideoSeconds 30 mempertahankannya', async t => {
  const version = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (version.error?.code === 'ENOENT') {
    t.skip('FFmpeg tidak tersedia pada runner ini.')
    return
  }

  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-test-'))
  const inputPath = join(directory, 'input.mp4')
  try {
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=12',
      '-t', '12',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', inputPath
    ], { encoding: 'utf8', timeout: 30_000 })

    if (generated.error || generated.status !== 0) {
      t.skip('Runner FFmpeg tidak memiliki encoder H.264 untuk membuat fixture video.')
      return
    }

    const input = await readFile(inputPath)
    const baseOptions = {
      mimeHint: 'video/mp4',
      mediaType: 'videoMessage',
      packname: 'Alvareth Duration Test',
      author: 'Sticker Test'
    }

    const trimmed = await createStickerFromBuffer(input, baseOptions)
    const trimmedMs = animatedWebpDurationMs(Buffer.from(trimmed))
    assert.ok(trimmedMs >= 9500 && trimmedMs <= 10500, `stiker default harus ~10 detik, dapat ${trimmedMs} ms`)

    const full = await createStickerFromBuffer(input, { ...baseOptions, maxVideoSeconds: 30 })
    const fullMs = animatedWebpDurationMs(Buffer.from(full))
    assert.ok(fullMs >= 11500 && fullMs <= 12500, `stiker maxVideoSeconds 30 harus ~12 detik, dapat ${fullMs} ms`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Opsi maxStickerBytes 25 MB membiarkan stiker di atas 500 KB lolos', async t => {
  const version = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (version.error?.code === 'ENOENT') {
    t.skip('FFmpeg tidak tersedia pada runner ini.')
    return
  }

  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-test-'))
  const inputPath = join(directory, 'input.mp4')
  try {
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=12',
      '-t', '12',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', inputPath
    ], { encoding: 'utf8', timeout: 30_000 })

    if (generated.error || generated.status !== 0) {
      t.skip('Runner FFmpeg tidak memiliki encoder H.264 untuk membuat fixture video.')
      return
    }

    const input = await readFile(inputPath)
    const baseOptions = {
      mimeHint: 'video/mp4',
      mediaType: 'videoMessage',
      packname: 'Alvareth Size Test',
      author: 'Sticker Test'
    }

    // Default: mesin menurunkan profil sampai muat 500 KB.
    const capped = await createStickerFromBuffer(input, baseOptions)
    assert.ok(capped.length <= stickerLimits.maxStickerBytes, `stiker default harus <= 500 KB, dapat ${capped.length} byte`)

    // Opsi .sa: profil pertama (fps 10) langsung dipakai meski di atas 500 KB.
    // maxVideoSeconds 30 supaya klip 12 detik tidak terpotong default 10 detik.
    const big = await createStickerFromBuffer(input, { ...baseOptions, maxVideoSeconds: 30, maxStickerBytes: 25 * 1024 * 1024 })
    assert.ok(big.length > stickerLimits.maxStickerBytes, `stiker 25 MB harus boleh di atas 500 KB, dapat ${big.length} byte`)
    const bigMs = animatedWebpDurationMs(Buffer.from(big))
    assert.ok(bigMs >= 11500 && bigMs <= 12500, `stiker 25 MB harus tetap ~12 detik, dapat ${bigMs} ms`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
