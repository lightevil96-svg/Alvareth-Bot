import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { generateWAMessageFromContent, prepareWAMessageMedia, proto } from 'baileys'

// Sticker Audio (.sa / .stickeraudio) — shared helpers.
//
// Usage the owner asked for: reply to a video with `.sa` (or send a video
// with caption `.sa`). The video's picture becomes an animated WebP sticker
// through plugins/sticker/sticker-engine.js and its sound is extracted here
// and sent as the audio that belongs to that sticker.
//
// Native sound sticker (v2, 2026-11-25): one stickerMessage that plays
// sound when tapped, speaker icon on the sticker — the format WhatsApp
// itself rolled out on beta Android 2.26.47.1. It is encoded as
// `StickerMessage.audioMessage` (field 26, tag 0xD2 0x01), an AudioMessage
// nested inside the sticker message. That field only exists in
// @itsliaaa/baileys >= 0.4.0; on 0.3.18-final the proto has no such field
// and silently drops it, which is why v1 could only send the sticker and
// its audio as two separate messages. The send step lives in
// sendNativeSoundSticker() below and follows the same pattern as
// plugins/sticker/sprem.js: prepareWAMessageMedia with the socket's
// waUploadToServer, then generateWAMessageFromContent + relayMessage.
// When the native send fails (old Baileys, no relay/upload on the
// connection, upload error), the plugin falls back to the v1 behaviour
// (sticker + separate audio) and says so in chat instead of sending a
// silent sticker.
//
// Limits follow the existing sticker rules and the reported sound-sticker
// caps: video stickers for `.sa` carry at most 30 seconds
// (stickerAudioLimits.maxVideoSeconds, passed to the sticker engine —
// the shared `.s` default stays 10 seconds), and their sound is trimmed
// to the sticker's own length, capped at 30 seconds of audio. The sticker
// file cap for `.sa` is raised to 25 MB (stickerAudioLimits.maxStickerBytes):
// that deliberately exceeds WhatsApp's official 500 KB animated-sticker
// spec, so a sticker over 500 KB may be rejected by WhatsApp itself —
// the live test decides. The shared `.s` default stays 500 KB.

export const MAX_SOUND_SECONDS = 30
export const MAX_VIDEO_SECONDS = 30
export const MAX_STICKER_BYTES = 25 * 1024 * 1024
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
  maxVideoSeconds: MAX_VIDEO_SECONDS,
  maxStickerBytes: MAX_STICKER_BYTES,
  maxAudioOutputBytes: MAX_AUDIO_OUTPUT_BYTES,
  maxInputBytes: MAX_INPUT_BYTES
})

/**
 * Does the installed Baileys proto carry audio on StickerMessage? The
 * native sound-sticker encoding is `StickerMessage.audioMessage`
 * (field 26). On @itsliaaa/baileys 0.3.18-final the field does not exist
 * and encode/decode silently drops it, so this returns false there and
 * the plugin must fall back to sticker + separate audio.
 */
export function baileysSupportsSoundSticker() {
  try {
    const encoded = proto.Message.StickerMessage.encode({
      audioMessage: { mimetype: 'audio/ogg; codecs=opus' }
    }).finish()
    return !!proto.Message.StickerMessage.decode(encoded).audioMessage
  } catch {
    return false
  }
}

/**
 * Send one NATIVE WhatsApp sound sticker: a single stickerMessage whose
 * `audioMessage` field (field 26) carries the Opus/Ogg audio, so the
 * recipient sees the speaker icon on the sticker and taps it to hear
 * the sound — the same message the official app sends.
 *
 * Same send pattern as plugins/sticker/sprem.js: prepareWAMessageMedia
 * with the socket's waUploadToServer, then generateWAMessageFromContent
 * + relayMessage. Nothing is sent until both media are prepared, so a
 * failure here is safe to fall back from (the caller sends the v1
 * sticker + separate audio instead).
 *
 * `prepareMedia` / `buildMessage` are injectable so tests can run
 * without a WhatsApp connection.
 */
export async function sendNativeSoundSticker(conn, chat, {
  stickerBuffer,
  audioOgg,
  prepareMedia = prepareWAMessageMedia,
  buildMessage = generateWAMessageFromContent
} = {}) {
  if (!conn || typeof conn.relayMessage !== 'function') {
    throw new Error('Koneksi WhatsApp tidak menyediakan relayMessage untuk stiker suara native.')
  }
  const upload = conn.waUploadToServer
  if (typeof upload !== 'function') {
    throw new Error('Baileys yang dipakai bot tidak menyediakan waUploadToServer untuk stiker suara native.')
  }
  if (!baileysSupportsSoundSticker()) {
    throw new Error('Proto Baileys yang terpasang tidak punya field audio di StickerMessage (butuh @itsliaaa/baileys >= 0.4.0).')
  }
  if (!Buffer.isBuffer(stickerBuffer) || !stickerBuffer.length) throw new TypeError('Data stiker bukan Buffer.')
  if (!Buffer.isBuffer(audioOgg) || !audioOgg.length) throw new TypeError('Data audio bukan Buffer.')
  const mediaOptions = { upload, jid: chat }
  const { audioMessage } = await prepareMedia(
    { audio: audioOgg, mimetype: 'audio/ogg; codecs=opus' },
    mediaOptions
  )
  if (!audioMessage) throw new Error('Audio stiker tidak berhasil disiapkan.')
  const { stickerMessage } = await prepareMedia(
    { sticker: stickerBuffer, mimetype: 'image/webp' },
    mediaOptions
  )
  if (!stickerMessage) throw new Error('Stiker tidak berhasil disiapkan.')
  stickerMessage.audioMessage = audioMessage
  const msg = await buildMessage(chat, { stickerMessage }, { userJid: conn.user?.id })
  await conn.relayMessage(chat, msg.message, { messageId: msg.key.id })
  return msg.key?.id
}
