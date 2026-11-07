import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRenderSessionKey, getCurrentRenderDocument, isRenderDocumentEvent } from '../lib/render-message.js'
import {
  normalizeShellScript,
  normalizeArchiveEntryPath,
  extractRenderArchive,
  findRenderScript,
  runRenderScript,
  findRenderOutput
} from '../lib/render-script.js'

test('normalizeShellScript removes BOM and normalizes Windows line endings', () => {
  const source = normalizeShellScript(Buffer.from('\uFEFF#!/bin/bash\r\nprintf ok\r\n', 'utf8'))
  assert.equal(source, '#!/bin/bash\nprintf ok\n')
})

test('normalizeShellScript rejects empty, oversized, NUL, and invalid UTF-8 files', () => {
  assert.throws(() => normalizeShellScript(Buffer.alloc(0)), /kosong/)
  assert.throws(() => normalizeShellScript(Buffer.from([0x61, 0x00, 0x62])), /NUL/)
  assert.throws(() => normalizeShellScript(Buffer.from([0xff, 0xfe])), /UTF-8/)
  assert.throws(() => normalizeShellScript(Buffer.alloc(20), 10), /batas ukuran/)
})

test('runRenderScript executes in its job directory with a minimal environment', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const scriptPath = path.join(directory, 'render.sh')
  const inputPath = path.join(directory, '378541.mp4')
  const outputPath = path.join(directory, 'jumpscare_short.mp4')
  const envPath = path.join(directory, 'env-check.txt')

  await writeFile(inputPath, 'fake-input')
  await writeFile(scriptPath, [
    'printf "fake-rendered-video" > jumpscare_short.mp4',
    'printenv RENDER_TEST_SECRET > env-check.txt || printf not-inherited > env-check.txt'
  ].join('\n') + '\n')

  const result = await runRenderScript({
    scriptPath,
    workingDirectory: directory,
    inputPath,
    timeoutMs: 5000,
    env: { PATH: process.env.PATH, RENDER_TEST_SECRET: 'must-not-leak' }
  })

  assert.equal(result.code, 0)
  assert.equal(await readFile(outputPath, 'utf8'), 'fake-rendered-video')
  assert.equal(await readFile(envPath, 'utf8'), 'not-inherited')
})

test('runRenderScript terminates a script that exceeds its timeout', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-timeout-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const scriptPath = path.join(directory, 'render.sh')
  const inputPath = path.join(directory, 'input.mp4')
  await writeFile(inputPath, 'input')
  await writeFile(scriptPath, 'sleep 5\n')

  await assert.rejects(
    runRenderScript({ scriptPath, workingDirectory: directory, inputPath, timeoutMs: 100 }),
    error => error.code === 'RENDER_SCRIPT_TIMEOUT'
  )
})

test('runRenderScript rejects script and input paths outside the job directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-path-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outside = path.join(directory, 'outside.sh')
  const work = path.join(directory, 'work')
  await mkdir(work)
  await writeFile(outside, 'exit 0\n')
  await writeFile(path.join(work, 'input.mp4'), 'input')

  await assert.rejects(
    runRenderScript({
      scriptPath: outside,
      workingDirectory: work,
      inputPath: path.join(work, 'input.mp4')
    }),
    /di dalam folder kerja/
  )
})

test('findRenderOutput prefers the expected final file over a larger intermediate MP4', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-output-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const inputPath = path.join(directory, '378541.mp4')
  const intermediatePath = path.join(directory, 'scene-intermediate.mp4')
  const finalPath = path.join(directory, 'jumpscare_short.mp4')
  const scriptPath = path.join(directory, 'render.sh')

  await writeFile(inputPath, 'source-video')
  await writeFile(scriptPath, 'exit 0\n')
  await writeFile(intermediatePath, Buffer.alloc(4096))
  await writeFile(finalPath, Buffer.from('final-video'))
  await symlink(finalPath, path.join(directory, 'linked-output.mp4'))

  const output = await findRenderOutput(directory, {
    excludePaths: [inputPath, scriptPath],
    startedAt: Date.now() - 3000
  })

  assert.equal(output?.path, finalPath)
  assert.equal(output?.size, Buffer.byteLength('final-video'))
})


function makeFakeZip(entries) {
  const files = {}
  for (const item of entries) {
    const data = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data ?? '')
    files[item.name] = {
      name: item.name,
      unsafeOriginalName: item.unsafeOriginalName ?? item.name,
      dir: item.dir ?? item.name.endsWith('/'),
      unixPermissions: item.unixPermissions,
      _data: { uncompressedSize: data.length },
      async: async () => Buffer.from(data)
    }
  }
  return { files }
}

test('normalizeArchiveEntryPath preserves nested package paths and rejects traversal or absolute paths', () => {
  assert.equal(normalizeArchiveEntryPath('pack/assets/c1.png'), 'pack/assets/c1.png')
  assert.equal(normalizeArchiveEntryPath('pack/'), 'pack')
  assert.throws(() => normalizeArchiveEntryPath('../outside.sh'), /tidak aman/)
  assert.throws(() => normalizeArchiveEntryPath('/tmp/outside.sh'), /tidak aman/)
  assert.throws(() => normalizeArchiveEntryPath('C:/outside.sh'), /tidak aman/)
  assert.throws(() => normalizeArchiveEntryPath('pack\\..\\outside.sh'), /tidak aman/)
  assert.throws(() => normalizeArchiveEntryPath('pack//assets.png'), /tidak aman/)
})

test('extractRenderArchive preserves the Claude package folders and locates its render.sh', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-zip-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'package')
  const archive = makeFakeZip([
    { name: 'pack/', dir: true, data: '' },
    { name: 'pack/render.sh', data: '#!/usr/bin/env bash\\necho ok\\n' },
    { name: 'pack/assets/', dir: true, data: '' },
    { name: 'pack/assets/c1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { name: 'pack/Poppins-Bold.ttf', data: 'font-data' }
  ])

  const extracted = await extractRenderArchive(Buffer.from('fake-zip'), root, {
    loadZip: async () => archive
  })
  const scriptPath = await findRenderScript(root)
  assert.equal(path.relative(root, scriptPath), path.join('pack', 'render.sh'))
  assert.equal(extracted.files.length, 3)
  assert.deepEqual(await readFile(path.join(root, 'pack', 'assets', 'c1.png')), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.equal(await readFile(path.join(root, 'pack', 'Poppins-Bold.ttf'), 'utf8'), 'font-data')
})

test('extractRenderArchive rejects path traversal and symbolic links', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-zip-safe-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  await assert.rejects(
    extractRenderArchive(Buffer.from('fake-zip'), path.join(directory, 'traversal'), {
      loadZip: async () => makeFakeZip([
        { name: '../outside.sh', unsafeOriginalName: '../outside.sh', data: 'bad' }
      ])
    }),
    /tidak aman/
  )

  await assert.rejects(
    extractRenderArchive(Buffer.from('fake-zip'), path.join(directory, 'symlink'), {
      loadZip: async () => makeFakeZip([
        { name: 'pack/link', unixPermissions: 0o120777, data: 'outside-target' }
      ])
    }),
    /symbolic link/
  )
})

test('extractRenderArchive enforces item, per-file, and total uncompressed size limits', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-zip-limits-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  await assert.rejects(
    extractRenderArchive(Buffer.from('fake-zip'), path.join(directory, 'items'), {
      maxEntries: 1,
      loadZip: async () => makeFakeZip([
        { name: 'one.txt', data: '1' },
        { name: 'two.txt', data: '2' }
      ])
    }),
    /terlalu banyak item/
  )

  await assert.rejects(
    extractRenderArchive(Buffer.from('fake-zip'), path.join(directory, 'file'), {
      maxFileBytes: 4,
      loadZip: async () => makeFakeZip([{ name: 'large.bin', data: Buffer.alloc(5) }])
    }),
    /terlalu besar/
  )

  await assert.rejects(
    extractRenderArchive(Buffer.from('fake-zip'), path.join(directory, 'total'), {
      maxTotalBytes: 5,
      loadZip: async () => makeFakeZip([
        { name: 'a.bin', data: Buffer.alloc(3) },
        { name: 'b.bin', data: Buffer.alloc(3) }
      ])
    }),
    /Ukuran total/
  )
})

test('findRenderScript rejects archives with missing or ambiguous entry points', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-entry-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'empty'))
  await assert.rejects(findRenderScript(path.join(directory, 'empty')), /tidak memiliki file render.sh/)

  const duplicate = path.join(directory, 'duplicate')
  await mkdir(path.join(duplicate, 'one'), { recursive: true })
  await mkdir(path.join(duplicate, 'two'), { recursive: true })
  await writeFile(path.join(duplicate, 'one', 'render.sh'), 'echo one')
  await writeFile(path.join(duplicate, 'two', 'render.sh'), 'echo two')
  await assert.rejects(findRenderScript(duplicate), /lebih dari satu render.sh/)
})


test('extracted render package runs from its own directory with the replied video as input', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-render-package-run-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const packageRoot = path.join(directory, 'package')
  const archive = makeFakeZip([
    { name: 'pack/', dir: true, data: '' },
    {
      name: 'pack/render.sh',
      data: '#!/usr/bin/env bash\nset -euo pipefail\ntest -f assets/overlay.png\ntest -f 378541.mp4\ncp "$1" jumpscare_short.mp4\n'
    },
    { name: 'pack/assets/', dir: true, data: '' },
    { name: 'pack/assets/overlay.png', data: 'overlay' }
  ])

  await extractRenderArchive(Buffer.from('fake-zip'), packageRoot, {
    loadZip: async () => archive
  })
  const scriptPath = await findRenderScript(packageRoot)
  const scriptDirectory = path.dirname(scriptPath)
  const inputPath = path.join(scriptDirectory, '378541.mp4')
  await writeFile(inputPath, 'replied-video')

  const startedAt = Date.now() - 3000
  const execution = await runRenderScript({
    scriptPath,
    workingDirectory: scriptDirectory,
    inputPath,
    timeoutMs: 5000
  })
  assert.equal(execution.code, 0)

  const output = await findRenderOutput(scriptDirectory, {
    excludePaths: [scriptPath, inputPath],
    startedAt
  })
  assert.equal(output?.name, 'jumpscare_short.mp4')
  assert.equal(await readFile(output.path, 'utf8'), 'replied-video')
})


test('render message parser detects ZIP documents inside WhatsApp wrappers', () => {
  const media = {
    fileName: 'pack.zip',
    mimetype: 'application/zip',
    fileLength: 220 * 1024
  }
  const message = {
    mtype: 'ephemeralMessage',
    rawMessage: {
      message: {
        ephemeralMessage: {
          message: {
            documentMessage: media
          }
        }
      }
    }
  }

  assert.equal(isRenderDocumentEvent(message), true)
  assert.equal(getCurrentRenderDocument(message), media)
})

test('render message parser uses direct serialized document metadata as fallback', () => {
  const media = { fileName: 'pack.zip', mimetype: 'application/zip' }
  const message = { mtype: 'documentMessage', msg: media }
  assert.equal(isRenderDocumentEvent(message), true)
  assert.equal(getCurrentRenderDocument(message), media)
})

test('render session keys normalize phone aliases and WhatsApp device suffixes', () => {
  const first = createRenderSessionKey({
    chat: '6285184063794:12@s.whatsapp.net',
    senderPN: '+6285184063794'
  })
  const second = createRenderSessionKey({
    chat: '6285184063794@s.whatsapp.net',
    sender: '6285184063794:4@s.whatsapp.net'
  })
  assert.equal(first, second)
})
