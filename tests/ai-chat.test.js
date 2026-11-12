import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  askFreeAi,
  buildPollinationsImageUrl,
  aiErrorMessage
} from '../lib/ai-chat.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const aiDir = path.join(repoRoot, 'plugins', 'ai')

function okText(value) {
  return { ok: true, status: 200, text: async () => value, json: async () => ({}) }
}

test('askFreeAi memakai Pollinations bila berhasil', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(String(url))
    return okText('Hai, aku Alya!')
  }
  const answer = await askFreeAi('halo', {
    system: 'You are Alya, a cheerful anime girl.',
    fetchImpl
  })
  assert.equal(answer, 'Hai, aku Alya!')
  assert.equal(calls.length, 1)
  assert.match(calls[0], /text\.pollinations\.ai/)
  assert.match(calls[0], /system=/)
})

test('askFreeAi jatuh ke Nexray bila Pollinations gagal', async () => {
  const fetchImpl = async url => {
    if (String(url).includes('pollinations')) {
      return { ok: false, status: 500, text: async () => '', json: async () => ({}) }
    }
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ status: true, result: '2 + 2 = 4.' })
    }
  }
  const answer = await askFreeAi('2 + 2 = berapa?', { fetchImpl })
  assert.equal(answer, '2 + 2 = 4.')
})

test('askFreeAi melempar error yang jelas bila kedua backend gagal', async () => {
  const fetchImpl = async () => { throw new Error('fetch failed') }
  await assert.rejects(
    askFreeAi('halo', { fetchImpl, timeoutMs: 100 }),
    /tidak tersedia/
  )
  assert.match(aiErrorMessage(new Error('fetch failed')), /tidak tersedia/)
  assert.match(aiErrorMessage(new Error('boom')), /Gagal mendapatkan jawaban AI/)
})

test('buildPollinationsImageUrl membangun URL gambar gratis tanpa key', () => {
  const url = buildPollinationsImageUrl('a red cat', { image: 'https://example.com/cat.jpg' })
  assert.match(url, /image\.pollinations\.ai\/prompt\/a%20red%20cat/)
  assert.match(url, /nologo=true/)
  assert.match(url, /model=flux/)
  assert.match(url, /image=https%3A%2F%2Fexample\.com%2Fcat\.jpg/)
  assert.throws(() => buildPollinationsImageUrl('   '), /Prompt gambar tidak boleh kosong/)
})

test('semua plugin AI lolos node --check dan mengekspor handler dengan command', () => {
  const files = fs.readdirSync(aiDir).filter(file => file.endsWith('.js')).sort()
  assert.ok(files.length >= 30, 'diharapkan puluhan plugin AI, dapat ' + files.length)
  for (const file of files) {
    const fullPath = path.join(aiDir, file)
    execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' })
    const source = fs.readFileSync(fullPath, 'utf-8')
    assert.match(source, /export default handler/, file + ' harus mengekspor handler')
    assert.match(source, /handler\.command\s*=/, file + ' harus punya handler.command')
    assert.match(source, /handler\.help\s*=/, file + ' harus punya handler.help')
  }
})

test('tidak ada plugin AI yang masih memakai backend mati', () => {
  const deadHosts = [
    'puruboy.kozow.com',
    'api-faa.my.id',
    'api.blckrose.my.id',
    'omegatech-api.dixonomega.tech',
    'whatsthebigdata.com',
    'chatopenai.id',
    'cdn.nekohime.site'
  ]
  const files = fs.readdirSync(aiDir).filter(file => file.endsWith('.js'))
  for (const file of files) {
    const source = fs.readFileSync(path.join(aiDir, file), 'utf-8')
    for (const host of deadHosts) {
      assert.ok(!source.includes(host), file + ' masih memakai backend mati ' + host)
    }
    assert.ok(!source.includes('GEMINI_API_KEY'), file + ' tidak boleh memakai GEMINI_API_KEY')
  }
})
