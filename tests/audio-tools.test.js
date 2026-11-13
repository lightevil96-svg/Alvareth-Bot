import test from 'node:test'
import assert from 'node:assert/strict'
import { AUDIO_EFFECTS, AUDIO_ALIASES, normalizeAudioEffect, convertAudio } from '../lib/audio-tools.js'
import { createZetaPayload } from '../plugins/audio/zeta.js'

test('all advertised audio effects have non-empty FFmpeg filters', () => {
  assert.equal(Object.keys(AUDIO_EFFECTS).length, 20)
  for (const [name, filter] of Object.entries(AUDIO_EFFECTS)) {
    assert.ok(filter.trim(), name + ' must have a filter')
  }
})

test('audio aliases resolve to supported effects', () => {
  for (const [alias, target] of Object.entries(AUDIO_ALIASES)) {
    assert.equal(normalizeAudioEffect(alias), target)
    assert.ok(AUDIO_EFFECTS[target])
  }
})

test('Zeta Voice payload contains the submitted audio and expected options', () => {
  const audio = Buffer.from('audio fixture')
  const payload = createZetaPayload(audio, 'test-session')
  assert.equal(payload.fn_index, 0)
  assert.equal(payload.session_hash, 'test-session')
  assert.equal(Buffer.from(payload.data[0].data.split(',')[1], 'base64').toString(), audio.toString())
  assert.equal(payload.data[6], 'en-US-AnaNeural-Female')
})

test('FFmpeg conversion rejects empty input clearly', async () => {
  await assert.rejects(convertAudio(Buffer.alloc(0)), /tidak valid/i)
})
