import { EdgeTTS } from 'node-edge-tts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_TTS_CHARACTERS,
  TTS_VOICE_PROFILES,
  DEFAULT_TTS_PROFILE
} from './tts-config.js'

const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const TTS_TIMEOUT_MS = 90_000

export async function synthesizeEdgeTTS(text, profileKey = DEFAULT_TTS_PROFILE) {
  const input = String(text ?? '').trim()
  if (!input) throw new Error('Teks yang akan diubah menjadi suara masih kosong.')

  const characterCount = Array.from(input).length
  if (characterCount > MAX_TTS_CHARACTERS) {
    throw new Error(`Teks maksimal ${MAX_TTS_CHARACTERS.toLocaleString('id-ID')} karakter per permintaan. Potong naskah menjadi beberapa bagian.`)
  }

  const profile = TTS_VOICE_PROFILES[profileKey] || TTS_VOICE_PROFILES[DEFAULT_TTS_PROFILE]
  const directory = await mkdtemp(join(tmpdir(), 'alvareth-neural-tts-'))
  const outputPath = join(directory, 'voiceover.mp3')

  try {
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

    await engine.ttsPromise(input, outputPath)
    const audio = await readFile(outputPath)

    if (!audio.length) throw new Error('Layanan TTS menghasilkan file audio kosong.')
    if (audio.length > MAX_AUDIO_BYTES) throw new Error('Ukuran hasil audio melebihi batas 20 MB.')

    return { audio, profile }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(error => {
      console.warn('[TTS] Gagal membersihkan file sementara:', error.message)
    })
  }
}
