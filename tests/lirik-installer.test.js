import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const installerPath = path.resolve('scripts/install-lirik-deps.js')

test('installer creates a managed venv, installs packages and skips unchanged requirements', {
  skip: process.platform === 'win32' ? 'Fake Python executable uses a POSIX shebang.' : false
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-lirik-installer-'))
  try {
    await fs.writeFile(path.join(root, 'requirements-lirik.txt'),
      'faster-whisper>=1.1.0,<2\nrapidocr>=3.10,<3.11\nopencv-python-headless>=4.9,<5.0\n')

    const fakePython = path.join(root, 'fake-python')
    await fs.writeFile(fakePython, String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '-m' && args[1] === 'venv') {
  const bin = path.join(args[2], 'bin')
  fs.mkdirSync(bin, { recursive: true })
  const target = path.join(bin, 'python')
  fs.copyFileSync(process.argv[1], target)
  fs.chmodSync(target, 0o755)
  process.exit(0)
}
if (args[0] === '-m' && args[1] === 'pip' && args[2] === '--version') process.exit(0)
if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'install') {
  fs.writeFileSync(path.join(path.dirname(process.argv[1]), 'pip-install-ran'), 'yes')
  process.exit(0)
}
if (args[0] === '-c') process.exit(0)
process.exit(2)
`, { mode: 0o755 })

    const venv = path.join(root, '.venv-lirik')
    const env = {
      ...process.env,
      ALVARETH_LIRIK_BOOTSTRAP_PYTHON: fakePython,
      ALVARETH_LIRIK_VENV: venv,
      CI: 'true'
    }

    const first = await execFileAsync(process.execPath, [installerPath, '--strict'], {
      cwd: root,
      env,
      timeout: 30_000
    })
    assert.match(first.stdout, /LIRIK READY/)
    await fs.access(path.join(venv, '.requirements.sha256'))
    await fs.access(path.join(venv, 'bin', 'pip-install-ran'))

    const second = await execFileAsync(process.execPath, [installerPath, '--strict'], {
      cwd: root,
      env,
      timeout: 30_000
    })
    assert.match(second.stdout, /tidak perlu instalasi ulang/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
