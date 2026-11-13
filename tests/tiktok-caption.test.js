import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTikTokCaptionCopy,
  buildTikTokCaptionCopyButton,
  buildTikTokVideoMenuButtons
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

const videoMenuOptions = {
  url: 'https://www.tiktok.com/@alvareth/video/123',
  usedPrefix: '!',
  sourceInfo: { width: 720, height: 1280 }
}

test('menu video memuat pilihan kualitas dan tombol salin caption asli', () => {
  const caption = 'Baris pertama\nBaris  kedua #tiktok'
  const [quality, copy, ...other] = buildTikTokVideoMenuButtons({ ...videoMenuOptions, caption })
  assert.equal(quality.text, 'Pilih Kualitas')
  assert.deepEqual(quality.sections[0].rows.map(row => row.id), [720, 480, 360].map(
    resolution => '!ttquality ' + videoMenuOptions.url + ' ' + resolution
  ))
  assert.equal(copy.name, 'cta_copy')
  assert.equal(JSON.parse(copy.buttonParamsJson).copy_code, caption)
  assert.deepEqual(other, [])
})

test('menu kualitas tetap tersedia untuk video tanpa caption', () => {
  const buttons = buildTikTokVideoMenuButtons({ ...videoMenuOptions, caption: '   ' })
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].text, 'Pilih Kualitas')
})
