import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  persistRenderOutputSession,
  restorePendingRenderSessions
} from '../lib/render-session-store.js'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-render-store-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = await fs.mkdtemp(path.join(root, 'alvareth-render-'))
  const outputPath = path.join(directory, 'render-result.mp4')
  await fs.writeFile(outputPath, Buffer.from('rendered-video'))
  return { root, directory, outputPath }
}

test('persists and restores a completed output without holding the update lock', async t => {
  const { root, directory, outputPath } = await fixture(t)
  await persistRenderOutputSession({
    root,
    directory,
    key: 'chat@s.whatsapp.net|owner@s.whatsapp.net',
    outputPath,
    outputFileName: 'render-result.mp4',
    createdAt: Date.now() - 1000
  })

  const restored = await restorePendingRenderSessions({ root })
  assert.equal(restored.length, 1)
  assert.equal(restored[0].key, 'chat@s.whatsapp.net|owner@s.whatsapp.net')
  assert.equal(restored[0].session.outputPath, outputPath)
  assert.equal(restored[0].session.outputSize, Buffer.byteLength('rendered-video'))
  assert.equal(restored[0].session.processing, false)
  assert.equal(restored[0].session.updateLockHeld, false)
  assert.equal(restored[0].session.restored, true)
})

test('rejects output files outside the render session directory', async t => {
  const { root, directory } = await fixture(t)
  const outsidePath = path.join(root, 'render-result.mp4')
  await fs.writeFile(outsidePath, 'outside')

  await assert.rejects(
    persistRenderOutputSession({
      root,
      directory,
      key: 'chat|owner',
      outputPath: outsidePath,
      outputFileName: 'render-result.mp4'
    }),
    /di luar direktori sesi/
  )
})

test('does not restore a session whose output file is missing', async t => {
  const { root, directory, outputPath } = await fixture(t)
  await persistRenderOutputSession({
    root, directory, key: 'chat|owner', outputPath, outputFileName: 'render-result.mp4'
  })
  await fs.rm(outputPath)

  await assert.rejects(
    restorePendingRenderSessions({ root }),
    /ENOENT|no such file/i
  )
})

test('blocks recovery when a saved manifest is corrupt', async t => {
  const { root, directory, outputPath } = await fixture(t)
  await persistRenderOutputSession({
    root, directory, key: 'chat|owner', outputPath, outputFileName: 'render-result.mp4'
  })
  await fs.writeFile(path.join(directory, 'render-session.json'), '{broken json')

  await assert.rejects(
    restorePendingRenderSessions({ root }),
    /Manifest sesi render tidak dapat dibaca/
  )
})

test('ignores expired completed render sessions', async t => {
  const { root, directory, outputPath } = await fixture(t)
  await persistRenderOutputSession({
    root,
    directory,
    key: 'chat|owner',
    outputPath,
    outputFileName: 'render-result.mp4',
    createdAt: Date.now() - 2 * 60 * 60 * 1000
  })

  const restored = await restorePendingRenderSessions({
    root,
    staleTtlMs: 60 * 60 * 1000
  })
  assert.equal(restored.length, 0)
})

test('rejects a symlink as the persisted render output', async t => {
  const { root, directory, outputPath } = await fixture(t)
  const target = path.join(directory, 'actual.mp4')
  await fs.rename(outputPath, target)
  await fs.symlink(target, outputPath)

  await assert.rejects(
    persistRenderOutputSession({
      root,
      directory,
      key: 'chat|owner',
      outputPath,
      outputFileName: 'render-result.mp4'
    }),
    /file biasa, bukan symlink/
  )
})

test('rejects an unsafe manifest output filename', async t => {
  const { root, directory, outputPath } = await fixture(t)
  await assert.rejects(
    persistRenderOutputSession({
      root,
      directory,
      key: 'chat|owner',
      outputPath,
      outputFileName: '../render-result.mp4'
    }),
    /di luar direktori sesi/
  )
})
