import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLirikSrt,
  buildLirikText,
  formatLirikTimestamp,
  normalizeLirikResult
} from '../lib/lirik-output.js'

test('formatLirikTimestamp formats hours, minutes, seconds and milliseconds', () => {
  assert.equal(formatLirikTimestamp(0), '00:00:00,000')
  assert.equal(formatLirikTimestamp(65.125), '00:01:05,125')
  assert.equal(formatLirikTimestamp(3661.9), '01:01:01,900')
})

test('normalizeLirikResult removes invalid segments and sorts by timestamp', () => {
  const result = normalizeLirikResult({
    language: 'id',
    segments: [
      { start: 5, end: 6, text: 'Baris kedua', source: 'ON_SCREEN' },
      { start: -1, end: 2, text: 'Invalid' },
      { start: 1, end: 2, text: 'Baris pertama', source: 'AUDIO' },
      { start: 3, end: 3, text: 'Invalid duration' },
      { start: 2, end: 3, text: '   ' }
    ]
  })
  assert.equal(result.language, 'id')
  assert.deepEqual(result.segments.map(item => item.text), ['Baris pertama', 'Baris kedua'])
  assert.equal(result.segments[1].source, 'ON_SCREEN')
})

test('buildLirikText keeps source labels and timestamps', () => {
  const output = buildLirikText({
    language: 'id',
    segments: [
      { start: 1.2, end: 2, text: 'Aku di sini', source: 'AUDIO' },
      { start: 2.2, end: 3, text: 'Kau di sana', source: 'ON_SCREEN' }
    ]
  })
  assert.match(output, /Bahasa: id/)
  assert.match(output, /\[00:00:01\] \[AUDIO\] Aku di sini/)
  assert.match(output, /\[00:00:02\] \[LAYAR\] Kau di sana/)
})

test('buildLirikSrt emits valid ordered cues', () => {
  const output = buildLirikSrt({
    segments: [
      { start: 2, end: 3, text: 'Baris dua', source: 'ON_SCREEN' },
      { start: 0.5, end: 1.5, text: 'Baris satu', source: 'AUDIO' }
    ]
  })
  assert.match(output, /1\n00:00:00,500 --> 00:00:01,500\n\[AUDIO\] Baris satu/)
  assert.match(output, /2\n00:00:02,000 --> 00:00:03,000\n\[LAYAR\] Baris dua/)
})

test('empty transcript remains exportable and explains missing text', () => {
  assert.match(buildLirikText({ segments: [] }), /Tidak ada teks yang berhasil dikenali/)
  assert.equal(buildLirikSrt({ segments: [] }), '')
})
