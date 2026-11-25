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

// Info WebP animasi: ukuran kanvas (dari chunk VP8X), jumlah frame dan
// durasi total (dari chunk ANMF). ffprobe, sharp, dan node-webpmux tidak
// melaporkan durasi frame WebP animasi, jadi tes ini membaca langsung
// struktur chunk RIFF WebP: tiap chunk 'ANMF' membawa durasi frame 24-bit
// (ms) di offset 12 payload-nya.
function animatedWebpInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Buffer bukan file WebP (RIFF/WEBP).')
  }
  let width = null
  let height = null
  let totalMs = 0
  let frames = 0
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const payloadStart = offset + 8
    if (payloadStart + size > buffer.length) break
    if (id === 'VP8X' && size >= 10) {
      width = buffer.readUIntLE(payloadStart + 4, 3) + 1
      height = buffer.readUIntLE(payloadStart + 7, 3) + 1
    }
    if (id === 'ANMF' && size >= 16) {
      totalMs += buffer[payloadStart + 12] |
        (buffer[payloadStart + 13] << 8) |
        (buffer[payloadStart + 14] << 16)
      frames++
    }
    offset = payloadStart + size + (size % 2)
  }
  if (!frames) throw new Error('WebP animasi tidak punya frame ANMF.')
  return { width, height, frames, durationMs: totalMs }
}

function animatedWebpDurationMs(buffer) {
  return animatedWebpInfo(buffer).durationMs
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

test('Opsi maxStickerBytes 25 MB tidak mematikan kompresi', async t => {
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

    // Opsi .sa: tetap dikompres seperti biasa (muat 500 KB), bukan profil
    // pertama yang langsung dipakai. maxVideoSeconds 30 supaya klip 12 detik
    // tidak terpotong default 10 detik.
    const big = await createStickerFromBuffer(input, { ...baseOptions, maxVideoSeconds: 30, maxStickerBytes: 25 * 1024 * 1024 })
    assert.ok(big.length <= stickerLimits.maxStickerBytes, `stiker 25 MB harus tetap dikompres sampai <= 500 KB bila muat, dapat ${big.length} byte`)
    const bigMs = animatedWebpDurationMs(Buffer.from(big))
    assert.ok(bigMs >= 11500 && bigMs <= 12500, `stiker 25 MB harus tetap ~12 detik, dapat ${bigMs} ms`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Opsi maxStickerBytes 25 MB hanya jadi batas darurat bila profil terkecil pun di atas 500 KB', async t => {
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
      '-f', 'lavfi', '-i', 'testsrc2=size=320x320:rate=12',
      '-t', '30',
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
      maxVideoSeconds: 30,
      packname: 'Alvareth Size Test',
      author: 'Sticker Test'
    }

    // Klip 30 detik yang ramai: profil terkecil pun masih di atas 500 KB,
    // jadi batas default menolaknya.
    await assert.rejects(
      () => createStickerFromBuffer(input, baseOptions),
      /Batas maksimal stiker adalah 500 KB/
    )

    // Dengan batas .sa 25 MB, profil terkecil yang sama dikirim, bukan ditolak.
    const big = await createStickerFromBuffer(input, { ...baseOptions, maxStickerBytes: 25 * 1024 * 1024 })
    assert.ok(big.length > stickerLimits.maxStickerBytes, `stiker darurat harus di atas 500 KB, dapat ${big.length} byte`)
    assert.ok(big.length <= 25 * 1024 * 1024, `stiker darurat harus <= 25 MB, dapat ${big.length} byte`)
    const bigMs = animatedWebpDurationMs(Buffer.from(big))
    assert.ok(bigMs >= 29000 && bigMs <= 31000, `stiker darurat harus tetap ~30 detik, dapat ${bigMs} ms`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Opsi size 720 + maxFps 30 (eksperimen .sa) menghasilkan stiker 720x720 ~30 fps', async t => {
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
      // Sumber HARUS 30 fps: filter fps=30 memang menduplikasi frame dari
      // sumber yang lebih lambat, tapi encoder libwebp_anim menggabungkan
      // lagi frame duplikat yang identik, jadi fps stiker tidak pernah
      // melebihi fps video sumber (dibuktikan eksperimen: sumber 12 fps
      // tetap 24 frame meski difilter fps=30, sumber 30 fps jadi 60 frame).
      '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=30',
      '-t', '2',
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
      maxVideoSeconds: 30,
      maxStickerBytes: 25 * 1024 * 1024,
      targetBytes: 25 * 1024 * 1024,
      size: 720,
      maxFps: 30,
      packname: 'Alvareth 720p Test',
      author: 'Sticker Test'
    })

    assert.ok(output.length <= 25 * 1024 * 1024, `stiker 720p harus <= 25 MB, dapat ${output.length} byte`)
    const info = animatedWebpInfo(Buffer.from(output))
    assert.equal(info.width, 720, `lebar kanvas harus 720, dapat ${info.width}`)
    assert.equal(info.height, 720, `tinggi kanvas harus 720, dapat ${info.height}`)
    assert.ok(info.durationMs >= 1900 && info.durationMs <= 2100, `stiker harus ~2 detik, dapat ${info.durationMs} ms`)
    const fps = info.frames / (info.durationMs / 1000)
    assert.ok(fps >= 28 && fps <= 32, `stiker harus ~30 fps, dapat ${fps.toFixed(1)} fps (${info.frames} frame)`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Opsi size 360 + maxFps 30 (eksperimen .sa saat ini) muat 500 KB pada 30 fps', async t => {
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
      // Sumber HARUS 30 fps (lihat catatan pada tes 720p): encoder
      // libwebp_anim menggabungkan frame duplikat, jadi fps stiker tidak
      // pernah melebihi fps video sumber.
      '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=30',
      '-t', '2',
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
    // Tanpa targetBytes: target kompresi default 480 KB (seperti .sa
    // sekarang) — stiker pendek 360p harus muat 500 KB pada 30 fps.
    const output = await createStickerFromBuffer(input, {
      mimeHint: 'video/mp4',
      mediaType: 'videoMessage',
      maxVideoSeconds: 30,
      maxStickerBytes: 25 * 1024 * 1024,
      size: 360,
      maxFps: 30,
      packname: 'Alvareth 360p Test',
      author: 'Sticker Test'
    })

    assert.ok(output.length <= stickerLimits.maxStickerBytes, `stiker 360p harus <= 500 KB, dapat ${output.length} byte`)
    const info = animatedWebpInfo(Buffer.from(output))
    assert.equal(info.width, 360, `lebar kanvas harus 360, dapat ${info.width}`)
    assert.equal(info.height, 360, `tinggi kanvas harus 360, dapat ${info.height}`)
    assert.ok(info.durationMs >= 1900 && info.durationMs <= 2100, `stiker harus ~2 detik, dapat ${info.durationMs} ms`)
    const fps = info.frames / (info.durationMs / 1000)
    assert.ok(fps >= 28 && fps <= 32, `stiker harus ~30 fps, dapat ${fps.toFixed(1)} fps (${info.frames} frame)`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Mode keepSourceFps: fps mengikuti video sumber, hanya kualitas yang turun', async t => {
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
      '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=30',
      '-t', '6',
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
      maxVideoSeconds: 30,
      maxStickerBytes: 25 * 1024 * 1024,
      size: 360,
      packname: 'Alvareth FPS Test',
      author: 'Sticker Test'
    }

    // Tanpa keepSourceFps, mesin menurunkan fps sampai muat 500 KB.
    const dropped = await createStickerFromBuffer(input, baseOptions)
    const droppedInfo = animatedWebpInfo(Buffer.from(dropped))
    const droppedFps = droppedInfo.frames / (droppedInfo.durationMs / 1000)
    assert.ok(droppedFps >= 9 && droppedFps <= 11, `stiker default harus ~10 fps, dapat ${droppedFps.toFixed(1)} fps`)

    // Dengan keepSourceFps (.sa saat ini), fps tetap 30 dan hanya kualitas
    // yang turun: klip 6 detik yang ramai ini tidak muat 500 KB di kualitas
    // mana pun, jadi yang dikirim adalah profil kualitas terendah — di atas
    // 500 KB tapi tetap 30 fps, di bawah batas darurat 25 MB.
    const kept = await createStickerFromBuffer(input, { ...baseOptions, maxFps: 30, keepSourceFps: true })
    const keptInfo = animatedWebpInfo(Buffer.from(kept))
    assert.equal(keptInfo.width, 360, `lebar kanvas harus 360, dapat ${keptInfo.width}`)
    assert.ok(keptInfo.durationMs >= 5900 && keptInfo.durationMs <= 6100, `stiker harus ~6 detik, dapat ${keptInfo.durationMs} ms`)
    const keptFps = keptInfo.frames / (keptInfo.durationMs / 1000)
    assert.ok(keptFps >= 28 && keptFps <= 32, `stiker keepSourceFps harus ~30 fps, dapat ${keptFps.toFixed(1)} fps (${keptInfo.frames} frame)`)
    assert.ok(kept.length > stickerLimits.maxStickerBytes, `stiker keepSourceFps harus melewati 500 KB bila tidak muat (kualitas terendah), dapat ${kept.length} byte`)
    assert.ok(kept.length <= 25 * 1024 * 1024, `stiker keepSourceFps harus <= 25 MB, dapat ${kept.length} byte`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
