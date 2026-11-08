import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getWhatsAppWebSocketState,
  isWhatsAppConnectionClosedError,
  isWhatsAppSocketOpen,
  sendWithWhatsAppReconnect,
  waitForWhatsAppSocket
} from '../lib/whatsapp-connection.js'

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
