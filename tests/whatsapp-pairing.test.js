import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { trackWhatsAppSocket } from '../lib/whatsapp-connection.js'
import {
  createPairingCodeRequester,
  normalizePairingPhoneNumber
} from '../lib/whatsapp-pairing.js'

test('normalizes an international phone number to digits only', () => {
  assert.equal(normalizePairingPhoneNumber('+62 812-3456-7890'), '6281234567890')
  assert.equal(normalizePairingPhoneNumber('62 (812) 3456.7890'), '6281234567890')
})

test('rejects local, malformed, too-short, and overlong phone numbers', () => {
  for (const value of ['', '081234567890', '62812abc7890', '1234567', '1'.repeat(16)]) {
    assert.equal(normalizePairingPhoneNumber(value), '')
  }
})

test('requests one pairing code after the configured handshake delay', async () => {
  const calls = []
  const socket = {
    authState: { creds: { registered: false } },
    async requestPairingCode(number) {
      calls.push(number)
      return 'ABCD-EFGH'
    }
  }
  const requester = createPairingCodeRequester({
    phoneNumber: '+62 812-3456-7890',
    delayMs: 1500,
    wait: async ms => calls.push(`wait:${ms}`)
  })

  const result = await requester(socket)
  assert.deepEqual(result, { status: 'generated', code: 'ABCD-EFGH' })
  assert.deepEqual(calls, ['wait:1500', '6281234567890'])
})

test('does not request a code when the auth state is already registered', async () => {
  let requested = false
  const socket = {
    authState: { creds: { registered: true } },
    async requestPairingCode() { requested = true; return 'ABCD-EFGH' }
  }
  const requester = createPairingCodeRequester({ phoneNumber: '6281234567890', wait: async () => {} })

  assert.deepEqual(await requester(socket), { status: 'already-registered' })
  assert.equal(requested, false)
})

test('saved QR sessions do not request pairing or reject an empty BOT_NUMBER', async () => {
  const socket = {
    authState: { creds: {
      registered: false,
      me: { id: 'bot:1@s.whatsapp.net' },
      account: { details: Buffer.from('details'), accountSignature: Buffer.from('signature'), deviceSignature: Buffer.from('device') }
    } },
    async requestPairingCode() { assert.fail('must not overwrite a linked QR account') }
  }
  const requester = createPairingCodeRequester({ phoneNumber: '', wait: async () => assert.fail('no pairing delay needed') })
  assert.deepEqual(await requester(socket), { status: 'already-registered' })
})

test('login completing during the pairing delay cancels the pairing request', async () => {
  const socket = trackWhatsAppSocket({
    ev: new EventEmitter(), ws: { isOpen: true },
    authState: { creds: { registered: false } },
    sendMessage() {},
    async requestPairingCode() { assert.fail('already logged in') }
  })
  const requester = createPairingCodeRequester({
    phoneNumber: '6281234567890',
    wait: async () => {
      socket.user = { id: 'bot:1@s.whatsapp.net' }
      socket.ev.emit('connection.update', { connection: 'open' })
    }
  })
  assert.deepEqual(await requester(socket), { status: 'already-registered' })
})

test('a temporary pairing identity alone does not suppress code login', async () => {
  const socket = {
    authState: { creds: { registered: false, me: { id: 'bot@s.whatsapp.net' } } },
    async requestPairingCode() { return 'TEST-CODE' }
  }
  const requester = createPairingCodeRequester({ phoneNumber: '6281234567890', wait: async () => {} })
  assert.deepEqual(await requester(socket), { status: 'generated', code: 'TEST-CODE' })
})

test('reports invalid phone and unsupported library method without throwing', async () => {
  const invalidRequester = createPairingCodeRequester({ phoneNumber: '081234567890', wait: async () => {} })
  const unsupportedRequester = createPairingCodeRequester({ phoneNumber: '6281234567890', wait: async () => {} })

  assert.deepEqual(await invalidRequester({ authState: { creds: { registered: false } } }), { status: 'invalid-phone' })
  assert.deepEqual(await unsupportedRequester({ authState: { creds: { registered: false } } }), { status: 'unsupported' })
})

test('cancels when the socket is no longer the active connection', async () => {
  let requested = false
  const socket = {
    authState: { creds: { registered: false } },
    async requestPairingCode() { requested = true; return 'ABCD-EFGH' }
  }
  const requester = createPairingCodeRequester({ phoneNumber: '6281234567890', wait: async () => {} })

  assert.deepEqual(await requester(socket, () => false), { status: 'cancelled' })
  assert.equal(requested, false)
})

test('does not issue duplicate requests for the same socket', async () => {
  let requests = 0
  const socket = {
    authState: { creds: { registered: false } },
    async requestPairingCode() { requests += 1; return 'ABCD-EFGH' }
  }
  const requester = createPairingCodeRequester({ phoneNumber: '6281234567890', wait: async () => {} })

  assert.deepEqual(await requester(socket), { status: 'generated', code: 'ABCD-EFGH' })
  assert.deepEqual(await requester(socket), { status: 'already-attempted', previous: 'generated' })
  assert.equal(requests, 1)
})

test('discards a pairing code returned after the socket was replaced', async () => {
  let current = true
  const socket = {
    authState: { creds: { registered: false } },
    async requestPairingCode() { current = false; return 'STALE-CODE' }
  }
  const requester = createPairingCodeRequester({ phoneNumber: '6281234567890', wait: async () => {} })
  assert.deepEqual(await requester(socket, () => current), { status: 'cancelled' })
})

test('captures a WhatsApp pairing API failure and does not retry the same socket', async () => {
  let requests = 0
  const socket = {
    authState: { creds: { registered: false } },
    async requestPairingCode() { requests += 1; throw new Error('handshake rejected') }
  }
  const requester = createPairingCodeRequester({ phoneNumber: '6281234567890', wait: async () => {} })

  const result = await requester(socket)
  assert.equal(result.status, 'failed')
  assert.match(result.error.message, /handshake rejected/)
  assert.deepEqual(await requester(socket), { status: 'already-attempted', previous: 'failed' })
  assert.equal(requests, 1)
})
