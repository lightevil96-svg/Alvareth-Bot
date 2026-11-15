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
