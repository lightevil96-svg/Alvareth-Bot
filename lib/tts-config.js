export const MAX_TTS_CHARACTERS = 5000
export const DEFAULT_TTS_PROFILE = 'female'

export const TTS_VOICE_PROFILES = Object.freeze({
  female: Object.freeze({ voice: 'id-ID-GadisNeural', lang: 'id-ID', label: 'Gadis Neural (Indonesia, perempuan)', rate: '-5%' }),
  male: Object.freeze({ voice: 'id-ID-ArdiNeural', lang: 'id-ID', label: 'Ardi Neural (Indonesia, laki-laki)', rate: '-5%' }),
  'english-female': Object.freeze({ voice: 'en-US-AriaNeural', lang: 'en-US', label: 'Aria Neural (English, female)', rate: '-5%' }),
  'english-male': Object.freeze({ voice: 'en-US-GuyNeural', lang: 'en-US', label: 'Guy Neural (English, male)', rate: '-5%' }),
  'japanese-female': Object.freeze({ voice: 'ja-JP-NanamiNeural', lang: 'ja-JP', label: 'Nanami Neural (Japanese, female)', rate: '-5%' }),
  'japanese-male': Object.freeze({ voice: 'ja-JP-KeitaNeural', lang: 'ja-JP', label: 'Keita Neural (Japanese, male)', rate: '-5%' }),
  'javanese-female': Object.freeze({ voice: 'jv-ID-SitiNeural', lang: 'jv-ID', label: 'Siti Neural (Jawa, perempuan)', rate: '-5%' }),
  'javanese-male': Object.freeze({ voice: 'jv-ID-DimasNeural', lang: 'jv-ID', label: 'Dimas Neural (Jawa, laki-laki)', rate: '-5%' })
})

const VOICE_ALIASES = Object.freeze({
  wanita: 'female', perempuan: 'female', cewek: 'female', female: 'female', gadis: 'female',
  'id-id-gadisneural': 'female',
  pria: 'male', laki: 'male', 'laki-laki': 'male', cowok: 'male', male: 'male', ardi: 'male',
  'id-id-ardineural': 'male',
  en: 'english-female', english: 'english-female', inggris: 'english-female', aria: 'english-female',
  'en-us-arianeural': 'english-female',
  enmale: 'english-male', englishmale: 'english-male', 'inggris-pria': 'english-male', guy: 'english-male',
  'en-us-guyneural': 'english-male',
  jp: 'japanese-female', jepang: 'japanese-female', japanese: 'japanese-female', nanami: 'japanese-female',
  'ja-jp-nanamineural': 'japanese-female',
  jpmale: 'japanese-male', jepangpria: 'japanese-male', keita: 'japanese-male',
  'ja-jp-keitaneural': 'japanese-male',
  jawa: 'javanese-female', jv: 'javanese-female', siti: 'javanese-female',
  'jawa-pria': 'javanese-male', jawapria: 'javanese-male', dimas: 'javanese-male',
  'jv-id-sitineural': 'javanese-female', 'jv-id-dimasneural': 'javanese-male'
})

export function parseTtsRequest(rawText) {
  const input = String(rawText ?? '').trim()
  if (!input) return { action: 'help' }
  if (/^(list|listsuara|voices|suara)$/i.test(input)) return { action: 'list' }
  const match = input.match(/^([^\s|]+)(?:\s*\|\s*|\s+)([\s\S]+)$/)
  if (match) {
    const profile = VOICE_ALIASES[match[1].trim().toLowerCase()]
    if (profile) return { action: 'synthesize', profile, text: match[2].trim() }
  }
  const detectedProfile = /[\u3040-\u30ff]/.test(input) ? 'japanese-female' : DEFAULT_TTS_PROFILE
  return { action: 'synthesize', profile: detectedProfile, text: input }
}

export function getTtsVoiceList() {
  return [
    '🎙️ *Suara Neural Alvareth*', '',
    '🇮🇩 *Bahasa Indonesia*', '• wanita / perempuan / gadis', '• pria / laki / ardi', '',
    '🇺🇸 *Bahasa Inggris*', '• en / english / aria', '• enmale / guy', '',
    '🇯🇵 *Bahasa Jepang*', '• jp / jepang / nanami', '• jpmale / keita', '',
    '🇮🇩 *Bahasa Jawa*', '• jawa / jv / siti', '• jawa-pria / jawapria / dimas', '',
    'Contoh penggunaan:',
    '• .tts Halo, selamat datang di Alvareth.',
    '• .tts pria|Halo semuanya.',
    '• .tts wanita|Selamat pagi.',
    '• .tts en|Welcome to our channel.',
    '• .tts jepang|こんにちは。',
    '• .tts jawa|Sugeng enjing.',
    '',
    'Kecepatan narasi disetel sedikit lebih tenang untuk hasil voiceover.'
  ].join('\n')
}
