import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sendLocalFile, describeWhatsAppUploadError } from '../lib/whatsapp-file-sender.js'

async function makeMp4(directory, name, size = 128) {
  const filePath = path.join(directory, name)
  const header = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])
  await fs.writeFile(filePath, header)
  if (size > header.length) await fs.truncate(filePath, size)
  return filePath
}

function socket(sendMessage, readyState = 1) {
  return { ws: { readyState }, user: { id: 'bot@s.whatsapp.net' }, sendMessage }
}

test('small MP4 is streamed as inline video with Baileys upload timeout', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-small-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = await makeMp4(directory, 'small.mp4', 1024)
  let captured
  const conn = socket(async (...args) => {
    captured = args
    return { key: { id: 'message-small' } }
  })

  const result = await sendLocalFile(conn, '628123@s.whatsapp.net', filePath, {
    mimetype: 'video/mp4',
    caption: 'clip',
    seconds: 12,
    mediaUploadTimeoutMs: 45000,
    checkTempSpace: false
  })

  assert.equal(result.mediaType, 'video')
  assert.equal(result.messageId, 'message-small')
  assert.equal(captured[1].video.url, await fs.realpath(filePath))
  assert.equal(captured[1].seconds, 12)
  assert.equal(captured[1].caption, 'clip')
  assert.equal(captured[2].mediaUploadTimeoutMs, 45000)
  assert.equal(Buffer.isBuffer(captured[1].video), false)
})

test('large MP4 is always sent as video regardless of the old inline size threshold', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-large-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = await makeMp4(directory, 'large.mp4', 70 * 1024 * 1024)
  let captured
  const conn = socket(async (...args) => {
    captured = args
    return { key: { id: 'message-large' } }
  })

  const result = await sendLocalFile(conn, '628123@s.whatsapp.net', filePath, {
    mimetype: 'video/mp4',
    maxBytes: 100 * 1024 * 1024,
    inlineVideoMaxBytes: 1,
    checkTempSpace: false
  })

  assert.equal(result.mediaType, 'video')
  assert.equal(captured[1].video.url, await fs.realpath(filePath))
  assert.equal(captured[1].mimetype, 'video/mp4')
  assert.equal('document' in captured[1], false)
  assert.equal((await fs.stat(filePath)).size, 70 * 1024 * 1024)
})

test('non-MP4 video containers are sent as video messages', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-container-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = await makeMp4(directory, 'source.mkv', 1024)
  let captured
  const conn = socket(async (...args) => {
    captured = args
    return { key: { id: 'message-mkv' } }
  })

  const result = await sendLocalFile(conn, '628123@s.whatsapp.net', filePath, {
    mimetype: 'video/x-matroska',
    checkTempSpace: false
  })
  assert.equal(result.mediaType, 'video')
  assert.equal(captured[1].video.url, await fs.realpath(filePath))
  assert.equal(captured[1].mimetype, 'video/x-matroska')
  assert.equal('document' in captured[1], false)
})

test('accepts an open Baileys WebSocketClient without readyState', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-fork-open-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = await makeMp4(directory, 'fork.mp4')
  let calls = 0
  const conn = {
    ws: { isOpen: true, isConnecting: false, isClosing: false, isClosed: false },
    user: { id: 'bot@s.whatsapp.net' },
    async sendMessage() {
      calls++
      return { key: { id: 'fork-open' } }
    }
  }

  const result = await sendLocalFile(conn, '628123@s.whatsapp.net', filePath, { checkTempSpace: false })
  assert.equal(result.messageId, 'fork-open')
  assert.equal(calls, 1)
})

test('upload queue serializes concurrent media sends per WhatsApp socket', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-queue-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const first = await makeMp4(directory, 'first.mp4')
  const second = await makeMp4(directory, 'second.mp4')
  let active = 0
  let maximumActive = 0
  let id = 0
  const conn = socket(async () => {
    active++
    maximumActive = Math.max(maximumActive, active)
    await new Promise(resolve => setTimeout(resolve, 25))
    active--
    return { key: { id: 'queued-' + (++id) } }
  })

  await Promise.all([
    sendLocalFile(conn, '628123@s.whatsapp.net', first, { checkTempSpace: false }),
    sendLocalFile(conn, '628123@s.whatsapp.net', second, { checkTempSpace: false })
  ])
  assert.equal(maximumActive, 1)
  assert.equal(id, 2)
})

test('failed WhatsApp send is not retried and source file remains available', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-fail-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = await makeMp4(directory, 'keep.mp4')
  let calls = 0
  const conn = socket(async () => {
    calls++
    throw Object.assign(new Error('simulated upload disconnect'), { code: 'ECONNRESET' })
  })

  await assert.rejects(
    sendLocalFile(conn, '628123@s.whatsapp.net', filePath, { checkTempSpace: false }),
    /ECONNRESET/
  )
  assert.equal(calls, 1)
  assert.equal((await fs.stat(filePath)).isFile(), true)
})

test('missing, oversized and disconnected sends fail before upload', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-preflight-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = await makeMp4(directory, 'file.mp4', 100)
  let calls = 0
  const conn = socket(async () => {
    calls++
    return { key: { id: 'should-not-send' } }
  })

  await assert.rejects(
    sendLocalFile(conn, '628123@s.whatsapp.net', path.join(directory, 'missing.mp4'), { checkTempSpace: false }),
    /File tidak dapat ditemukan/
  )
  await assert.rejects(
    sendLocalFile(conn, '628123@s.whatsapp.net', filePath, { maxBytes: 10, checkTempSpace: false }),
    /melebihi batas konfigurasi/
  )
  await assert.rejects(
    sendLocalFile(socket(async () => { calls++ }, 3), '628123@s.whatsapp.net', filePath, { checkTempSpace: false }),
    /transport=closed/
  )
  assert.equal(calls, 0)
})

test('upload errors explain disk, connection, timeout and provider size failures', () => {
  assert.match(describeWhatsAppUploadError(Object.assign(new Error('write failed'), { code: 'ENOSPC' })), /Ruang penyimpanan sementara/)
  assert.match(describeWhatsAppUploadError(Object.assign(new Error('socket closed'), { output: { statusCode: 428 } })), /HTTP 428/)
  assert.match(describeWhatsAppUploadError(Object.assign(new Error('Payload too large'), { status: 413 })), /HTTP 413/)
  assert.match(describeWhatsAppUploadError(Object.assign(new Error('Upload timeout'), { code: 'ETIMEDOUT' })), /melewati batas waktu/)
  assert.match(describeWhatsAppUploadError(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })), /ECONNRESET/)
})


test('large WebM video is sent as video without a per-feature force flag', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-large-webm-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = await makeMp4(directory, 'large-download.webm', 70 * 1024 * 1024)
  let captured
  const conn = socket(async (...args) => {
    captured = args
    return { key: { id: 'message-large-webm' } }
  })

  const result = await sendLocalFile(conn, '628123@s.whatsapp.net', filePath, {
    mimetype: 'video/webm',
    maxBytes: 100 * 1024 * 1024,
    caption: 'download video',
    checkTempSpace: false
  })

  assert.equal(result.mediaType, 'video')
  assert.equal(captured[1].video.url, await fs.realpath(filePath))
  assert.equal(captured[1].mimetype, 'video/webm')
  assert.equal(captured[1].caption, 'download video')
  assert.equal('document' in captured[1], false)
  assert.equal((await fs.stat(filePath)).size, 70 * 1024 * 1024)
})

test('non-video files remain WhatsApp documents', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-wa-pdf-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'report.pdf')
  await fs.writeFile(filePath, '%PDF-1.4 test')
  let captured
  const conn = socket(async (...args) => {
    captured = args
    return { key: { id: 'message-pdf' } }
  })

  const result = await sendLocalFile(conn, '628123@s.whatsapp.net', filePath, {
    mimetype: 'application/pdf',
    checkTempSpace: false
  })

  assert.equal(result.mediaType, 'document')
  assert.equal(captured[1].document.url, await fs.realpath(filePath))
  assert.equal('video' in captured[1], false)
})
