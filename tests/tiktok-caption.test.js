import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTikTokCaptionCopy,
  buildTikTokCaptionCopyButton
} from '../lib/tiktok-workflow.js'

test('buildTikTokCaptionCopy mengembalikan null bila caption kosong', () => {
  assert.equal(buildTikTokCaptionCopy(''), null)
  assert.equal(buildTikTokCaptionCopy('   '), null)
  assert.equal(buildTikTokCaptionCopy(null), null)
})

test('buildTikTokCaptionCopy mempertahankan caption pendek apa adanya', () => {
  const result = buildTikTokCaptionCopy('  anime edit fyp #fyp  ')
  assert.deepEqual(result, {
    displayText: 'anime edit fyp #fyp',
    copyText: 'anime edit fyp #fyp'
  })
})

test('buildTikTokCaptionCopy memotong tampilan di 2000 dan salinan di 4000 karakter', () => {
  const long = 'a'.repeat(5000)
  const result = buildTikTokCaptionCopy(long)
  assert.equal(result.displayText.length, 2000)
  assert.ok(result.displayText.endsWith('...'))
  assert.equal(result.copyText.length, 4000)
  assert.ok(result.copyText.endsWith('...'))
  assert.ok(result.copyText.startsWith('a'.repeat(100)))
})

test('buildTikTokCaptionCopyButton membuat tombol cta_copy yang valid', () => {
  const button = buildTikTokCaptionCopyButton('anime edit fyp')
  assert.equal(button.name, 'cta_copy')
  const params = JSON.parse(button.buttonParamsJson)
  assert.equal(params.display_text, '📋 Salin Caption')
  assert.equal(params.copy_code, 'anime edit fyp')
})

test('buildTikTokCaptionCopyButton memakai string kosong bila tidak ada teks', () => {
  const params = JSON.parse(buildTikTokCaptionCopyButton('').buttonParamsJson)
  assert.equal(params.copy_code, '')
})
