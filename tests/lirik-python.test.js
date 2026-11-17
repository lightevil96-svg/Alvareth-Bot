import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  ensureLirikPythonDependencies,
  getLirikVenvPythonPath,
  resolveLirikPythonExecutable
} from '../lib/lirik-python.js'

async function createProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-lirik-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'requirements-lirik.txt'),
    'faster-whisper>=1.1.0,<2\nrapidocr>=3.10,<3.11\nopencv-python-headless>=4.9,<5.0\n')
  return root
}

test('manual setup creates a private venv, installs requirements, and skips unchanged dependencies', async t => {
  const root = await createProject(t)
  const stateDirectory = path.join(root, 'private-state')
  const pythonPath = getLirikVenvPythonPath(root, 'linux')
  const calls = []
  const replies = []
  let importsReady = false

  const run = async (command, args, options) => {
    calls.push({ command, args, options })
    if (args[0] === '-m' && args[1] === 'venv') {
      await fs.mkdir(path.dirname(pythonPath), { recursive: true })
      await fs.writeFile(pythonPath, '')
      return
    }
    if (args[0] === '-c') {
      if (!importsReady) throw new Error('Python modules are missing')
      return
    }
    if (args[0] === '-m' && args[1] === 'pip') {
      importsReady = true
      return
    }
    throw new Error('Unexpected command: ' + command + ' ' + args.join(' '))
  }

  const first = await ensureLirikPythonDependencies({
    root, stateDirectory, env: {}, run,
    reply: message => replies.push(message)
  })
  assert.equal(first.ready, true)
  assert.equal(first.installed, true)
  assert.equal(first.pythonPath, pythonPath)
  assert.equal(calls.filter(call => call.args[0] === '-m' && call.args[1] === 'venv').length, 1)
  assert.equal(calls.filter(call => call.args[0] === '-m' && call.args[1] === 'pip').length, 1)
  assert.equal(replies.length, 2)

  const second = await ensureLirikPythonDependencies({ root, stateDirectory, env: {}, run })
  assert.equal(second.installed, false)
  assert.equal(calls.filter(call => call.args[0] === '-m' && call.args[1] === 'pip').length, 1)

  await fs.appendFile(path.join(root, 'requirements-lirik.txt'), '# dependency revision\n')
  const third = await ensureLirikPythonDependencies({ root, stateDirectory, env: {}, run })
  assert.equal(third.installed, true)
  assert.equal(calls.filter(call => call.args[0] === '-m' && call.args[1] === 'pip').length, 2)
})

test('configured ALVARETH_LIRIK_PYTHON is respected without creating a second venv', async t => {
  const root = await createProject(t)
  const stateDirectory = path.join(root, 'private-state')
  const calls = []
  let importsReady = false
  const run = async (command, args) => {
    calls.push({ command, args })
    if (args[0] === '-c') {
      if (!importsReady) throw new Error('Python modules are missing')
      return
    }
    if (args[0] === '-m' && args[1] === 'pip') {
      importsReady = true
      return
    }
    throw new Error('Unexpected command: ' + command + ' ' + args.join(' '))
  }

  const result = await ensureLirikPythonDependencies({
    root, stateDirectory, env: { ALVARETH_LIRIK_PYTHON: '/opt/python/bin/python3' }, run
  })
  assert.equal(result.pythonPath, '/opt/python/bin/python3')
  assert.equal(calls[0].command, '/opt/python/bin/python3')
  assert.equal(calls.some(call => call.args[0] === '-m' && call.args[1] === 'venv'), false)
})

test('transcription resolves the managed venv by default and honors an explicit override', async t => {
  const root = await createProject(t)
  assert.equal(await resolveLirikPythonExecutable({ root, env: {} }), 'python3')

  const pythonPath = getLirikVenvPythonPath(root, 'linux')
  await fs.mkdir(path.dirname(pythonPath), { recursive: true })
  await fs.writeFile(pythonPath, '')
  assert.equal(await resolveLirikPythonExecutable({ root, env: {} }), pythonPath)
  assert.equal(
    await resolveLirikPythonExecutable({ root, env: { ALVARETH_LIRIK_PYTHON: '/custom/python' } }),
    '/custom/python'
  )
})
