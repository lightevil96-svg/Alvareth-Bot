import test from 'node:test'
import assert from 'node:assert/strict'
import { createClipProgress, formatClipProgress } from '../plugins/downloader/clip-progress.js'

function createLogger() {
  return {
    lines: [],
    log(line) { this.lines.push(String(line)) }
  }
}

test('Format terminal progress contains the real percentage and progress bar', () => {
  const rendered = formatClipProgress({
    jobId: 'abc12345',
    percent: 42.5,
    detail: '[download] 42.5% of 10MiB',
    startedAt: Date.now() - 10_000
  })
  assert.match(rendered, /42\.5%/)
  assert.match(rendered, /█+░+/)
  assert.match(rendered, /\[CLIP:abc12345\]/)
})

test('Unknown percentage never displays a fabricated numerical value', () => {
  const rendered = formatClipProgress({
    jobId: 'unknown',
    percent: null,
    detail: '[stage] Menunggu respons downloader',
    startedAt: Date.now()
  })
  assert.match(rendered, /Menunggu respons downloader/)
  assert.doesNotMatch(rendered, /100\.0%/)
})

test('Start, stages, progress and completion are logged only to terminal', () => {
  const logger = createLogger()
  const fakeConnection = {
    messages: [],
    async sendMessage(...args) { this.messages.push(args) }
  }
  const tracker = createClipProgress({
    // Extra connection/chat values are intentionally ignored by the terminal reporter.
    conn: fakeConnection,
    chat: 'chat@s.whatsapp.net',
    jobId: 'terminal1',
    range: '00:20 – 01:20',
    startedAt: Date.now(),
    logger
  })

  tracker.start()
  tracker.stage('Mengambil metadata')
  tracker.report(51.2, '[download] 51.2% of 10MiB')
  tracker.finish('success', 'Video berhasil dikirim.')

  assert.ok(logger.lines.some(line => line.includes('Mulai YouTube Clip')))
  assert.ok(logger.lines.some(line => line.includes('51.2%')))
  assert.ok(logger.lines.some(line => line.includes('Selesai')))
  assert.equal(fakeConnection.messages.length, 0)
})

test('Progress from FFmpeg and download phases are logged independently', () => {
  const logger = createLogger()
  const tracker = createClipProgress({
    jobId: 'phases',
    range: '00:00 – 00:15',
    startedAt: Date.now(),
    logger
  })

  tracker.report(35, '[download] 35% of 5MiB')
  tracker.report(12, '[ffmpeg] frame=12 time=00:00:01.20')
  assert.equal(logger.lines.length, 2)
  assert.match(logger.lines[0], /35\.0%/)
  assert.match(logger.lines[1], /12\.0%/)
})

test('Failure details are written to terminal without any chat send', () => {
  const logger = createLogger()
  const tracker = createClipProgress({
    jobId: 'failure',
    range: '00:00 – 00:10',
    startedAt: Date.now(),
    logger
  })
  tracker.start()
  tracker.finish('error', 'Semua metode downloader gagal')
  assert.ok(logger.lines.some(line => line.includes('Semua metode downloader gagal')))
  assert.ok(logger.lines.some(line => line.includes('Gagal')))
})
