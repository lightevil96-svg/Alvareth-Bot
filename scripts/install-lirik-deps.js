#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const STRICT = process.argv.includes('--strict')
const REQUIREMENTS = path.join(ROOT, 'requirements-lirik.txt')
const BOOTSTRAP_PYTHON = String(
  process.env.ALVARETH_LIRIK_BOOTSTRAP_PYTHON || process.env.PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3')
).trim()
const VENV_DIRECTORY = path.resolve(
  process.env.ALVARETH_LIRIK_VENV || path.join(ROOT, '.venv-lirik')
)
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(VENV_DIRECTORY, 'Scripts', 'python.exe')
  : path.join(VENV_DIRECTORY, 'bin', 'python')
const INSTALL_TIMEOUT_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.ALVARETH_LIRIK_INSTALL_TIMEOUT_MS) || 30 * 60 * 1000
)

function log(message) {
  console.log('[LIRIK-INSTALL] ' + message)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: options.stdio || 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32'
    })
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref?.()
      finish(new Error('Perintah melewati batas waktu ' + Math.round((options.timeout || INSTALL_TIMEOUT_MS) / 60000) + ' menit.'))
    }, options.timeout || INSTALL_TIMEOUT_MS)
    timer.unref?.()
    child.once('error', error => finish(new Error('Tidak dapat menjalankan ' + command + ': ' + error.message)))
    child.once('close', (code, signal) => {
      if (code === 0) return finish(null, { code })
      finish(new Error(
        command + ' ' + args.join(' ') + ' gagal' +
        (code === null ? ' (signal ' + signal + ')' : ' (exit code ' + code + ')')
      ))
    })
  })
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function verifyImports() {
  await run(VENV_PYTHON, [
    '-c',
    'import faster_whisper, rapidocr, cv2; print("faster-whisper, RapidOCR, OpenCV siap")'
  ], { stdio: 'ignore', timeout: 120_000 })
}

async function install() {
  if (!(await fileExists(REQUIREMENTS))) {
    log('requirements-lirik.txt belum ada; instalasi dilewati.')
    return
  }

  if (process.env.CI === 'true' && !STRICT) {
    log('Lingkungan CI terdeteksi; postinstall Python dilewati.')
    return
  }

  if (!BOOTSTRAP_PYTHON) throw new Error('Python bootstrap tidak dikonfigurasi.')
  if (!(await fileExists(VENV_PYTHON))) {
    log('Membuat virtual environment: ' + VENV_DIRECTORY)
    await fs.mkdir(path.dirname(VENV_DIRECTORY), { recursive: true })
    await run(BOOTSTRAP_PYTHON, ['-m', 'venv', VENV_DIRECTORY], { timeout: 5 * 60 * 1000 })
  }

  if (!(await fileExists(VENV_PYTHON))) {
    throw new Error('Python virtual environment tidak terbentuk. Pastikan Python 3 dan modul venv tersedia (pada Debian/Ubuntu: python3-venv).')
  }

  const requirementsBuffer = await fs.readFile(REQUIREMENTS)
  const requirementsHash = crypto.createHash('sha256').update(requirementsBuffer).digest('hex')
  const stampPath = path.join(VENV_DIRECTORY, '.requirements.sha256')
  const installedHash = await fs.readFile(stampPath, 'utf8').catch(() => '')

  if (installedHash.trim() === requirementsHash) {
    try {
      await verifyImports()
      log('Dependensi Whisper, RapidOCR, dan OpenCV sudah sesuai; tidak perlu instalasi ulang.')
      return
    } catch {
      log('Pemeriksaan modul gagal; dependensi akan dipasang ulang.')
    }
  }

  try {
    await run(VENV_PYTHON, ['-m', 'pip', '--version'], { stdio: 'ignore', timeout: 60_000 })
  } catch {
    log('Memulihkan pip di virtual environment.')
    await run(VENV_PYTHON, ['-m', 'ensurepip', '--upgrade'], { timeout: 3 * 60 * 1000 })
  }

  log('Memasang faster-whisper, RapidOCR, dan OpenCV. Instalasi pertama dapat memerlukan beberapa menit.')
  await run(VENV_PYTHON, [
    '-m', 'pip', 'install', '--disable-pip-version-check',
    '-r', REQUIREMENTS
  ])
  await verifyImports()
  await fs.writeFile(stampPath, requirementsHash + '\n', { mode: 0o600 })
  log('LIRIK READY — faster-whisper, RapidOCR, dan OpenCV berhasil dipasang.')
}

install().catch(error => {
  console.error('[LIRIK-INSTALL] ' + String(error?.stack || error))
  if (STRICT) process.exitCode = 1
  else log('Peringatan: instalasi Python belum selesai. Pembaruan Node tetap dilanjutkan; jalankan .update lagi untuk mencoba ulang.')
})
