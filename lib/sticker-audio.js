import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'

// Sticker Audio (.sa / .stickeraudio) — shared helpers.
//
// Usage the owner asked for: reply to a video with `.sa` (or send a video
// with caption `.sa`). The video's picture becomes an animated WebP sticker
// through plugins/sticker/sticker-engine.js and its sound is extracted here
// and sent as the audio that belongs to that sticker.
//
// Honest limitation, checked 2026-11-25: a *native* WhatsApp sound sticker
// (one sticker message that plays sound when tapped, speaker icon on the
// sticker, rolling out on WhatsApp beta for Android 2.26.47.1 per WABetaInfo)
// cannot be sent through this bot yet. The WhatsApp Web protobuf used by
// Baileys — upstream master, WhatsApp Web 2.3000.1029496320 — has no audio
// field on StickerMessage at all (fields 1-23, ending at mediaKeyDomain),
// and the installed @itsliaaa/baileys 0.3.18-final proto is the same.
// So v1 sends two messages that together do the job on every client: the
// animated sticker, then its audio. When Baileys/Web gains a sound-sticker
// field, only the send step in plugins/sticker/stickeraudio.js needs to
// change; the extraction helpers here stay the same.
//
// Limits follow the existing sticker rules and the reported sound-sticker
// caps: video stickers carry at most 10 seconds (stickerLimits), image
// stickers with an added sound at most 10 seconds of audio. The beta
// reports also mention 5 seconds of audio for stickers made from video;
// the audio here is therefore trimmed to the sticker's own length, capped
// at 10 seconds, and the reply text says so.

export const MAX_SOUND_SECONDS = 10
export const MAX_AUDIO_OUTPUT_BYTES = 2 * 1024 * 1024
export const MAX_INPUT_BYTES = 25 * 1024 * 1024

function isOgg(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length >= 4 &&
    buffer.subarray(0, 4).toString('ascii') === 'OggS'
}

function runFfmpeg({ inputs = [], outputArgs, timeoutMs = 60_000, maxOutputBytes = MAX_AUDIO_OUTPUT_BYTES, allowEmptyOutput = false }) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']
    for (const input of inputs) {
      if (Array.isArray(input.argsBefore)) args.push(...input.argsBefore)
      if (input.path) args.push('-i', input.path)
      else args.push('-i', 'pipe:0')
    }
    args.push(...outputArgs)
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
      finish(new Error('FFmpeg melewati batas waktu 60 detik.'))
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) {
        try { child.kill('SIGKILL') } catch {}
        finish(new Error('Hasil audio terlalu besar.'))
        return
      }
      chunks.push(Buffer.from(chunk))
    })

    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-6000)
    })

    child.once('error', error => {
      if (error?.code === 'ENOENT') {
        finish(new Error('FFmpeg tidak ditemukan di server. Pasang FFmpeg pada TokoPanel untuk membuat stiker audio.'))
      } else {
        finish(new Error('Tidak dapat menjalankan FFmpeg: ' + (error?.message || error)))
      }
    })

    child.once('close', code => {
      if (settled) return
      if (code !== 0) {
        const detail = (stderr.trim() || 'Tidak ada detail dari FFmpeg.').slice(-1400)
        if (/does not contain any stream|No audio|no audio stream|Stream map .* matches no streams/i.test(detail)) {
          finish(new Error('Media tidak memiliki trek audio.'))
          return
        }
        finish(new Error('FFmpeg gagal (kode ' + code + '): ' + detail))
        return
      }
      const result = Buffer.concat(chunks)
      if (!result.length && !allowEmptyOutput) {
        finish(new Error('Media tidak memiliki trek audio.'))
        return
      }
      finish(null, result)
    })

    // Only the single-pipe-input case writes to stdin. Multi-file inputs
    // are passed as temp-file paths instead, so stdin is closed at once.
    const piped = inputs.filter(input => !input.path)
    if (piped.length === 1) {
      child.stdin.on('error', error => {
        if (error?.code !== 'EPIPE') {
          stderr = (stderr + '\nInput FFmpeg: ' + (error?.message || error)).slice(-6000)
        }
      })
      child.stdin.end(piped[0].buffer)
    } else {
      child.stdin.end()
    }
  })
}

/**
 * Split the `.sa` / `.stickeraudio` arguments the same way `.s` does:
 * `packname|author`. The screenshot example `/sa Ibuki - Arisu Soft`
 * becomes packname "Ibuki - Arisu Soft" with an empty author.
 */
export function parseStickerAudioArgs(argsText = '') {
  const [packnameRaw, ...authorParts] = String(argsText || '').split('|')
  return {
    packname: (packnameRaw || '').trim(),
    author: authorParts.join('|').trim()
  }
}

const VIDEO_TYPES = new Set(['videoMessage', 'ptvMessage'])
const IMAGE_TYPES = new Set(['imageMessage'])
const AUDIO_TYPES = new Set(['audioMessage'])

function normalizeType(type = '') {
  return String(type || '').replace(/Message$/i, '').toLowerCase()
}

function isType(type, set) {
  return set.has(String(type || ''))
}

function isMime(mime = '', prefix) {
  return String(mime || '').toLowerCase().startsWith(prefix)
}

/**
 * Decide what the user actually sent, from the direct message media and
 * the quoted media (both already normalized by lib/simple.js).
 * Returns one of: 'video' | 'image+audio' | 'image-only' | 'audio-only' |
 * 'unsupported'. Pure function, no I/O, so it is unit-testable.
 */
export function classifyStickerAudioSource({ directType = '', directMime = '', quotedType = '', quotedMime = '' } = {}) {
  const direct = normalizeType(directType)
  const quoted = normalizeType(quotedType)
  const directIsVideo = VIDEO_TYPES.has(directType) || isMime(directMime, 'video/')
  const quotedIsVideo = VIDEO_TYPES.has(quotedType) || isMime(quotedMime, 'video/')
  const directIsImage = IMAGE_TYPES.has(directType) || isMime(directMime, 'image/')
  const quotedIsImage = IMAGE_TYPES.has(quotedType) || isMime(quotedMime, 'image/')
  const directIsAudio = AUDIO_TYPES.has(directType) || isMime(directMime, 'audio/')
  const quotedIsAudio = AUDIO_TYPES.has(quotedType) || isMime(quotedMime, 'audio/')

  if (directIsVideo || quotedIsVideo) return 'video'
  if ((directIsImage && quotedIsAudio) || (quotedIsImage && directIsAudio)) return 'image+audio'
  if (directIsImage || quotedIsImage) return 'image-only'
  if (directIsAudio || quotedIsAudio) return 'audio-only'
  return 'unsupported'
}

/**
 * Extract the audio track of a video (MP4) as Opus in Ogg, trimmed to
 * at most maxSeconds. Throws 'Media tidak memiliki trek audio.' when the
 * video is silent.
 */
export async function extractAudioFromVideoBuffer(input, { maxSeconds = MAX_SOUND_SECONDS } = {}) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new TypeError('Data video bukan Buffer.')
  }
  const buffer = Buffer.from(input)
  if (!buffer.length) throw new Error('File video kosong.')
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error('Ukuran video melebihi batas ' + Math.round(MAX_INPUT_BYTES / 1024 / 1024) + ' MB.')
  }
  const seconds = Number(maxSeconds)
  const capped = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_SOUND_SECONDS) : MAX_SOUND_SECONDS
  const output = await runFfmpeg({
    inputs: [{ buffer }],
    outputArgs: [
      '-map', '0:a:0',
      '-t', String(capped),
      '-map_metadata', '-1',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ac', '1',
      '-ar', '48000',
      '-f', 'ogg', 'pipe:1'
    ]
  })
  if (!isOgg(output)) throw new Error('Hasil ekstraksi audio bukan file Ogg yang valid.')
  return output
}

/**
 * Re-encode any WhatsApp audio (voice note, audio file, MP3/M4A/AAC/OGG)
 * to Opus in Ogg, trimmed to at most maxSeconds. Used for the
 * image + quoted-audio flow.
 */
export async function normalizeAudioBuffer(input, { maxSeconds = MAX_SOUND_SECONDS } = {}) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new TypeError('Data audio bukan Buffer.')
  }
  const buffer = Buffer.from(input)
  if (!buffer.length) throw new Error('File audio kosong.')
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error('Ukuran audio melebihi batas ' + Math.round(MAX_INPUT_BYTES / 1024 / 1024) + ' MB.')
  }
  const seconds = Number(maxSeconds)
  const capped = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_SOUND_SECONDS) : MAX_SOUND_SECONDS
  const output = await runFfmpeg({
    inputs: [{ buffer }],
    outputArgs: [
      '-vn', '-sn', '-dn',
      '-t', String(capped),
      '-map_metadata', '-1',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ac', '1',
      '-ar', '48000',
      '-f', 'ogg', 'pipe:1'
    ]
  })
  if (!isOgg(output)) throw new Error('Hasil konversi audio bukan file Ogg yang valid.')
  return output
}

/**
 * Turn a still image + an audio clip into a short MP4 (max 10 seconds),
 * so the existing sticker engine can turn it into an animated WebP
 * sticker. The MP4 keeps the audio; the sticker engine only uses the
 * picture, the audio itself is sent separately by the plugin.
 */
export async function makeVideoFromImageAndAudio(imageBuffer, audioBuffer, { maxSeconds = MAX_SOUND_SECONDS } = {}) {
  if (!Buffer.isBuffer(imageBuffer) && !(imageBuffer instanceof Uint8Array)) {
    throw new TypeError('Data gambar bukan Buffer.')
  }
  if (!Buffer.isBuffer(audioBuffer) && !(audioBuffer instanceof Uint8Array)) {
    throw new TypeError('Data audio bukan Buffer.')
  }
  const image = Buffer.from(imageBuffer)
  const audio = Buffer.from(audioBuffer)
  if (!image.length) throw new Error('File gambar kosong.')
  if (!audio.length) throw new Error('File audio kosong.')
  const seconds = Number(maxSeconds)
  const capped = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_SOUND_SECONDS) : MAX_SOUND_SECONDS

  const directory = await mkdtemp(join(tmpdir(), 'alvareth-sticker-audio-'))
  const imagePath = join(directory, 'image-' + randomBytes(6).toString('hex'))
  const audioPath = join(directory, 'audio-' + randomBytes(6).toString('hex'))
  const detectedImage = await fileTypeFromBuffer(image).catch(() => null)
  const detectedAudio = await fileTypeFromBuffer(audio).catch(() => null)
  const imageFile = imagePath + '.' + (detectedImage?.ext || 'jpg')
  const audioFile = audioPath + '.' + (detectedAudio?.ext || 'ogg')
  // MP4 muxer needs a seekable output, so it goes to a temp file, not a
  // pipe (faststart also rewrites the header after encoding).
  const outputFile = join(directory, 'output-' + randomBytes(6).toString('hex') + '.mp4')
  try {
    await writeFile(imageFile, image)
    await writeFile(audioFile, audio)
    await runFfmpeg({
      inputs: [
        { path: imageFile, argsBefore: ['-loop', '1', '-framerate', '10'] },
        { path: audioFile }
      ],
      outputArgs: [
        '-t', String(capped),
        '-shortest',
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-r', '10',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        '-map_metadata', '-1',
        '-f', 'mp4', outputFile
      ],
      maxOutputBytes: MAX_INPUT_BYTES,
      allowEmptyOutput: true
    })
    const output = await readFile(outputFile)
    const detected = await fileTypeFromBuffer(output).catch(() => null)
    if (detected?.mime !== 'video/mp4') {
      throw new Error('Hasil gabungan gambar + audio bukan file MP4 yang valid.')
    }
    return output
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

export const stickerAudioLimits = Object.freeze({
  maxSoundSeconds: MAX_SOUND_SECONDS,
  maxAudioOutputBytes: MAX_AUDIO_OUTPUT_BYTES,
  maxInputBytes: MAX_INPUT_BYTES
})
