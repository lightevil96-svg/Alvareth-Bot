import test from 'node:test'
import assert from 'node:assert/strict'
import { runAutomaticUpdate } from '../lib/auto-update.js'

test('automatic update reuses the owner updater and writes status only to server logs', async () => {
  const calls = []
  const updater = async (message, context) => {
    calls.push(context)
    await message.reply('Memeriksa perubahan GitHub')
  }
  const result = await runAutomaticUpdate(updater)
  assert.equal(result, true)
  assert.deepEqual(calls, [{ isOwner: true }])
})

test('automatic update skips while the manual updater owns the update lock', async () => {
  global.__alvarethUpdateRunning = true
  try {
    let called = false
    const result = await runAutomaticUpdate(async () => { called = true })
    assert.equal(result, false)
    assert.equal(called, false)
  } finally {
    delete global.__alvarethUpdateRunning
  }
})

test('automatic update prevents overlapping checks', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const first = runAutomaticUpdate(async () => pending)
  const second = await runAutomaticUpdate(async () => { throw new Error('overlap') })
  assert.equal(second, false)
  release()
  assert.equal(await first, true)
})

test('automatic update respects AUTO_UPDATE_ENABLED=false', async () => {
  const previous = process.env.AUTO_UPDATE_ENABLED
  process.env.AUTO_UPDATE_ENABLED = 'false'
  try {
    let called = false
    const result = await runAutomaticUpdate(async () => { called = true })
    assert.equal(result, false)
    assert.equal(called, false)
  } finally {
    if (previous === undefined) delete process.env.AUTO_UPDATE_ENABLED
    else process.env.AUTO_UPDATE_ENABLED = previous
  }
})

test('automatic update safely skips when the updater plugin is unavailable', async () => {
  assert.equal(await runAutomaticUpdate(null), false)
})
