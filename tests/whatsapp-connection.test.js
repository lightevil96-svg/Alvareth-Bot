import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isWhatsAppConnectionClosedError,
  isWhatsAppSocketOpen,
  sendWithWhatsAppReconnect,
  waitForWhatsAppSocket
} from '../lib/whatsapp-connection.js'

function makeSocket(readyState = 1, sendMessage = async () => ({ key: { id: 'sent' } })) {
  return { ws: { readyState }, user: { id: 'bot@s.whatsapp.net' }, sendMessage }
}

test('recognizes only an open Baileys socket as ready', () => {
  assert.equal(isWhatsAppSocketOpen(makeSocket(1)), true)
  assert.equal(isWhatsAppSocketOpen(makeSocket(0)), false)
  assert.equal(isWhatsAppSocketOpen(makeSocket(3)), false)
  assert.equal(isWhatsAppSocketOpen({ sendMessage() {} }), false)
  assert.equal(isWhatsAppSocketOpen(null), false)
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

test('aborts an indefinite connection wait when the render is cancelled', async () => {
  const controller = new AbortController()
  const waiting = waitForWhatsAppSocket(() => makeSocket(3), {
    signal: controller.signal,
    pollIntervalMs: 5
  })
  setTimeout(() => controller.abort(), 15)

  await assert.rejects(waiting, error => error.code === 'RENDER_SCRIPT_CANCELLED')
})

test('retries once on the replacement socket after a 428 disconnect', async () => {
  const oldSocket = makeSocket(1)
  const newSocket = makeSocket(1)
  let current = oldSocket
  const calls = []

  const result = await sendWithWhatsAppReconnect({
    getSocket: () => current,
    pollIntervalMs: 5,
    send: async socket => {
      calls.push(socket)
      if (socket === oldSocket) {
        oldSocket.ws.readyState = 3
        current = newSocket
        throw Object.assign(new Error('Connection Closed'), { statusCode: 428 })
      }
      return { key: { id: 'delivered-on-new-socket' } }
    }
  })

  assert.equal(result.key.id, 'delivered-on-new-socket')
  assert.deepEqual(calls, [oldSocket, newSocket])
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
