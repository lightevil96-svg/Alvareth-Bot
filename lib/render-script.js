import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_CAPTURE_CHARS = 12 * 1024
const VIDEO_EXTENSIONS = new Set([
  '.3gp', '.avi', '.flv', '.m4v', '.mkv', '.mov', '.mp4',
  '.mpeg', '.mpg', '.mts', '.ts', '.webm', '.wmv'
])

function appendTail(current, chunk) {
  return (current + Buffer.from(chunk).toString('utf8')).slice(-MAX_CAPTURE_CHARS)
}

function isInside(parent, target) {
  const relative = path.relative(parent, target)
  return Boolean(relative) &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
}

export function normalizeShellScript(input, maxBytes = 256 * 1024) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? '')
  if (!buffer.length) throw new Error('File script .sh kosong.')
  if (buffer.length > maxBytes) throw new Error('File script .sh melebihi batas ukuran.')
  if (buffer.includes(0)) throw new Error('File script .sh berisi byte NUL dan ditolak.')

  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('File script .sh harus menggunakan teks UTF-8 yang valid.')
  }

  source = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!source.trim()) throw new Error('File script .sh tidak berisi perintah.')
  return source.endsWith('\n') ? source : source + '\n'
}

export function createRenderChildEnv(workingDirectory, parentEnv = process.env) {
  const root = path.resolve(workingDirectory)
  const home = path.join(root, '.render-home')
  const temp = path.join(root, '.render-tmp')
  return {
    PATH: String(parentEnv.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
    HOME: home,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8'
  }
}

export async function runRenderScript({
  scriptPath,
  workingDirectory,
  inputPath,
  timeoutMs = 30 * 60 * 1000,
  env = process.env
} = {}) {
  if (!scriptPath || !workingDirectory || !inputPath) {
    throw new Error('Path script, folder kerja, dan video input wajib tersedia.')
  }

  const cwd = path.resolve(workingDirectory)
  const script = path.resolve(scriptPath)
  const input = path.resolve(inputPath)
  if (!isInside(cwd, script) || !isInside(cwd, input)) {
    throw new Error('Script dan video input harus berada di dalam folder kerja render.')
  }

  const [scriptInfo, inputInfo] = await Promise.all([
    fs.lstat(script),
    fs.lstat(input)
  ])
  if (!scriptInfo.isFile() || scriptInfo.isSymbolicLink()) {
    throw new Error('File render.sh harus berupa file biasa, bukan symlink.')
  }
  if (!inputInfo.isFile() || inputInfo.isSymbolicLink()) {
    throw new Error('Video input harus berupa file biasa, bukan symlink.')
  }

  const home = path.join(cwd, '.render-home')
  const temp = path.join(cwd, '.render-tmp')
  await fs.mkdir(home, { recursive: true, mode: 0o700 })
  await fs.mkdir(temp, { recursive: true, mode: 0o700 })

  const parsedTimeout = Number(timeoutMs)
  const timeout = Number.isSafeInteger(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : 30 * 60 * 1000
  const childEnv = createRenderChildEnv(cwd, env)
  const shell = process.platform === 'win32' ? 'bash' : '/bin/bash'
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timeoutTimer
    let killTimer

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
    }

    let child
    const terminate = signal => {
      if (child?.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {}
      }
      try { child?.kill(signal) } catch {}
    }

    try {
      child = spawn(shell, ['--noprofile', '--norc', script, input], {
        cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true
      })
    } catch (error) {
      reject(error)
      return
    }

    child.stdout?.on('data', chunk => { stdout = appendTail(stdout, chunk) })
    child.stderr?.on('data', chunk => { stderr = appendTail(stderr, chunk) })

    timeoutTimer = setTimeout(() => {
      timedOut = true
      terminate('SIGTERM')
      killTimer = setTimeout(() => terminate('SIGKILL'), 5000)
      killTimer.unref?.()
    }, timeout)
    timeoutTimer.unref?.()

    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimers()
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })

    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimers()
      const durationMs = Date.now() - startedAt

      if (timedOut) {
        const error = new Error('Proses render melewati batas waktu ' + Math.round(timeout / 60000) + ' menit.')
        error.code = 'RENDER_SCRIPT_TIMEOUT'
        error.stdout = stdout
        error.stderr = stderr
        error.durationMs = durationMs
        reject(error)
        return
      }

      if (code !== 0) {
        const detail = String(stderr || stdout || '').trim().slice(-2400)
        const error = new Error(
          'Script render keluar dengan kode ' + String(code) +
          (signal ? ' (signal ' + signal + ')' : '') +
          (detail ? ': ' + detail : '.')
        )
        error.code = 'RENDER_SCRIPT_FAILED'
        error.exitCode = code
        error.signal = signal
        error.stdout = stdout
        error.stderr = stderr
        error.durationMs = durationMs
        reject(error)
        return
      }

      resolve({ code, signal, stdout, stderr, durationMs })
    })
  })
}

export async function findRenderOutput(workingDirectory, {
  excludePaths = [],
  startedAt = 0,
  maxDepth = 5,
  maxFiles = 1000
} = {}) {
  const root = path.resolve(workingDirectory)
  const excluded = new Set(excludePaths.map(item => path.resolve(item)))
  const files = []
  const limit = Number.isSafeInteger(maxFiles) && maxFiles > 0 ? maxFiles : 1000

  async function walk(directory, depth) {
    if (files.length >= limit) return
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (files.length >= limit) return
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.render-') || depth >= maxDepth) continue
        await walk(fullPath, depth + 1)
        continue
      }

      if (!entry.isFile() || excluded.has(path.resolve(fullPath))) continue
      if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue

      try {
        const info = await fs.lstat(fullPath)
        if (!info.isFile() || info.isSymbolicLink() || info.size < 1) continue
        if (startedAt && info.mtimeMs < startedAt - 3000) continue
        files.push({
          path: fullPath,
          size: info.size,
          mtimeMs: info.mtimeMs,
          name: entry.name
        })
      } catch {}
    }
  }

  await walk(root, 0)
  const score = name => {
    const lower = name.toLowerCase()
    if (lower === 'jumpscare_short.mp4') return 100
    if (/(final|output|rendered|short)/.test(lower)) return 60
    if (path.extname(lower) === '.mp4') return 30
    return 10
  }

  files.sort((a, b) =>
    score(b.name) - score(a.name) ||
    b.mtimeMs - a.mtimeMs ||
    b.size - a.size
  )
  return files[0] || null
}
