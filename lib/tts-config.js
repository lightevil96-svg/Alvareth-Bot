export const MAX_TTS_CHARACTERS = 5000
export const DEFAULT_TTS_PROFILE = 'female'

export const TTS_VOICE_PROFILES = Object.freeze({
  female: Object.freeze({
    voice: 'id-ID-GadisNeural',
    lang: 'id-ID',
    label: 'Gadis Neural (Indonesia, perempuan)',
    rate: '-5%'
  }),
  male: Object.freeze({
    voice: 'id-ID-ArdiNeural',
    lang: 'id-ID',
    label: 'Ardi Neural (Indonesia, laki-laki)',
    rate: '-5%'
  }),
  'english-female': Object.freeze({
    voice: 'en-US-AriaNeural',
    lang: 'en-US',
    label: 'Aria Neural (English, female)',
    rate: '-5%'
  }),
  'english-male': Object.freeze({
    voice: 'en-US-GuyNeural',
    lang: 'en-US',
    label: 'Guy Neural (English, male)',
    rate: '-5%'
  })
})

const VOICE_ALIASES = Object.freeze({
  wanita: 'female',
  perempuan: 'female',
  cewek: 'female',
  female: 'female',
  gadis: 'female',
  'id-id-gadisneural': 'female',
  pria: 'male',
  laki: 'male',
  'laki-laki': 'male',
  cowok: 'male',
  male: 'male',
  ardi: 'male',
  'id-id-ardineural': 'male',
  en: 'english-female',
  english: 'english-female',
  inggris: 'english-female',
  aria: 'english-female',
  'en-us-arianeural': 'english-female',
  enmale: 'english-male',
  englishmale: 'english-male',
  'inggris-pria': 'english-male',
  guy: 'english-male',
  'en-us-guyneural': 'english-male'
})

export function parseTtsRequest(rawText) {
  const input = String(rawText ?? '').trim()
  if (!input) return { action: 'help' }
  if (/^(list|listsuara|voices|suara)$/i.test(input)) return { action: 'list' }

  const match = input.match(/^([^\s|]+)(?:\s*\|\s*|\s+)([\s\S]+)$/)
  if (match) {
    const profile = VOICE_ALIASES[match[1].trim().toLowerCase()]
    if (profile) {
      return {
        action: 'synthesize',
        profile,
        text: match[2].trim()
      }
    }
  }

  return {
    action: 'synthesize',
    profile: DEFAULT_TTS_PROFILE,
    text: input
  }
}

export function getTtsVoiceList() {
  return [
    '🎙️ *Suara Neural Alvareth*',
    '',
    '🇮🇩 *Bahasa Indonesia*',
    '• wanita / perempuan / gadis',
    '• pria / laki / ardi',
    '',
    '🇺🇸 *Bahasa Inggris*',
    '• en / english / aria',
    '• enmale / guy',
    '',
    'Contoh penggunaan:',
    '• .tts Halo, selamat datang di Alvareth.',
    '• .tts pria|Halo semuanya.',
    '• .tts wanita|Selamat pagi.',
    '• .tts en|Welcome to our channel.',
    '',
    'Kecepatan narasi disetel sedikit lebih tenang untuk hasil voiceover.'
  ].join('\n')
}
