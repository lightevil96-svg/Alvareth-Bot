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

export function parseRenderDurationSeconds(input) {
  const source = typeof input === 'string' ? input : normalizeShellScript(input)
  const variables = new Map()

  for (const line of source.split(/\r?\n/)) {
    const assignment = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(\d+(?:\.\d+)?)["']?\s*(?:#.*)?$/)
    if (assignment) variables.set(assignment[1], Number(assignment[2]))
  }

  const durationArguments = [...source.matchAll(/(?:^|\s)-t\s+["']?(\x24[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)/g)]
  for (const match of durationArguments.reverse()) {
    const token = match[1]
    const duration = token.charCodeAt(0) === 36
      ? variables.get(token.slice(1))
      : Number(token)
    if (Number.isFinite(duration) && duration > 0) return duration
  }
  return null
}

export function createRenderProgressReporter(session, logger = console.log) {
  let lastPercent = -1
  let lastStage = ''
  let lastDetail = ''
  let lastLoggedAt = 0

  function update(percent, stage, detail = '', force = false) {
    const current = {
      percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0))),
      stage: String(stage || 'Memproses'),
      detail: String(detail || ''),
      updatedAt: Date.now()
    }
    if (session && typeof session === 'object') session.progress = current

    const now = Date.now()
    const percentChanged = current.percent !== lastPercent
    const stageChanged = current.stage !== lastStage
    const detailChanged = current.detail !== lastDetail
    if (!force && !percentChanged && !stageChanged &&
        (!detailChanged || now - lastLoggedAt < 1000)) return

    lastPercent = current.percent
    lastStage = current.stage
    lastDetail = current.detail
    lastLoggedAt = now

    const message = '[RENDER] ' + current.percent + '% | ' + current.stage +
      (current.detail ? ' | ' + current.detail : '')
    try {
      logger(message, current)
    } catch (error) {
      console.warn('[RENDER] Gagal menulis progres ke terminal:', error?.message || error)
    }
  }

  return { update }
}

export async function runRenderScript({
  scriptPath,
  workingDirectory,
  inputPath,
  timeoutMs = null,
  signal = null,
  env = process.env,
  progressDurationSeconds = null,
  onProgress = null,
  onStage = null,
  onProcess = null
} = {}) {
  if (!scriptPath || !workingDirectory || !inputPath) {
    throw new Error('Path script, folder kerja, dan video input wajib tersedia.')
  }
  if (signal?.aborted) {
    const error = new Error('Proses render dibatalkan.')
    error.code = 'RENDER_SCRIPT_CANCELLED'
    throw error
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
  if (signal?.aborted) {
    const error = new Error('Proses render dibatalkan.')
    error.code = 'RENDER_SCRIPT_CANCELLED'
    throw error
  }

  const parsedTimeout = Number(timeoutMs)
  const timeout = Number.isSafeInteger(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : null
  const childEnv = {
    ...createRenderChildEnv(cwd, env),
    BASH_XTRACEFD: '3'
  }
  const shell = process.platform === 'win32' ? 'bash' : '/bin/bash'
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let cancelled = false
    let timeoutTimer
    let killTimer
    let progressScanBuffer = ''
    let lastChildOutputAt = startedAt
    let stdoutBytes = 0
    let stderrBytes = 0
    let traceScanBuffer = ''
    let lastProgressPercent = -1
    let lastProgressDetail = ''
    let lastProgressAt = 0
    let detectedDuration = Number(progressDurationSeconds) > 0
      ? Number(progressDurationSeconds)
      : null
    let lastShellStage = ''

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      if (signal && abortListener) signal.removeEventListener('abort', abortListener)
    }

    let child
    const reportProcessState = (state, extra = {}) => {
      try {
        onProcess?.({
          state,
          pid: child?.pid ?? null,
          running: Boolean(child && child.exitCode === null && child.signalCode === null),
          elapsedMs: Date.now() - startedAt,
          lastOutputAt: lastChildOutputAt,
          stdoutBytes,
          stderrBytes,
          ...extra
        })
      } catch (error) {
        console.warn('[RENDER] Callback status proses shell gagal:', error?.message || error)
      }
    }

    const terminate = signalName => {
      if (child?.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, signalName)
          return
        } catch {}
      }
      try { child?.kill(signalName) } catch {}
    }

    const scheduleForceKill = () => {
      if (killTimer) clearTimeout(killTimer)
      killTimer = setTimeout(() => terminate('SIGKILL'), 5000)
      killTimer.unref?.()
    }

    const abortListener = () => {
      if (settled || cancelled) return
      cancelled = true
      terminate('SIGTERM')
      scheduleForceKill()
    }

    const reportShellStage = chunk => {
      traceScanBuffer = (traceScanBuffer + Buffer.from(chunk).toString('utf8')).slice(-8192)
      const lines = traceScanBuffer.split(/\r\n|\n|\r/)
      traceScanBuffer = lines.pop() || ''

      for (const line of lines) {
        const match = line.match(/^\++\s*(.*)$/)
        if (!match) continue
        const commandText = match[1].trim()
        const token = commandText.match(/^([^\s;|&]+)/)?.[1]
        if (!token || token.includes('=') || token.startsWith('(')) continue

        let command = path.basename(token.replace(/^['"]|['"]$/g, ''))
        if (!command) continue
        command = command.toLowerCase()
        if (new Set([
          'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until',
          'do', 'done', 'case', 'esac', 'function', 'return', 'exit',
          'break', 'continue', 'export', 'local', 'declare', 'readonly',
          'set', 'shopt', 'cd', 'pwd', 'shift', 'read', 'eval', 'exec',
          'trap', 'wait', 'command', 'type', 'hash', 'umask', 'ulimit',
          '[', '[[', ']', 'true', 'false'
        ]).has(command)) continue

        let stage
        if (command === 'ffmpeg') stage = 'Render FFmpeg'
        else if (command === 'ffprobe') stage = 'Menganalisis media (FFprobe)'
        else if (/^python(?:\d+(?:\.\d+)*)?$/.test(command)) stage = 'Memproses aset (Python)'
        else if (['node', 'npm', 'npx'].includes(command)) stage = 'Memproses aset (Node.js)'
        else if (['magick', 'convert', 'identify'].includes(command)) stage = 'Memproses gambar'
        else if (['sox', 'lame', 'flac'].includes(command)) stage = 'Memproses audio'
        else if (['cp', 'mv', 'mkdir', 'install', 'ln', 'rm', 'rsync'].includes(command)) stage = 'Menyiapkan aset'
        else if (['curl', 'wget'].includes(command)) stage = 'Mengunduh aset'
        else stage = 'Menjalankan ' + command

        if (stage === lastShellStage) continue
        lastShellStage = stage
        try {
          onStage?.({ stage, command })
        } catch (error) {
          console.warn('[RENDER] Callback tahap shell gagal:', error?.message || error)
        }
      }
    }

    const reportFfmpegProgress = chunk => {
      if (typeof onProgress !== 'function') return
      progressScanBuffer = (progressScanBuffer + Buffer.from(chunk).toString('utf8')).slice(-16384)

      if (!detectedDuration) {
        const durationMatches = [...progressScanBuffer.matchAll(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)]
        if (durationMatches.length) {
          const match = durationMatches[durationMatches.length - 1]
          detectedDuration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
        }
      }

      const timeMatches = [...progressScanBuffer.matchAll(/(?:time|out_time)=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)]
      let currentTimeSeconds = null
      if (timeMatches.length) {
        const match = timeMatches[timeMatches.length - 1]
        currentTimeSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      } else {
        const microsecondMatches = [...progressScanBuffer.matchAll(/out_time_(?:ms|us)=(\d+)/g)]
        if (microsecondMatches.length) {
          currentTimeSeconds = Number(microsecondMatches[microsecondMatches.length - 1][1]) / 1_000_000
        }
      }

      const frameMatches = [...progressScanBuffer.matchAll(/frame=\s*(\d+)/g)]
      const fpsMatches = [...progressScanBuffer.matchAll(/fps=\s*([\d.]+)/g)]
      const speedMatches = [...progressScanBuffer.matchAll(/speed=\s*([\d.]+x)/g)]
      const frame = frameMatches.length ? Number(frameMatches[frameMatches.length - 1][1]) : null
      const fps = fpsMatches.length ? Number(fpsMatches[fpsMatches.length - 1][1]) : null
      const speed = speedMatches.length ? speedMatches[speedMatches.length - 1][1] : ''
      const detailParts = []
      if (frame !== null) detailParts.push('Frame: ' + frame)
      if (Number.isFinite(fps)) detailParts.push('FPS: ' + fps)
      if (Number.isFinite(currentTimeSeconds)) detailParts.push('Waktu: ' + currentTimeSeconds.toFixed(2) + ' detik')
      if (speed) detailParts.push('Kecepatan: ' + speed)
      if (!detailParts.length) return

      const detail = detailParts.join(' | ')
      const duration = Number(detectedDuration)
      const percent = Number.isFinite(currentTimeSeconds) &&
        Number.isFinite(duration) && duration > 0
        ? Math.max(0, Math.min(99, Math.floor((currentTimeSeconds / duration) * 100)))
        : null
      const now = Date.now()
      const percentChanged = percent !== null && percent > lastProgressPercent
      const detailChanged = detail !== lastProgressDetail
      if (!percentChanged && (!detailChanged || now - lastProgressAt < 1000)) return

      if (percent !== null) lastProgressPercent = Math.max(lastProgressPercent, percent)
      lastProgressDetail = detail
      lastProgressAt = now
      try {
        onProgress({
          percent,
          currentTimeSeconds,
          durationSeconds: detectedDuration,
          frame,
          fps,
          speed
        })
      } catch (error) {
        console.warn('[RENDER] Callback progres gagal:', error?.message || error)
      }
    }

    try {
      child = spawn(shell, ['--noprofile', '--norc', '-x', script, input], {
        cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true
      })
    } catch (error) {
      reject(error)
      return
    }

    console.log('[RENDER] Shell process started:', {
      pid: child.pid,
      cwd,
      script: path.basename(script)
    })
    reportProcessState('started')

    child.stdout?.on('data', chunk => {
      stdout = appendTail(stdout, chunk)
      stdoutBytes += Buffer.byteLength(chunk)
      lastChildOutputAt = Date.now()
      reportProcessState('activity', { stream: 'stdout' })
      reportFfmpegProgress(chunk)
    })
    child.stderr?.on('data', chunk => {
      stderr = appendTail(stderr, chunk)
      stderrBytes += Buffer.byteLength(chunk)
      lastChildOutputAt = Date.now()
      reportProcessState('activity', { stream: 'stderr' })
      reportFfmpegProgress(chunk)
    })
    child.stdio?.[3]?.on('data', chunk => {
      lastChildOutputAt = Date.now()
      reportProcessState('activity', { stream: 'shell-trace' })
      reportShellStage(chunk)
    })

    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimers()
      reportProcessState('error', { running: false, error: String(error?.message || error) })
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })

    child.once('close', (code, signalName) => {
      if (settled) return
      settled = true
      clearTimers()
      const durationMs = Date.now() - startedAt
      reportProcessState('closed', { code, signal: signalName, durationMs })

      if (cancelled) {
        const error = new Error('Render dibatalkan atas permintaan pengguna.')
        error.code = 'RENDER_SCRIPT_CANCELLED'
        error.exitCode = code
        error.signal = signalName
        error.stdout = stdout
        error.stderr = stderr
        error.durationMs = durationMs
        reject(error)
        return
      }

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
          (signalName ? ' (signal ' + signalName + ')' : '') +
          (detail ? ': ' + detail : '.')
        )
        error.code = 'RENDER_SCRIPT_FAILED'
        error.exitCode = code
        error.signal = signalName
        error.stdout = stdout
        error.stderr = stderr
        error.durationMs = durationMs
        reject(error)
        return
      }

      try {
        onProgress?.({
          percent: 100,
          currentTimeSeconds: detectedDuration,
          durationSeconds: detectedDuration,
          frame: null,
          fps: null,
          speed: ''
        })
      } catch (error) {
        console.warn('[RENDER] Callback progres akhir gagal:', error?.message || error)
      }
      resolve({ code, signal: signalName, stdout, stderr, durationMs })
    })

    if (signal) {
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) abortListener()
    }
    if (timeout !== null) {
      timeoutTimer = setTimeout(() => {
        if (settled) return
        timedOut = true
        terminate('SIGTERM')
        scheduleForceKill()
      }, timeout)
      timeoutTimer.unref?.()
    }
  })
}

function formatRenderBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return value + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index++
  }
  return amount.toFixed(1) + ' ' + units[index]
}

function isInsideOrEqual(parent, target) {
  const relative = path.relative(parent, target)
  return relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

export function normalizeArchiveEntryPath(name) {
  const raw = String(name ?? '')
  if (!raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') ||
      /^[a-zA-Z]:/.test(raw) || raw.startsWith('//')) {
    throw new Error('ZIP berisi path file yang tidak aman.')
  }

  const trimmed = raw.replace(/\/+$/, '')
  const segments = trimmed.split('/')
  if (!trimmed || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('ZIP berisi path file yang tidak aman.')
  }
  return segments.join('/')
}

async function loadRenderZip(buffer) {
  let imported
  try {
    imported = await import('jszip')
  } catch (error) {
    throw new Error('Modul JSZip belum tersedia pada server bot: ' + String(error?.message || error).slice(0, 180))
  }
  const JSZip = imported.default || imported
  return JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: false })
}

export async function extractRenderArchive(input, destination, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? [])
  if (!buffer.length) throw new Error('File ZIP kosong atau tidak dapat dibaca.')

  const maxArchiveBytes = Number(options.maxArchiveBytes) > 0 ? Number(options.maxArchiveBytes) : 0
  const maxEntries = Number(options.maxEntries) > 0 ? Number(options.maxEntries) : 200
  const maxFileBytes = Number(options.maxFileBytes) > 0 ? Number(options.maxFileBytes) : 100 * 1024 * 1024
  const maxTotalBytes = Number(options.maxTotalBytes) > 0 ? Number(options.maxTotalBytes) : 250 * 1024 * 1024
  if (maxArchiveBytes > 0 && buffer.length > maxArchiveBytes) {
    throw new Error('Ukuran ZIP ' + formatRenderBytes(buffer.length) + ' melebihi batas ' + formatRenderBytes(maxArchiveBytes) + '.')
  }

  if (!destination) throw new Error('Folder ekstraksi ZIP tidak diberikan.')
  const root = path.resolve(String(destination))
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const rootInfo = await fs.lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Folder ekstraksi ZIP harus berupa direktori biasa.')
  }
  if ((await fs.readdir(root)).length) {
    throw new Error('Folder ekstraksi ZIP harus kosong sebelum digunakan.')
  }

  const zip = await (options.loadZip || loadRenderZip)(buffer)
  const entries = Object.values(zip?.files || {}).filter(Boolean)
  if (!entries.length) throw new Error('ZIP tidak berisi file yang dapat diekstrak.')
  if (entries.length > maxEntries) {
    throw new Error('ZIP berisi terlalu banyak item (maksimal ' + maxEntries + ').')
  }

  const seen = new Set()
  const files = []
  let declaredTotal = 0
  let extractedTotal = 0

  for (const entry of entries) {
    const originalName = String(entry.unsafeOriginalName ?? entry.name ?? '')
    const normalized = normalizeArchiveEntryPath(originalName)
    const safeEntryName = normalizeArchiveEntryPath(entry.name ?? originalName)
    if (normalized !== safeEntryName) {
      throw new Error('Nama file ZIP berubah setelah normalisasi; arsip ditolak.')
    }
    if (seen.has(normalized)) throw new Error('ZIP berisi nama file duplikat: ' + normalized)
    seen.add(normalized)

    const rawMode = entry.unixPermissions
    const mode = typeof rawMode === 'string' ? parseInt(rawMode, 8) : Number(rawMode || 0)
    const fileType = Number.isFinite(mode) ? mode & 0o170000 : 0
    if (fileType === 0o120000) {
      throw new Error('ZIP berisi symbolic link; arsip ditolak demi keamanan.')
    }
    if (fileType && fileType !== 0o100000 && fileType !== 0o040000) {
      throw new Error('ZIP berisi tipe file khusus yang tidak didukung.')
    }

    const isDirectory = Boolean(entry.dir) || originalName.endsWith('/') || fileType === 0o040000
    const target = path.resolve(root, ...normalized.split('/'))
    if (!isInsideOrEqual(root, target)) {
      throw new Error('ZIP mencoba menulis file di luar folder ekstraksi.')
    }

    const rawDeclaredSize = entry?._data?.uncompressedSize
    const declaredSize = Number.isSafeInteger(Number(rawDeclaredSize)) && Number(rawDeclaredSize) >= 0
      ? Number(rawDeclaredSize)
      : null
    if (!isDirectory && declaredSize !== null) {
      if (declaredSize > maxFileBytes) {
        throw new Error('File di dalam ZIP terlalu besar: ' + normalized + '.')
      }
      declaredTotal += declaredSize
      if (declaredTotal > maxTotalBytes) {
        throw new Error('Ukuran total hasil ekstraksi ZIP melebihi batas ' + formatRenderBytes(maxTotalBytes) + '.')
      }
    }

    if (isDirectory) {
      await fs.mkdir(target, { recursive: true, mode: 0o700 })
      continue
    }

    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    if (typeof entry.async !== 'function') {
      throw new Error('Isi file ZIP tidak dapat dibaca: ' + normalized + '.')
    }

    let content
    try {
      content = Buffer.from(await entry.async('nodebuffer'))
    } catch (error) {
      throw new Error('Gagal mengekstrak ' + normalized + ': ' + String(error?.message || error).slice(0, 180))
    }

    if (content.length > maxFileBytes) {
      throw new Error('File di dalam ZIP terlalu besar: ' + normalized + '.')
    }
    extractedTotal += content.length
    if (extractedTotal > maxTotalBytes) {
      throw new Error('Ukuran total hasil ekstraksi ZIP melebihi batas ' + formatRenderBytes(maxTotalBytes) + '.')
    }
    if (declaredSize !== null && content.length !== declaredSize) {
      throw new Error('Ukuran file ZIP tidak sesuai metadata: ' + normalized + '.')
    }

    await fs.writeFile(target, content, { flag: 'wx', mode: 0o600 })
    files.push(target)
  }

  if (!files.length) throw new Error('ZIP tidak berisi file yang dapat digunakan.')
  return { root, files, totalBytes: extractedTotal }
}

export async function findRenderScript(rootDirectory, options = {}) {
  const root = path.resolve(String(rootDirectory || ''))
  if (!rootDirectory) throw new Error('Folder paket render tidak diberikan.')

  const maxDepth = Number.isSafeInteger(options.maxDepth) && options.maxDepth >= 0 ? options.maxDepth : 8
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : 200
  const matches = []
  let scanned = 0

  async function walk(directory, depth) {
    if (depth > maxDepth || scanned >= maxFiles) return
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (scanned >= maxFiles || entry.isSymbolicLink()) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(target, depth + 1)
      } else if (entry.isFile()) {
        scanned++
        if (entry.name.toLowerCase() === 'render.sh') matches.push(target)
      }
    }
  }

  await walk(root, 0)
  if (!matches.length) {
    throw new Error('ZIP tidak memiliki file render.sh. Pastikan paket berisi script utama bernama render.sh.')
  }
  if (matches.length > 1) {
    throw new Error('ZIP memiliki lebih dari satu render.sh; paket harus menentukan satu script utama.')
  }

  const info = await fs.lstat(matches[0])
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('Script render.sh harus berupa file biasa.')
  }
  return matches[0]
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
