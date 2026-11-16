import { EdgeTTS } from 'node-edge-tts'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  splitTtsText,
  TTS_VOICE_PROFILES,
  DEFAULT_TTS_PROFILE
} from './tts-config.js'

const TTS_TIMEOUT_MS = 90_000

async function mergeAudioChunks(directory, chunkCount, outputPath) {
  const listPath = join(directory, 'concat-list.txt')
  const entries = Array.from({ length: chunkCount }, (_, index) =>
    "file 'chunk-" + String(index + 1).padStart(5, '0') + ".mp3'"
  )
  await writeFile(listPath, entries.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })

  await new Promise((resolve, reject) => {
    let settled = false
    let stderr = ''
    let child

    const finish = (error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }

    try {
      child = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat-list.txt',
        '-map', '0:a:0',
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', '96k',
        '-ar', '24000',
        '-ac', '1',
        '-f', 'mp3',
        outputPath
      ], {
        cwd: directory,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      finish(new Error('Tidak dapat menjalankan FFmpeg untuk menyatukan voiceover: ' + error.message))
      return
    }

    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    child.once('error', error => {
      finish(new Error('FFmpeg tidak tersedia untuk menyatukan voiceover: ' + error.message))
    })
    child.once('close', (code, signal) => {
      if (code === 0) finish()
      else finish(new Error(
        'FFmpeg gagal menyatukan ' + chunkCount + ' bagian voiceover' +
        (signal ? ' (sinyal ' + signal + ')' : ' (kode ' + code + ')') +
        (stderr.trim() ? ': ' + stderr.trim() : '.')
      ))
    })
  })

  const outputInfo = await stat(outputPath)
  if (!outputInfo.isFile() || outputInfo.size < 1) {
    throw new Error('Penggabungan voiceover menghasilkan file kosong.')
  }
}

export async function synthesizeEdgeTTS(text, profileKey = DEFAULT_TTS_PROFILE) {
  const input = String(text ?? '').trim()
  if (!input) throw new Error('Teks yang akan diubah menjadi suara masih kosong.')

  const chunks = splitTtsText(input)
  if (!chunks.length) throw new Error('Teks yang akan diubah menjadi suara masih kosong.')

  const profile = TTS_VOICE_PROFILES[profileKey] || TTS_VOICE_PROFILES[DEFAULT_TTS_PROFILE]
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-neural-tts-'))
  const outputPath = join(directory, 'voiceover.mp3')

  try {
    const chunkPaths = []

    for (let index = 0; index < chunks.length; index++) {
      const chunkPath = join(directory, 'chunk-' + String(index + 1).padStart(5, '0') + '.mp3')
      const engine = new EdgeTTS({
        voice: profile.voice,
        lang: profile.lang,
        outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
        rate: profile.rate,
        pitch: 'default',
        volume: 'default',
        timeout: TTS_TIMEOUT_MS,
        saveSubtitles: false
      })

      await engine.ttsPromise(chunks[index], chunkPath)
      const chunkInfo = await stat(chunkPath)
      if (!chunkInfo.isFile() || chunkInfo.size < 1) {
        throw new Error('Layanan TTS menghasilkan audio kosong pada bagian ' + (index + 1) + '.')
      }
      chunkPaths.push(chunkPath)
      console.log('[TTS] Bagian voiceover selesai:', index + 1, '/', chunks.length)
    }

    if (chunkPaths.length === 1) {
      return { audio: await readFile(chunkPaths[0]), profile, chunkCount: 1 }
    }

    await mergeAudioChunks(directory, chunkPaths.length, outputPath)
    const audio = await readFile(outputPath)
    if (!audio.length) throw new Error('Layanan TTS menghasilkan file audio kosong.')

    return { audio, profile, chunkCount: chunkPaths.length }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(error => {
      console.warn('[TTS] Gagal membersihkan file sementara:', error.message)
    })
  }
}
