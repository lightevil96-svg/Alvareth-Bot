import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const MARKER_FILE = 'lirik-python-deps-v1.json'
const IMPORT_CHECK = 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"; import faster_whisper, rapidocr, cv2'
const DEFAULT_STATE_DIRECTORY = path.join(os.homedir(), '.alvareth-bot-data')

function appendTail(current, chunk, maxLength = 8000) {
  return (current + chunk.toString('utf8')).slice(-maxLength)
}

function runCommand(command, args, { cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }

    child.stdout.on('data', chunk => {
      stdout = appendTail(stdout, chunk)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr = appendTail(stderr, chunk)
      process.stderr.write(chunk)
    })
    child.once('error', error => finish(new Error(
      'Tidak dapat menjalankan ' + command + ': ' + error.message,
      { cause: error }
    )))
    child.once('close', (code, signal) => {
      if (code === 0) return finish(null, { stdout, stderr })
      finish(new Error(
        command + ' ' + args.join(' ') + ' keluar dengan kode ' +
        (code ?? signal ?? 'tidak diketahui') + ': ' +
        (stderr || stdout || 'tanpa detail tambahan').trim().slice(-1200)
      ))
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(
        command + ' melewati batas waktu ' + Math.round(timeoutMs / 1000) + ' detik.'
      ))
    }, timeoutMs)
    timer.unref?.()
  })
}

export function getLirikVenvPythonPath(root = process.cwd(), platform = process.platform) {
  return path.resolve(root, '.venv-lirik',
    platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'))
}

export async function resolveLirikPythonExecutable({
  root = process.cwd(),
  env = process.env,
  platform = process.platform
} = {}) {
  const configured = String(env.ALVARETH_LIRIK_PYTHON || '').trim()
  if (configured) return configured

  const venvPython = getLirikVenvPythonPath(root, platform)
  try {
    await fs.access(venvPython)
    return venvPython
  } catch {
    return 'python3'
  }
}

async function safeReply(reply, message) {
  try { await reply?.(message) } catch {}
}

function shortError(error) {
  return String(error?.message || error || 'penyebab tidak diketahui')
    .replace(/[\r\n]+/g, ' ')
    .slice(-1200)
}

export async function ensureLirikPythonDependencies({
  root = process.cwd(),
  stateDirectory = String(process.env.ALVARETH_DATA_DIR || DEFAULT_STATE_DIRECTORY),
  env = process.env,
  platform = process.platform,
  run = runCommand,
  reply = async () => {}
} = {}) {
  root = path.resolve(root)
  stateDirectory = path.resolve(stateDirectory)
  const requirementsPath = path.join(root, 'requirements-lirik.txt')
  let requirements
  try {
    requirements = await fs.readFile(requirementsPath)
  } catch (error) {
    throw new Error('File requirements-lirik.txt tidak ditemukan atau tidak dapat dibaca: ' + error.message)
  }
  if (!requirements.length) throw new Error('requirements-lirik.txt kosong; dependensi .lirik tidak dapat dipasang.')

  const requirementsHash = crypto.createHash('sha256').update(requirements).digest('hex')
  const configuredPython = String(env.ALVARETH_LIRIK_PYTHON || '').trim()
  const venvDirectory = path.join(root, '.venv-lirik')
  const pythonPath = configuredPython || getLirikVenvPythonPath(root, platform)

  if (!configuredPython) {
    let venvExists = false
    try {
      const stat = await fs.lstat(venvDirectory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Folder .venv-lirik harus berupa direktori biasa, bukan symlink atau file.')
      }
      venvExists = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }

    try {
      await fs.access(pythonPath)
    } catch {
      await safeReply(reply, '🐍 Menyiapkan lingkungan Python khusus untuk fitur .lirik...')
      const bootstrapPython = String(env.ALVARETH_LIRIK_BOOTSTRAP_PYTHON || 'python3').trim() || 'python3'
      const args = venvExists
        ? ['-m', 'venv', '--upgrade', venvDirectory]
        : ['-m', 'venv', venvDirectory]
      try {
        await run(bootstrapPython, args, { cwd: root, timeoutMs: 120_000 })
        await fs.access(pythonPath)
      } catch (error) {
        throw new Error(
          'Gagal membuat .venv-lirik. Pastikan server menyediakan Python 3.10+ beserta modul venv/ensurepip. ' +
          'Pada image Debian, penyedia server mungkin perlu memasang paket python3-venv. Detail: ' +
          shortError(error)
        )
      }
    }
  }

  const markerPath = path.join(stateDirectory, MARKER_FILE)
  let marker = null
  try {
    marker = JSON.parse(await fs.readFile(markerPath, 'utf8'))
  } catch {}

  let importsReady = false
  try {
    await run(pythonPath, ['-c', IMPORT_CHECK], { cwd: root, timeoutMs: 60_000 })
    importsReady = true
  } catch {}

  if (importsReady &&
      marker?.schema === 1 &&
      marker.requirementsHash === requirementsHash &&
      marker.pythonPath === pythonPath) {
    return { ready: true, installed: false, pythonPath, requirementsHash }
  }

  await safeReply(reply, '📦 Memasang atau memperbarui faster-whisper, RapidOCR, dan OpenCV untuk .lirik. Proses pertama dapat memerlukan waktu beberapa menit...')
  try {
    await run(pythonPath, [
      '-m', 'pip', 'install',
      '--disable-pip-version-check',
      '--no-input',
      '-r', requirementsPath
    ], { cwd: root, timeoutMs: 20 * 60_000 })
    await run(pythonPath, ['-c', IMPORT_CHECK], { cwd: root, timeoutMs: 60_000 })
  } catch (error) {
    throw new Error(
      'Instalasi dependensi .lirik gagal. Periksa Python 3.10+, modul pip/venv, koneksi internet, dan ruang disk server. Detail: ' +
      shortError(error)
    )
  }

  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const tempPath = markerPath + '.tmp-' + process.pid
  const nextMarker = {
    schema: 1,
    requirementsHash,
    pythonPath,
    installedAt: new Date().toISOString()
  }
  await fs.writeFile(tempPath, JSON.stringify(nextMarker, null, 2) + '\n', { mode: 0o600 })
  await fs.chmod(tempPath, 0o600).catch(() => {})
  await fs.rename(tempPath, markerPath)

  return { ready: true, installed: true, pythonPath, requirementsHash }
}
