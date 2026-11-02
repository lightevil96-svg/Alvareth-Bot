import test from 'node:test'
import assert from 'node:assert/strict'
import { createClipProgress, formatClipProgress } from '../plugins/downloader/clip-progress.js'

const createFakeConnection = ({ rejectEdits = false } = {}) => {
  const messages = []
  let counter = 0
  return {
    messages,
    async sendMessage(chat, payload) {
      messages.push({ chat, payload })
      if (payload.edit && rejectEdits) throw new Error('message edit unsupported')
      return { key: { id: String(++counter), remoteJid: chat, fromMe: true } }
    }
  }
}

test('Show real phase percentage and an accurate progress bar', () => {
  const rendered = formatClipProgress({
    jobId: 'abc12345', range: '01:00 – 02:00', phase: 'Mengunduh video',
    method: '1/4 — yt-dlp', percent: 42.5, detail: '[download] 42.5% 8.5 MiB',
    startedAt: Date.now() - 10_000
  })
  assert.match(rendered, /42\.5%/)
  assert.match(rendered, /Progres tahap/)
  assert.match(rendered, /▓+░+/)
  assert.match(rendered, /1\/4/)
  assert.ok(!rendered.includes('100.0%'))
})

test('Unknown percentage never displays a fabricated numerical value', () => {
  const rendered = formatClipProgress({
    jobId: 'abc12345', range: '01:00 – 02:00', phase: 'Mengirim video ke WhatsApp',
    method: '1/4', percent: null, detail: '', startedAt: Date.now()
  })
  assert.match(rendered, /Persentase tahap belum tersedia/)
  assert.doesNotMatch(rendered, /Progres tahap: \*100/)
})

test('Initial WhatsApp status is sent before work, then edited and completed', async () => {
  const conn = createFakeConnection()
  const tracker = createClipProgress({
    conn, chat: 'self@s.whatsapp.net', jobId: 'job12345',
    range: '00:20 – 01:20', startedAt: Date.now(), updateIntervalMs: 0
  })
  await tracker.start()
  assert.equal(conn.messages.length, 1)
  assert.equal(conn.messages[0].payload.edit, undefined)
  assert.match(conn.messages[0].payload.text, /PROGRES/)
  tracker.report(51.2, '[download] 51.2% of 10MiB')
  // Stage also flushes any queued in-flight edit without losing the latest state.
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(conn.messages.some(x => x.payload.edit && x.payload.text.includes('51.2%')))
  await tracker.stage('Mengirim video ke WhatsApp')
  await tracker.finish('success', 'Video telah dikirim.')
  assert.ok(conn.messages.at(-1).payload.edit)
  assert.match(conn.messages.at(-1).payload.text, /SELESAI/)
  assert.match(conn.messages.at(-1).payload.text, /100\.0%/)
  assert.ok(conn.messages.every(x => !x.payload.quoted && !x.payload.contextInfo))
})

test('Failure updates the existing progress message with meaningful error', async () => {
  const conn = createFakeConnection()
  const tracker = createClipProgress({
    conn, chat: 'chat', jobId: 'fail-123', range: '00:00 – 00:10',
    startedAt: Date.now(), updateIntervalMs: 0
  })
  await tracker.start()
  tracker.report(null, '[fallback] yt-dlp sedang mencoba metode lain')
  await tracker.finish('error', 'Semua metode downloader gagal')
  const last = conn.messages.at(-1).payload
  assert.match(last.text, /CLIP GAGAL/)
  assert.match(last.text, /Semua metode downloader gagal/)
  assert.doesNotMatch(last.text, /100\.0%/)
})

test('If WhatsApp edits are unsupported, status falls back to plain messages', async () => {
  const conn = createFakeConnection({ rejectEdits: true })
  const tracker = createClipProgress({
    conn, chat: 'chat', jobId: 'fallback1', range: '00:00 – 00:15',
    startedAt: Date.now(), updateIntervalMs: 0
  })
  await tracker.start()
  await tracker.finish('success', 'Media sudah terkirim.')
  const plain = conn.messages.filter(x => !x.payload.edit)
  assert.ok(plain.length >= 2, 'final state must still reach the chat')
  assert.match(plain.at(-1).payload.text, /SELESAI/)
  assert.ok(conn.messages.every(x => !x.payload.quoted))
})

test('Error details remove URLs so tokens never appear in progress messages', () => {
  const rendered = formatClipProgress({
    jobId: 'safe', range: '0:00 – 0:10', phase: 'Gagal', percent: null,
    detail: 'API error https://example.com/secret?token=do-not-leak',
    startedAt: Date.now(), outcome: 'error'
  })
  assert.doesNotMatch(rendered, /do-not-leak|example.com/)
  assert.match(rendered, /\[tautan\]/)
})
