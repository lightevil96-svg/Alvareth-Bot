import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  normalizeShellScript,
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
