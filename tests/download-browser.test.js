import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  decodeDownloadPath,
  encodeDownloadPath,
  formatDownloadSize,
  getDownloadRoot,
  listDownloadEntries,
  resolveDownloadPath
} from '../lib/download-browser.js'

test('download path tokens round-trip Unicode folder names', () => {
  const relative = 'clip/Video liburan 你好.mp4'
  assert.equal(decodeDownloadPath(encodeDownloadPath(relative)), relative)
  assert.throws(() => decodeDownloadPath('../secret'), /tidak valid/)
})

test('downloads browser lists folders first and hides dotfiles and symlinks', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-download-test-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const root = await getDownloadRoot(temp)
  await fs.mkdir(path.join(root, 'clip'))
  await fs.writeFile(path.join(root, 'z-video.mp4'), 'video')
  await fs.writeFile(path.join(root, '.env'), 'secret')
  await fs.symlink(path.join(os.tmpdir(), 'outside'), path.join(root, 'outside-link'))

  const result = await listDownloadEntries(root, '.')
  assert.deepEqual(result.entries.map(item => [item.name, item.type]), [
    ['clip', 'directory'],
    ['z-video.mp4', 'file']
  ])
})

test('downloads browser refuses traversal and symlink paths', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-download-safe-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-download-outside-'))
  t.after(async () => {
    await fs.rm(temp, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  })
  const root = await getDownloadRoot(temp)
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')
  await fs.symlink(outside, path.join(root, 'shortcut'))

  await assert.rejects(resolveDownloadPath(root, '../secret.txt'), /di luar folder downloads/)
  await assert.rejects(resolveDownloadPath(root, 'shortcut/secret.txt'), /symlink/)
})

test('downloads browser resolves nested files and formats sizes', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-download-nested-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const root = await getDownloadRoot(temp)
  await fs.mkdir(path.join(root, 'clip'))
  await fs.writeFile(path.join(root, 'clip', 'hasil.mp4'), Buffer.alloc(2048))
  const target = await resolveDownloadPath(root, 'clip/hasil.mp4')
  assert.equal(path.basename(target), 'hasil.mp4')
  assert.equal(formatDownloadSize(2048), '2.0 KB')
})
