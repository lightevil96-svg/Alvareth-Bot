import { spawn } from 'node:child_process'
import { resolveQuotedMediaInfo, downloadQuotedMedia } from './simple.js'

const LIMIT_BYTES = 25 * 1024 * 1024

export const AUDIO_EFFECTS = Object.freeze({
  bass: 'bass=g=12:f=100',
  blown: 'acrusher=bits=8:mix=0.7',
  deep: 'asetrate=44100*0.75,aresample=44100',
  earrape: 'volume=3,alimiter=limit=0.95',
  fast: 'atempo=1.63',
  fat: 'asetrate=44100*0.8,aresample=44100',
  nightcore: 'asetrate=44100*1.25,aresample=44100',
  reverse: 'areverse',
  robot: 'vibrato=f=35:d=0.8,highpass=f=150,lowpass=f=3200',
  slow: 'atempo=0.7',
  smooth: 'acompressor=threshold=-18dB:ratio=3:attack=20:release=250',
  tupai: 'asetrate=44100*1.5,aresample=44100',
  reverb: 'aecho=0.8:0.9:500:0.25',
  chorus: 'chorus=0.7:0.9:55:0.4:0.25:2',
  flanger: 'flanger=delay=10:depth=2',
  distortion: 'acrusher=bits=6:mix=0.7',
  pitch: 'asetrate=44100*1.2,aresample=44100',
  highpass: 'highpass=f=500',
  lowpass: 'lowpass=f=500',
  underwater: 'lowpass=f=300,aecho=0.6:0.5:100:0.2'
})

export const AUDIO_ALIASES = Object.freeze({ squirrel: 'tupai', chipmunk: 'tupai' })
export const normalizeAudioEffect = command => AUDIO_ALIASES[String(command || '').toLowerCase()] || String(command || '').toLowerCase()

const mediaType = (info, source) => {
  const type = String(info?.type || source?.mtype || source?.mediaType || '')
  const mime = String(info?.mime || source?.mimetype || source?.msg?.mimetype || '')
  if (/^(audioMessage|audio)$/i.test(type) || /^audio\//i.test(mime)) return 'audio'
  if (/^(videoMessage|ptvMessage|video|ptv)$/i.test(type) || /^video\//i.test(mime)) return 'video'
  return ''
}

export async function readAudioInput(m, conn, { allowVideo = false } = {}) {
  const quoted = m?.quoted
  const info = await resolveQuotedMediaInfo(m, conn)
  const source = quoted || m
  const type = mediaType(info, info ? null : source)
  if (!type || (type === 'video' && !allowVideo)) return null

  let buffer = null
  if (info) buffer = await downloadQuotedMedia(m, conn)
  if (!buffer && typeof source?.download === 'function') buffer = await source.download()
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new Error('Media gagal diunduh. Kirim ulang file asli lalu reply perintah.')
  }
  buffer = Buffer.from(buffer)
  if (!buffer.length) throw new Error('File audio kosong atau tidak dapat dibaca.')
  if (buffer.length > LIMIT_BYTES) throw new Error('Ukuran media maksimal 25 MB.')
  return { buffer, type }
}

export async function convertAudio(buffer, { filter = null, timeoutMs = 60_000 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Media audio tidak valid.')
  if (buffer.length > LIMIT_BYTES) throw new Error('Ukuran media maksimal 25 MB.')
  const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn']
  if (filter) args.push('-af', filter)
  args.push('-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1')
  return new Promise((resolve, reject) => {
    let settled = false
    let outputBytes = 0
    let stderr = ''
    const chunks = []
    let process
    let timer
    const done = (err, output) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(output)
    }
    try { process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] }) }
    catch (error) { done(new Error(`Tidak bisa menjalankan FFmpeg: ${error.message}`)); return }
    timer = setTimeout(() => {
      process.kill('SIGKILL')
      done(new Error('Pengolahan audio melewati batas waktu. Coba file yang lebih pendek.'))
    }, timeoutMs)
    timer.unref?.()
    process.on('error', error => done(new Error(`FFmpeg tidak tersedia: ${error.message}`)))
    process.stdout.on('data', chunk => {
      outputBytes += chunk.length
      if (outputBytes > LIMIT_BYTES) {
        process.kill('SIGKILL')
        done(new Error('Hasil audio terlalu besar (maksimal 25 MB).'))
      } else chunks.push(chunk)
    })
    process.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1500) })
    process.on('close', code => {
      if (settled) return
      if (code !== 0 || !outputBytes) done(new Error('FFmpeg gagal memproses audio: ' + (stderr.trim() || `kode ${code}`)))
      else done(null, Buffer.concat(chunks))
    })
    process.stdin.on('error', () => {})
    process.stdin.end(buffer)
  })
}
