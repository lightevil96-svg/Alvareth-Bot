import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TTS_PROFILE,
  MAX_TTS_CHARACTERS,
  TTS_VOICE_PROFILES,
  parseTtsRequest,
  getTtsVoiceList
} from '../lib/tts-config.js'

test('plain .tts text uses the Indonesian female neural voice by default', () => {
  const result = parseTtsRequest('Halo, selamat datang.')
  assert.equal(result.action, 'synthesize')
  assert.equal(result.profile, DEFAULT_TTS_PROFILE)
  assert.equal(TTS_VOICE_PROFILES[result.profile].voice, 'id-ID-GadisNeural')
  assert.equal(result.text, 'Halo, selamat datang.')
})

test('Indonesian male and female voice aliases are recognized', () => {
  assert.equal(parseTtsRequest('pria|Halo').profile, 'male')
  assert.equal(parseTtsRequest('laki-laki Halo').profile, 'male')
  assert.equal(parseTtsRequest('ardi|Halo').profile, 'male')
  assert.equal(parseTtsRequest('wanita|Halo').profile, 'female')
  assert.equal(parseTtsRequest('gadis Halo').profile, 'female')
})

test('English neural voices can be selected', () => {
  assert.equal(parseTtsRequest('en|Hello').profile, 'english-female')
  assert.equal(parseTtsRequest('guy|Hello').profile, 'english-male')
  assert.equal(TTS_VOICE_PROFILES['english-female'].voice, 'en-US-AriaNeural')
  assert.equal(TTS_VOICE_PROFILES['english-male'].voice, 'en-US-GuyNeural')
})

test('voice list command and help state are recognized', () => {
  assert.equal(parseTtsRequest('suara').action, 'list')
  assert.equal(parseTtsRequest('').action, 'help')
  assert.match(getTtsVoiceList(), /Bahasa Indonesia/)
  assert.match(getTtsVoiceList(), /enmale/)
})

test('maximum text length is explicit and measured in Unicode code points', () => {
  assert.equal(MAX_TTS_CHARACTERS, 5000)
  assert.equal(Array.from('😀').length, 1)
})
