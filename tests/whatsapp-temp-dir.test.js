import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureWhatsAppTempDir } from '../lib/whatsapp-temp-dir.js'

function preserveTempEnvironment(t) {
  const keys = ['ALVARETH_DATA_DIR', 'ALVARETH_WA_TMPDIR', 'TMPDIR']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  })
}

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alvareth-wa-temp-test-'))
}

test('defaults Node/Baileys temp storage to the persistent bot data directory', t => {
  preserveTempEnvironment(t)
  const root = makeRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  process.env.ALVARETH_DATA_DIR = root
  delete process.env.ALVARETH_WA_TMPDIR
  process.env.TMPDIR = '/tmp'

  const result = configureWhatsAppTempDir({ log() {}, warn() {} })
  const expected = path.join(root, 'tmp')

  assert.equal(result.path, expected)
  assert.equal(process.env.TMPDIR, expected)
  assert.equal(os.tmpdir(), expected)

  const probe = path.join(os.tmpdir(), 'write-test.txt')
  fs.writeFileSync(probe, 'writable')
  assert.equal(fs.readFileSync(probe, 'utf8'), 'writable')
  fs.rmSync(probe, { force: true })
})

test('honors an explicit ALVARETH_WA_TMPDIR override', t => {
  preserveTempEnvironment(t)
  const root = makeRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const custom = path.join(root, 'custom-temp')
  process.env.ALVARETH_DATA_DIR = path.join(root, 'data')
  process.env.ALVARETH_WA_TMPDIR = custom

  const result = configureWhatsAppTempDir({ log() {}, warn() {} })

  assert.equal(result.path, custom)
  assert.equal(result.source, 'ALVARETH_WA_TMPDIR')
  assert.equal(os.tmpdir(), custom)
})

test('falls back to the managed data directory when the override is unusable', t => {
  preserveTempEnvironment(t)
  const root = makeRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const invalidOverride = path.join(root, 'not-a-directory')
  fs.writeFileSync(invalidOverride, 'occupied')
  const dataDir = path.join(root, 'data')
  process.env.ALVARETH_DATA_DIR = dataDir
  process.env.ALVARETH_WA_TMPDIR = invalidOverride

  const warnings = []
  const result = configureWhatsAppTempDir({
    log() {},
    warn(message) { warnings.push(message) }
  })

  assert.equal(result.path, path.join(dataDir, 'tmp'))
  assert.equal(os.tmpdir(), result.path)
  assert.equal(warnings.length, 1)
})

test('main configures TMPDIR before importing Baileys', () => {
  const source = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8')
  const dotenvImport = source.indexOf("import 'dotenv/config'")
  const bootstrapImport = source.indexOf("import './lib/whatsapp-temp-bootstrap.js'")
  const baileysImport = source.indexOf("from 'baileys'")

  assert.ok(dotenvImport >= 0, 'dotenv must load before temp configuration')
  assert.ok(bootstrapImport > dotenvImport, 'temp bootstrap must run after dotenv')
  assert.ok(baileysImport > bootstrapImport, 'temp bootstrap must precede Baileys imports')
})
