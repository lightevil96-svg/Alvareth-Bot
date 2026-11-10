import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as connection from '../lib/whatsapp-connection.js'
import { createWhatsAppReconnectController } from '../lib/whatsapp-reconnect.js'

function makeSocket(transport = 'open', creds = { registered: false }) {
  return connection.trackWhatsAppSocket({
    ev: new EventEmitter(),
    ws: { isOpen: transport === 'open', isClosed: transport === 'closed' },
    authState: { creds },
    sendMessage: async () => ({ key: { id: 'sent' } })
  })
}

function harness(socket, reconnect, options = {}) {
  const timers = new Map()
  const logs = []
  const h = { socket, calls: 0, timers, logs }
  h.controller = createWhatsAppReconnectController({
    getSocket: () => h.socket,
    reconnect: async () => { h.calls++; await reconnect?.(h) },
    logger: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, message => logs.push(message)])),
    setTimer(callback, ms) { const id = {}; timers.set(id, { callback, ms }); return id },
    clearTimer(id) { timers.delete(id) },
    ...options
  })
  h.next = async () => {
    const [id, timer] = timers.entries().next().value || []
    assert.ok(timer, 'expected a scheduled timer')
    timers.delete(id)
    await timer.callback()
    return timer.ms
  }
  return h
}

test('reported registered=false/open case releases render delivery without reconnect', async () => {
  const socket = makeSocket('open', { registered: false, me: { id: 'bot:1@s.whatsapp.net' } })
  const h = harness(socket)
  h.controller.request('Render selesai, tetapi socket WhatsApp belum aktif.')
  assert.equal(h.timers.size, 1)
  socket.ev.emit('connection.update', { connection: 'open' })
  assert.equal(h.controller.request(), false)
  assert.equal(h.timers.size, 0)
  let sent = 0
  await connection.sendWithWhatsAppReconnect({
    getSocket: () => socket,
    send: async actual => { assert.equal(actual, socket); sent++; return 'delivered' }
  })
  assert.equal(sent, 1)
  assert.equal(h.calls, 0)
})

test('watchdog preserves QR entry and code entry beyond the handshake deadline', async () => {
  for (const mode of ['qr', 'pairing']) {
    const socket = makeSocket()
    const h = harness(socket)
    h.controller.request()
    if (mode === 'qr') socket.ev.emit('connection.update', { qr: 'test-qr' })
    else socket.authState.creds.pairingCode = 'TEST-CODE'
    assert.equal(await h.next(), 30000)
    for (let i = 0; i < 100; i++) h.controller.request()
    assert.equal(h.timers.size, 0)
    assert.equal(h.calls, 0)
  }
})

test('a closed socket with an old pairingCode can reconnect', async () => {
  const h = harness(makeSocket('closed', { registered: false, pairingCode: 'OLD' }), h => {
    h.socket = makeSocket()
    h.socket.ev.emit('connection.update', { qr: 'new-qr' })
  })
  h.controller.request()
  assert.equal(await h.next(), 3000)
  assert.equal(h.calls, 1)
  assert.equal(h.timers.size, 0)
})

test('a close event overrides pending pairing even before transport flags update', () => {
  const socket = makeSocket('open', { registered: false, pairingCode: 'OLD' })
  const h = harness(socket)
  socket.ev.emit('connection.update', { connection: 'close' })
  h.controller.request()
  assert.equal(h.timers.values().next().value.ms, 30000)
  assert.equal(connection.isWhatsAppLoginPending(socket), false)
})

test('genuine failures stop after eight reconnects, including repeated 515 restarts', async () => {
  for (const status of [428, 515]) {
    const h = harness(makeSocket('closed'), h => {
      h.socket = makeSocket('closed')
      h.controller.schedule(status, 'repeated failure')
    })
    h.controller.schedule(status)
    for (let i = 0; i < 8; i++) await h.next()
    for (let i = 0; i < 1000; i++) {
      h.controller.request('media polling')
      h.controller.schedule(status)
    }
    assert.equal(h.calls, 8)
    assert.equal(h.timers.size, 0)
    assert.equal(h.logs.filter(line => line.includes('dihentikan')).length, 1)
    h.socket = makeSocket('open', { me: { id: 'bot@s.whatsapp.net' } })
    h.socket.ev.emit('connection.update', { connection: 'open' })
    assert.equal(h.controller.request(), false)
    h.socket.ws = { isClosed: true }
    h.socket.ev.emit('connection.update', { connection: 'close' })
    h.controller.request()
    assert.equal(h.timers.values().next().value.ms, 3000, 'a successful login resets the retry budget')
  }
})

test('socket-construction errors also consume a bounded retry budget', async () => {
  const h = harness(makeSocket('closed'), () => { throw new Error('creation failed') })
  h.controller.request()
  for (let i = 0; i < 8; i++) await h.next()
  assert.equal(h.calls, 8)
  assert.equal(h.timers.size, 0)
})

test('old handshake timers give a replacement socket its own grace period', async () => {
  const h = harness(makeSocket())
  h.controller.request()
  h.socket = makeSocket()
  await h.next()
  assert.equal(h.calls, 0)
  assert.equal(h.timers.values().next().value.ms, 30000)
  h.socket.user = { id: 'bot@s.whatsapp.net' }
  h.socket.ev.emit('connection.update', { connection: 'open' })
  await h.next()
  assert.equal(h.timers.size, 0)
})

test('a queued reconnect cannot replace a newly authenticated socket', async () => {
  const h = harness(makeSocket('closed'))
  h.controller.request()
  h.socket = makeSocket('open', { registered: false, me: { id: 'bot@s.whatsapp.net' } })
  h.socket.ev.emit('connection.update', { connection: 'open' })
  await h.next()
  assert.equal(h.calls, 0)
  assert.equal(h.timers.size, 0)
})

test('concurrent close events and media polling schedule only one replacement', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const h = harness(makeSocket('closed'), async h => {
    await pending
    h.socket = makeSocket('open', { me: { id: 'bot@s.whatsapp.net' } })
    h.socket.ev.emit('connection.update', { connection: 'open' })
  })
  h.controller.request()
  h.controller.schedule(428)
  assert.equal(h.timers.size, 1)
  const running = h.next()
  h.controller.schedule(428)
  h.controller.request()
  assert.equal(h.timers.size, 0)
  release()
  await running
  assert.equal(h.calls, 1)
  assert.equal(h.timers.size, 0)
})

test('inconsistent registered credentials emit one repair warning without reconnecting', () => {
  const h = harness(makeSocket('open', { registered: true }))
  for (let i = 0; i < 100; i++) h.controller.request()
  assert.equal(h.logs.length, 1)
  assert.equal(h.timers.size, 0)
})

// Execute the real main.js event handler without starting a bot or contacting WhatsApp.
const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8')
const handlerSource = mainSource.slice(mainSource.indexOf('async function connectionUpdate('), mainSource.indexOf('// Loader plugin rekursif.'))
test('main event wiring accepts authenticated open and ignores events from an old socket', async () => {
  const socket = makeSocket('open', { registered: false, me: { id: 'bot@s.whatsapp.net' }, pairingCode: 'OLD' })
  const h = harness(socket)
  const messages = []
  const identity = value => value
  const context = {
    ...connection, conn: socket, global: { conn: socket, requestWhatsAppReconnect: h.controller.request },
    state: { creds: socket.authState.creds }, socketReconnect: h.controller, loginMethod: 'pairing',
    chalk: new Proxy({}, { get: () => identity }),
    console: { log: message => messages.push(message), warn: message => messages.push(message) },
    requestPairingCodeWhileConnecting: () => assert.fail('already authenticated'),
    requestPairingCodeForSocket: () => assert.fail('already authenticated')
  }
  const handle = vm.runInNewContext(handlerSource + '\nconnectionUpdate', context)
  h.controller.request()
  socket.ev.emit('connection.update', { connection: 'open' })
  await handle.call(socket, { connection: 'open' })
  assert.equal(h.timers.size, 0)
  assert.ok(messages.some(message => message.includes('Bot terhubung')))
  await handle.call(makeSocket('closed'), { connection: 'close' })
  assert.equal(h.timers.size, 0)
})
