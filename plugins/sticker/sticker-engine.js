import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import webp from 'node-webpmux'
import { fileTypeFromBuffer } from 'file-type'

const MAX_INPUT_BYTES = 25 * 1024 * 1024
const MAX_FFMPEG_OUTPUT_BYTES = 6 * 1024 * 1024
const MAX_STICKER_BYTES = 500 * 1024
const STATIC_TARGET_BYTES = 100 * 1024
const VIDEO_SECONDS = 10

function isWebp(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
}

function runFfmpeg(input, outputArgs, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', 'pipe:0',
      ...outputArgs,
      '-f', 'webp', 'pipe:1'
    ]
    let child
    try {
      child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }

    const chunks = []
    let outputBytes = 0
    let stderr = ''
    let settled = false
    let timer

    const finish = (error, result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }

    timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(new Error('FFmpeg melewati batas waktu 90 detik.'))
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      outputBytes += chunk.length
      if (outputBytes > MAX_FFMPEG_OUTPUT_BYTES) {
        try { child.kill('SIGKILL') } catch {}
        finish(new Error('Ukuran hasil sementara FFmpeg terlalu besar.'))
        return
      }
      chunks.push(Buffer.from(chunk))
    })

    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-6000)
    })

    child.once('error', error => {
      if (error?.code === 'ENOENT') {
        finish(new Error('FFmpeg tidak ditemukan di server. Pasang FFmpeg pada TokoPanel untuk membuat stiker video.'))
      } else {
        finish(new Error('Tidak dapat menjalankan FFmpeg: ' + (error?.message || error)))
      }
    })

    child.once('close', code => {
      if (settled) return
      if (code !== 0) {
        finish(new Error(
          'FFmpeg gagal (kode ' + code + '): ' +
          (stderr.trim() || 'Tidak ada detail dari FFmpeg.').slice(-1400)
        ))
        return
      }
      const result = Buffer.concat(chunks)
      if (!result.length) {
        finish(new Error('FFmpeg selesai tetapi tidak menghasilkan file WebP.'))
        return
      }
      finish(null, result)
    })

    child.stdin.on('error', error => {
      if (error?.code !== 'EPIPE') {
        stderr = (stderr + '\nInput FFmpeg: ' + (error?.message || error)).slice(-6000)
      }
    })
    child.stdin.end(input)
  })
}

const STICKER_FILTER =
  'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,' +
  'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,' +
  'format=yuva420p'

async function encodeStillWithFfmpeg(input) {
  let smallest = null
  let lastError = null

  for (const quality of [75, 60, 45, 32]) {
    try {
      const output = await runFfmpeg(input, [
        '-map', '0:v:0',
        '-frames:v', '1',
        '-vf', STICKER_FILTER,
        '-an', '-sn', '-dn',
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-quality', String(quality),
        '-preset', 'picture',
        '-threads', '1'
      ])
      if (!isWebp(output)) throw new Error('Output FFmpeg bukan file WebP yang valid.')
      if (!smallest || output.length < smallest.length) smallest = output
      if (output.length <= STATIC_TARGET_BYTES) return output
    } catch (error) {
      lastError = error
      if (/FFmpeg tidak ditemukan|Tidak dapat menjalankan FFmpeg|Unknown encoder/i.test(error.message)) break
    }
  }

  if (smallest && smallest.length <= MAX_STICKER_BYTES) return smallest
  if (lastError) throw lastError
  throw new Error('Gambar terlalu besar untuk dikompres menjadi stiker WhatsApp.')
}

async function encodeAnimatedWithFfmpeg(input) {
  let smallest = null
  let lastError = null
  let encoder = 'libwebp_anim'

  const profiles = [
    { fps: 10, quality: 55 },
    { fps: 8, quality: 45 },
    { fps: 6, quality: 35 }
  ]

  for (const profile of profiles) {
    const filter =
      'fps=' + profile.fps + ',' + STICKER_FILTER
    try {
      let output
      try {
        output = await runFfmpeg(input, [
          '-map', '0:v:0',
          '-t', String(VIDEO_SECONDS),
          '-vf', filter,
          '-an', '-sn', '-dn',
          '-c:v', encoder,
          '-lossless', '0',
          '-quality', String(profile.quality),
          '-preset', 'picture',
          '-loop', '0',
          '-threads', '1'
        ])
      } catch (error) {
        // Some FFmpeg builds expose libwebp but not the animation alias.
        if (encoder === 'libwebp_anim' && /Unknown encoder|Encoder .* not found/i.test(error.message)) {
          encoder = 'libwebp'
          output = await runFfmpeg(input, [
            '-map', '0:v:0',
            '-t', String(VIDEO_SECONDS),
            '-vf', filter,
            '-an', '-sn', '-dn',
            '-c:v', encoder,
            '-lossless', '0',
            '-quality', String(profile.quality),
            '-preset', 'picture',
            '-loop', '0',
            '-threads', '1'
          ])
        } else {
          throw error
        }
      }

      if (!isWebp(output)) throw new Error('Output FFmpeg bukan WebP animasi yang valid.')
      if (!smallest || output.length < smallest.length) smallest = output
      if (output.length <= MAX_STICKER_BYTES) return output
    } catch (error) {
      lastError = error
      if (/FFmpeg tidak ditemukan|Tidak dapat menjalankan FFmpeg|Unknown encoder/i.test(error.message)) break
    }
  }

  if (smallest && smallest.length <= MAX_STICKER_BYTES) return smallest
  if (smallest) {
    throw new Error(
      'Hasil stiker video masih ' + Math.ceil(smallest.length / 1024) +
      ' KB setelah kompresi. Batas stiker animasi adalah 500 KB; potong video atau pilih video yang lebih sederhana.'
    )
  }
  if (lastError) throw lastError
  throw new Error('Video tidak dapat dikonversi menjadi WebP animasi.')
}

async function encodeImageWithSharp(input) {
  const sharpModule = await import('sharp')
  const sharp = sharpModule.default || sharpModule
  const metadata = await sharp(input, {
    animated: true,
    failOn: 'error',
    limitInputPixels: 268402689
  }).metadata()
  const animated = Number(metadata.pages || 1) > 1
  const targetBytes = animated ? MAX_STICKER_BYTES : STATIC_TARGET_BYTES
  let smallest = null

  for (const quality of (animated ? [70, 60, 50, 40] : [82, 72, 62, 52, 42, 32])) {
    const output = await sharp(input, {
      animated: true,
      failOn: 'error',
      limitInputPixels: 268402689
    })
      .rotate()
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false
      })
      .webp({
        quality,
        alphaQuality: 80,
        effort: 6,
        smartSubsample: true,
        loop: 0,
        delay: 100
      })
      .toBuffer()

    if (!isWebp(output)) throw new Error('Sharp tidak menghasilkan WebP yang valid.')
    if (!smallest || output.length < smallest.length) smallest = output
    if (output.length <= targetBytes) return output
  }

  if (smallest && smallest.length <= MAX_STICKER_BYTES) return smallest
  if (animated) return encodeAnimatedWithFfmpeg(input)
  return encodeStillWithFfmpeg(input)
}

function createExif(packname, author) {
  const metadata = {
    'sticker-pack-id': randomBytes(16).toString('hex'),
    'sticker-pack-name': String(packname || 'Alvareth Bot').slice(0, 128),
    'sticker-pack-publisher': String(author || '').slice(0, 128),
    emojis: ['']
  }
  const json = Buffer.from(JSON.stringify(metadata), 'utf8')
  const header = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ])
  const exif = Buffer.concat([header, json])
  exif.writeUIntLE(json.length, 14, 4)
  return exif
}

async function attachStickerExif(buffer, packname, author) {
  const image = new webp.Image()
  await image.load(buffer)
  image.exif = createExif(packname, author)
  const output = await image.save(null)
  const result = Buffer.from(output)
  if (!isWebp(result)) throw new Error('Gagal menambahkan metadata stiker WebP.')
  return result
}

/**
 * Convert one downloaded WhatsApp image/video into a WhatsApp-compatible WebP.
 * Conversion is local: no public upload service or third-party sticker API.
 */
export async function createStickerFromBuffer(input, options = {}) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new TypeError('Data media bukan Buffer.')
  }
  const buffer = Buffer.from(input)
  if (!buffer.length) throw new Error('File media kosong.')
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error('Ukuran media ' + Math.ceil(buffer.length / 1024 / 1024) + ' MB melebihi batas 25 MB.')
  }

  const detected = await fileTypeFromBuffer(buffer).catch(() => null)
  const detectedMime = String(detected?.mime || '').toLowerCase()
  const mimeHint = String(options.mimeHint || '').toLowerCase()
  const mediaType = String(options.mediaType || '').toLowerCase()
  const typeHint = detectedMime || mimeHint
  const detectedIsImage = detectedMime.startsWith('image/')
  const detectedIsVideo = detectedMime.startsWith('video/') || detectedMime === 'application/mp4'

  // Trust a recognized file signature first, but keep WhatsApp's media node
  // type as a fallback when file-type cannot identify a less common codec.
  const isVideo = detectedIsVideo ||
    (!detectedIsImage && (
      mimeHint.startsWith('video/') ||
      mimeHint === 'video' ||
      /video|ptv/i.test(mediaType)
    ))
  const isImage = detectedIsImage ||
    (!detectedIsVideo && (
      mimeHint.startsWith('image/') ||
      mimeHint === 'image' ||
      /image/i.test(mediaType)
    ))

  if (!isImage && !isVideo) {
    throw new Error('Format media tidak didukung. Gunakan JPG, PNG, WEBP, GIF, atau video MP4.')
  }

  let webpBuffer
  if (isVideo || detected?.ext === 'gif' || detected?.ext === 'apng') {
    webpBuffer = await encodeAnimatedWithFfmpeg(buffer)
  } else {
    try {
      webpBuffer = await encodeImageWithSharp(buffer)
    } catch (error) {
      console.warn('[STICKER] Sharp gagal; mencoba konversi gambar lokal dengan FFmpeg:', error?.message || error)
      webpBuffer = await encodeStillWithFfmpeg(buffer)
    }
  }

  if (!isWebp(webpBuffer)) {
    throw new Error('Hasil konversi tidak memiliki struktur file WebP yang valid.')
  }

  const finalBuffer = await attachStickerExif(webpBuffer, options.packname, options.author)
  if (finalBuffer.length > MAX_STICKER_BYTES) {
    throw new Error('File stiker akhir melebihi batas 500 KB setelah metadata ditambahkan.')
  }

  return finalBuffer
}

export const stickerLimits = Object.freeze({
  maxInputBytes: MAX_INPUT_BYTES,
  maxStickerBytes: MAX_STICKER_BYTES,
  maxVideoSeconds: VIDEO_SECONDS
})
