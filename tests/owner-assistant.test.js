import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ASISTEN_MODEL, normalizeAsistenNumber, isValidGroqKey,
  senderAsistenNumber, isAsistenPlainText, asistenIsActiveFor, askAsistenGroq
} from '../lib/owner-assistant.js'

const key = 'gsk_' + 'A'.repeat(32)
const mockMessage = {
  chat: '6281234567890@s.whatsapp.net',
  sender: '6281234567890@s.whatsapp.net',
  senderPN: '6281234567890@s.whatsapp.net',
  isGroup: false,
  fromMe: false,
  text: 'Halo, owner ada?',
  rawMessage: { message: { conversation: 'Halo, owner ada?' } }
}

test('model Groq yang digunakan sesuai permintaan', () => {
  assert.equal(ASISTEN_MODEL, 'openai/gpt-oss-120b')
})
test('nomor Indonesia dinormalisasi dan input tidak valid ditolak', () => {
  assert.equal(normalizeAsistenNumber('0812-3456-7890'), '6281234567890')
  assert.equal(normalizeAsistenNumber('+62 812 3456 7890'), '6281234567890')
  assert.equal(normalizeAsistenNumber('6281234567890@s.whatsapp.net'), '')
  assert.equal(normalizeAsistenNumber('abc'), '')
})
test('hanya target terdaftar yang boleh dibalas dan tidak membalas perintah', () => {
  const cfg = { enabled: true, targets: ['6281234567890'] }
  assert.equal(senderAsistenNumber(mockMessage), '6281234567890')
  assert.equal(asistenIsActiveFor(mockMessage, cfg), true)
  assert.equal(asistenIsActiveFor({ ...mockMessage, fromMe: true }, cfg), false)
  assert.equal(asistenIsActiveFor({ ...mockMessage, text: '.menu' }, cfg), false)
  assert.equal(asistenIsActiveFor({ ...mockMessage, isGroup: true }, cfg), false)
  assert.equal(asistenIsActiveFor(mockMessage, { ...cfg, enabled: false }), false)
  assert.equal(asistenIsActiveFor(mockMessage, { ...cfg, targets: ['6289999999999'] }), false)
})
test('tombol interaktif bukan teks biasa, walaupun m.text sudah diisi command', () => {
  assert.equal(isAsistenPlainText(mockMessage), true)
  assert.equal(isAsistenPlainText({ ...mockMessage, rawMessage: { message: { buttonsResponseMessage: { selectedButtonId: '.asisten apikey' } } } }), false)
})
test('Groq key divalidasi', () => {
  assert.equal(isValidGroqKey(key), true)
  assert.equal(isValidGroqKey('random-text'), false)
})
test('Groq mengirim request model yang benar tanpa mengekspose API key dalam respons', async () => {
  let called = false
  const response = await askAsistenGroq({
    apiKey: key, ownerStatus: 'Owner sedang off', incomingText: 'Halo',
    fetchImpl: async (url, request) => {
      called = true
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions')
      assert.equal(request.headers.Authorization, 'Bearer ' + key)
      const body = JSON.parse(request.body)
      assert.equal(body.model, ASISTEN_MODEL)
      assert.match(body.messages[0].content, /Owner sedang off/)
      assert.equal(body.messages.at(-1).content, 'Halo')
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Halo, saya asisten owner.' } }] }) }
    }
  })
  assert.equal(called, true)
  assert.equal(response, 'Halo, saya asisten owner.')
})
test('status HTTP Groq yang gagal harus ditolak', async () => {
  await assert.rejects(askAsistenGroq({
    apiKey: key, incomingText: 'Halo',
    fetchImpl: async () => ({ ok: false, status: 429 })
  }), /Groq HTTP 429/)
})


test('bot setup prompts are never interpreted as owner input in self-chat', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { default: asisten } = await import('../plugins/owner/asisten.js')
  const { markBotSentMessage } = await import('../lib/auto-download.js')
  const { loadAsistenConfig } = await import('../lib/owner-assistant.js')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'asisten-regression-'))
  const previousDataDir = process.env.ALVARETH_DATA_DIR
  process.env.ALVARETH_DATA_DIR = directory
  const chat = '6281222222222@s.whatsapp.net'
  const pendingKey = chat + ':' + chat
  const pending = global.__alvarethAsistenPending
  try {
    const samples = [
      { action: 'apikey', typed: key, expected: 'groqApiKey' },
      { action: 'target', typed: '6281333333333', expected: 'targets' },
      { action: 'status', typed: 'Owner sedang offline', expected: 'ownerStatus' }
    ]
    for (const { action, typed, expected } of samples) {
      const replies = []
      const createMessage = (content, id) => ({
        chat, sender: chat, senderPN: chat,
        fromMe: true, isGroup: false, id,
        key: { id, remoteJid: chat, fromMe: true },
        rawMessage: { key: { id, remoteJid: chat, fromMe: true }, message: { conversation: content } },
        text: content,
        reply: async message => { replies.push(message) }
      })
      await asisten(createMessage('.asisten ' + action, 'command-' + action), {
        conn: {}, text: action
      })
      assert.equal(pending.get(pendingKey)?.kind, action)
      assert.equal(replies.length, 1)

      const sentByBot = createMessage(replies[0], 'bot-prompt-' + action)
      markBotSentMessage(sentByBot)
      await asisten.all.call({}, sentByBot, { isROwner: true })
      assert.equal(replies.length, 1, 'tracked bot prompt must not trigger an error')
      assert.equal(pending.get(pendingKey)?.kind, action)

      // Covers the small window where WhatsApp echoes an outgoing prompt
      // before sendMessage registers its message ID.
      const earlyEcho = createMessage(replies[0], 'early-echo-' + action)
      await asisten.all.call({}, earlyEcho, { isROwner: true })
      assert.equal(replies.length, 1, 'untracked setup prompt must not be accepted')
      assert.equal(pending.get(pendingKey)?.kind, action)

      // A message typed manually on the same linked account is fromMe too.
      // It must still work when its ID has not been marked as bot-generated.
      const humanInput = createMessage(typed, 'manual-input-' + action)
      await asisten.all.call({}, humanInput, { isROwner: true })
      assert.equal(pending.has(pendingKey), false, 'human input should consume the prompt')
      assert.match(humanInput.text, /^\[ASISTEN /)
      assert.equal(replies.length, 2, 'human input receives exactly one acknowledgment')
      const stored = await loadAsistenConfig()
      if (expected === 'groqApiKey') assert.equal(stored.groqApiKey, typed)
      if (expected === 'targets') assert.ok(stored.targets.includes(typed))
      if (expected === 'ownerStatus') assert.equal(stored.ownerStatus, typed)
    }
  } finally {
    pending.delete(pendingKey)
    if (previousDataDir === undefined) delete process.env.ALVARETH_DATA_DIR
    else process.env.ALVARETH_DATA_DIR = previousDataDir
    await fs.rm(directory, { recursive: true, force: true })
  }
})
