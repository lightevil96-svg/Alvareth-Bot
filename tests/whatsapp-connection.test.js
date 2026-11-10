import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  getWhatsAppWebSocketState,
  hasLinkedWhatsAppSession,
  isWhatsAppConnectionClosedError,
  isWhatsAppLoginPending,
  isWhatsAppRestartRequired,
  isWhatsAppSocketOpen,
  sendWithWhatsAppReconnect,
  trackWhatsAppSocket,
  waitForWhatsAppSocket
} from '../lib/whatsapp-connection.js'

test('server login success accepts QR credentials with registered=false and a stale pairing code', () => {
  const socket = trackWhatsAppSocket({
    ...makeForkSocket('open'),
    ev: new EventEmitter(),
    authState: { creds: { registered: false, pairingCode: 'OLD-CODE' } }
  })
  assert.equal(isWhatsAppSocketOpen(socket), false)
  assert.equal(isWhatsAppLoginPending(socket), true)
  socket.ev.emit('connection.update', { connection: 'open' })
  assert.equal(isWhatsAppSocketOpen(socket), true)
  assert.equal(isWhatsAppLoginPending(socket), false)
  assert.equal(socket.authState.creds.registered, false, 'do not manufacture registration credentials')
})

test('persisted credentials and an open transport cannot substitute for a login event', () => {
  const socket = trackWhatsAppSocket({
    ...makeForkSocket('open'), ev: new EventEmitter(),
    authState: { creds: { registered: true, me: { id: 'bot@s.whatsapp.net' } } }
  })
  assert.equal(isWhatsAppSocketOpen(socket), false)
  socket.ev.emit('connection.update', { connection: 'open' })
  assert.equal(isWhatsAppSocketOpen(socket), true)
  // Baileys can report closure before the transport wrapper changes flags.
  socket.ev.emit('connection.update', { connection: 'close' })
  assert.equal(isWhatsAppSocketOpen(socket), false)
  assert.equal(isWhatsAppSocketOpen(trackWhatsAppSocket({ ...socket, ev: new EventEmitter() })), false)
})

test('QR entry is pending until server authentication and tracking is idempotent', () => {
  const socket = trackWhatsAppSocket({ ...makeForkSocket('open', ''), ev: new EventEmitter() })
  trackWhatsAppSocket(socket)
  assert.equal(socket.ev.listenerCount('connection.update'), 1)
  socket.ev.emit('connection.update', { qr: 'test-qr' })
  assert.equal(isWhatsAppLoginPending(socket), true)
  assert.equal(isWhatsAppSocketOpen(socket), false)
  socket.ev.emit('connection.update', { connection: 'open' })
  assert.equal(isWhatsAppSocketOpen(socket), false, 'an identity is still required')
  socket.user = { id: 'bot@s.whatsapp.net' }
  assert.equal(isWhatsAppSocketOpen(socket), true)
  socket.ws.isOpen = false
  socket.ws.isClosed = true
  assert.equal(isWhatsAppSocketOpen(socket), false)
})

test('saved signed QR account is linked even when registered=false; temporary me is not', () => {
  const creds = { registered: false, me: { id: 'bot:1@s.whatsapp.net' }, pairingCode: 'TEMP' }
  assert.equal(hasLinkedWhatsAppSession(creds), false)
  creds.account = { details: Buffer.from('details'), accountSignature: Buffer.from('signature'), deviceSignature: Buffer.from('device') }
  assert.equal(hasLinkedWhatsAppSession(creds), true)
  assert.equal(hasLinkedWhatsAppSession({ ...creds, me: undefined }), false)
  assert.equal(hasLinkedWhatsAppSession({ ...creds, account: {} }), false)
})

function makeSocket(readyState = 1, sendMessage = async () => ({ key: { id: 'sent' } })) {
  return { ws: { readyState }, user: { id: 'bot@s.whatsapp.net' }, sendMessage }
}

function makeForkSocket(state = 'open', userId = 'bot@s.whatsapp.net') {
  const states = {
    open: { isOpen: true, isConnecting: false, isClosing: false, isClosed: false },
    connecting: { isOpen: false, isConnecting: true, isClosing: false, isClosed: false },
    closing: { isOpen: false, isConnecting: false, isClosing: true, isClosed: false },
    closed: { isOpen: false, isConnecting: false, isClosing: false, isClosed: true }
  }
  return {
    ws: { ...states[state] },
    user: userId ? { id: userId } : null,
    sendMessage: async () => ({ key: { id: 'sent' } })
  }
}

test('recognizes only an open Baileys socket as ready', () => {
  assert.equal(isWhatsAppSocketOpen(makeSocket(1)), true)
  assert.equal(isWhatsAppSocketOpen(makeSocket(0)), false)
  assert.equal(isWhatsAppSocketOpen(makeSocket(3)), false)
  assert.equal(isWhatsAppSocketOpen({ sendMessage() {}, ws: { readyState: 1 } }), false)
  assert.equal(isWhatsAppSocketOpen(null), false)
})

test('@itsliaaa/baileys WebSocketClient state flags work without readyState', () => {
  const open = makeForkSocket('open')
  assert.equal('readyState' in open.ws, false)
  assert.equal(getWhatsAppWebSocketState(open), 'open')
  assert.equal(isWhatsAppSocketOpen(open), true)
  assert.equal(getWhatsAppWebSocketState(makeForkSocket('connecting')), 'connecting')
  assert.equal(getWhatsAppWebSocketState(makeForkSocket('closing')), 'closing')
  assert.equal(getWhatsAppWebSocketState(makeForkSocket('closed')), 'closed')
  assert.equal(isWhatsAppSocketOpen(makeForkSocket('open', '')), false)
})

test('does not treat a pending pairing code as an authenticated socket', () => {
  const socket = makeForkSocket('open')
  socket.authState = {
    creds: {
      registered: false,
      pairingCode: 'TEMPORARY-CODE',
      me: { id: '628123456789@s.whatsapp.net' }
    }
  }

  assert.equal(isWhatsAppSocketOpen(socket), false)

  socket.authState.creds.registered = true
  assert.equal(isWhatsAppSocketOpen(socket), true)
})

test('uses persisted auth identity when socket.user is not exposed', () => {
  const socket = {
    ws: { isOpen: true },
    sendMessage: async () => null,
    authState: {
      creds: {
        registered: true,
        me: { id: '628123456789@s.whatsapp.net' }
      }
    }
  }

  assert.equal(isWhatsAppSocketOpen(socket), true)
})

test('recognizes Baileys restartRequired (515)', () => {
  assert.equal(isWhatsAppRestartRequired(515), true)
  assert.equal(isWhatsAppRestartRequired({ statusCode: 515 }), true)
  assert.equal(isWhatsAppRestartRequired({ output: { statusCode: 515 } }), true)
  assert.equal(isWhatsAppRestartRequired(428), false)
})

test('waits for the authenticated fork WebSocketClient without a readyState property', async () => {
  const socket = makeForkSocket('open')
  assert.equal(await waitForWhatsAppSocket(() => socket), socket)
})

test('recognizes WhatsApp 428 and closed-socket errors', () => {
  assert.equal(isWhatsAppConnectionClosedError({ statusCode: 428 }), true)
  assert.equal(isWhatsAppConnectionClosedError(new Error('Connection Closed')), true)
  assert.equal(isWhatsAppConnectionClosedError({ code: 'WA_SOCKET_NOT_OPEN' }), true)
  assert.equal(isWhatsAppConnectionClosedError(new Error('Payload too large')), false)
})

test('waits for the current socket to reconnect without a fixed deadline', async () => {
  let current = makeSocket(3)
  const replacement = makeSocket(1)
  const resultPromise = waitForWhatsAppSocket(() => current, { pollIntervalMs: 5 })
  await new Promise(resolve => setTimeout(resolve, 20))
  current = replacement

  assert.equal(await resultPromise, replacement)
})

test('keeps notifying the reconnect watchdog while an open socket is not authenticated', async () => {
  const current = makeSocket(1)
  current.user = null
  const controller = new AbortController()
  const reasons = []
  const waiting = waitForWhatsAppSocket(() => current, {
    signal: controller.signal,
    pollIntervalMs: 5,
    onWait: details => reasons.push(details.reason)
  })
  setTimeout(() => controller.abort(), 25)

  await assert.rejects(waiting, error => error.code === 'RENDER_SCRIPT_CANCELLED')
  assert.equal(reasons[0], 'waiting-for-connection')
  assert.ok(reasons.includes('connection-still-unavailable'))
})

test('aborts an indefinite connection wait when the render is cancelled', async () => {
  const controller = new AbortController()
  const waiting = waitForWhatsAppSocket(() => makeSocket(3), {
    signal: controller.signal,
    pollIntervalMs: 5
  })
  setTimeout(() => controller.abort(), 15)

  await assert.rejects(waiting, error => error.code === 'RENDER_SCRIPT_CANCELLED')
})

test('retries once on the replacement socket after a preflight closed-socket error', async () => {
  const oldSocket = makeSocket(1)
  const newSocket = makeSocket(1)
  let current = oldSocket
  const calls = []
  let reconnectRequests = 0

  const result = await sendWithWhatsAppReconnect({
    getSocket: () => current,
    pollIntervalMs: 5,
    onReconnectRequired: details => {
      reconnectRequests++
      assert.equal(details.previousSocket, oldSocket)
      assert.equal(details.socket, newSocket)
    },
    send: async socket => {
      calls.push(socket)
      if (socket === oldSocket) {
        oldSocket.ws.readyState = 3
        current = newSocket
        throw Object.assign(new Error('WebSocket is not open'), { code: 'WA_SOCKET_NOT_OPEN', stage: 'preflight' })
      }
      return { key: { id: 'delivered-on-new-socket' } }
    }
  })

  assert.equal(result.key.id, 'delivered-on-new-socket')
  assert.deepEqual(calls, [oldSocket, newSocket])
  assert.equal(reconnectRequests, 1)
})

test('does not retry an ambiguous 428 after the socket is replaced', async () => {
  const oldSocket = makeSocket(1)
  const newSocket = makeSocket(1)
  let current = oldSocket
  let calls = 0

  await assert.rejects(
    sendWithWhatsAppReconnect({
      getSocket: () => current,
      send: async socket => {
        calls++
        oldSocket.ws.readyState = 3
        current = newSocket
        throw Object.assign(new Error('Connection Closed'), {
          statusCode: 428,
          stage: 'whatsapp-upload'
        })
      }
    }),
    /Connection Closed/
  )

  assert.equal(calls, 1)
})

test('does not retry an ambiguous 428 while the same socket still appears open', async () => {
  const current = makeSocket(1)
  let calls = 0

  await assert.rejects(
    sendWithWhatsAppReconnect({
      getSocket: () => current,
      send: async () => {
        calls++
        throw Object.assign(new Error('Connection Closed'), { statusCode: 428 })
      }
    }),
    /Connection Closed/
  )

  assert.equal(calls, 1)
})

test('does not retry non-connection failures', async () => {
  const current = makeSocket(1)
  let calls = 0

  await assert.rejects(
    sendWithWhatsAppReconnect({
      getSocket: () => current,
      send: async () => {
        calls++
        throw new Error('Payload too large')
      }
    }),
    /Payload too large/
  )

  assert.equal(calls, 1)
})
