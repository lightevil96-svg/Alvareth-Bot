import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import net from 'node:net'
import { constants as fsConstants } from 'node:fs'

// HTML template renderer for .render.
//
// A template ZIP carries manifest.json + an entry HTML page that draws every
// frame on a <canvas> and exposes two hooks:
//   window.renderFrameAt(seconds)  — draw the frame for that timestamp
//   window.setRenderPhotos([dataUrl, ...]) — load the user's photos
// The renderer steps through the timeline in a headless Chromium, captures
// each frame, and pipes the frames to FFmpeg for a highest-quality MP4
// (1080p-class canvas, manifest fps, libx264 CRF 16, slow preset).
//
// No new npm dependency: Chromium is driven over its DevTools protocol with
// the built-in WebSocket client (Node.js 22+), and frames are captured as
// JPEG quality 100 — a visually lossless intermediate. PNG capture costs
// ~9x more per frame (measured 478 ms vs 52 ms at 1080x1080) while the final
// H.264 encode at CRF 16 already dominates visible quality, so JPEG 100 is
// the right intermediate here.
//
// Browser provisioning mirrors how Remotion provisions its browser: an
// explicit executable wins, then PATH, then the puppeteer/Remotion caches,
// then a one-time download of chrome-headless-shell into the bot data dir.
// Only owner-trusted template ZIPs are rendered; the page runs with
// --no-sandbox like the existing render.sh flow, so this is not an OS
// sandbox.

export const MAX_TEMPLATE_DURATION_SECONDS = 300
export const MAX_TEMPLATE_FPS = 120
export const MAX_TEMPLATE_FRAMES = 18000
export const MIN_TEMPLATE_DIMENSION = 64
export const MAX_TEMPLATE_DIMENSION = 2160
export const MIN_TEMPLATE_PHOTOS = 0
export const MAX_TEMPLATE_PHOTOS = 12
export const MAX_TEMPLATE_PHOTO_BYTES = 25 * 1024 * 1024

const BROWSER_ENV_VARS = [
  'ALVARETH_RENDER_BROWSER_EXECUTABLE',
  'ALVARETH_REMOTION_BROWSER_EXECUTABLE',
  'CHROME_PATH',
  'CHROMIUM_PATH'
]
const BROWSER_PATH_NAMES = [
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'chrome',
  'headless_shell',
  'chrome-headless-shell'
]
const BROWSER_FILE_NAMES = new Set(['chrome', 'chrome-headless-shell', 'headless_shell', 'chromium'])

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

function safeRelativePath(value, label = 'Path') {
  const raw = String(value ?? '').trim()
  if (!raw || raw.includes('\0') || raw.includes('\\') ||
      path.posix.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error(label + ' harus berupa path relatif yang aman di dalam ZIP.')
  }
  const segments = raw.replace(/^\.\//, '').split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(label + ' tidak boleh keluar dari folder template.')
  }
  return segments.join(path.sep)
}

function toSafePositiveInt(value, label, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(label + ' harus berupa bilangan bulat ' + min + '–' + max + '.')
  }
  return number
}

export function parseHtmlTemplateManifest(input) {
  let manifest
  if (typeof input === 'string') {
    try {
      manifest = JSON.parse(input)
    } catch {
      throw new Error('manifest.json tidak valid: bukan JSON yang dapat dibaca.')
    }
  } else if (input && typeof input === 'object') {
    manifest = input
  } else {
    throw new Error('manifest.json tidak ditemukan di paket template.')
  }

  const id = String(manifest.id || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id)) {
    throw new Error('manifest.json: id template tidak valid. Gunakan huruf, angka, tanda hubung, atau underscore.')
  }

  const entry = safeRelativePath(manifest.entry || 'render.html', 'Entry template')
  if (!/\.html?$/i.test(entry)) {
    throw new Error('manifest.json: entry harus berupa file .html di dalam ZIP.')
  }

  const width = toSafePositiveInt(manifest.width, 'Lebar template', MIN_TEMPLATE_DIMENSION, MAX_TEMPLATE_DIMENSION)
  const height = toSafePositiveInt(manifest.height, 'Tinggi template', MIN_TEMPLATE_DIMENSION, MAX_TEMPLATE_DIMENSION)
  const fps = toSafePositiveInt(manifest.fps, 'FPS template', 1, MAX_TEMPLATE_FPS)

  const duration = Number(manifest.duration)
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_TEMPLATE_DURATION_SECONDS) {
    throw new Error('manifest.json: durasi harus 0–' + MAX_TEMPLATE_DURATION_SECONDS + ' detik.')
  }

  const totalFrames = Math.round(duration * fps)
  if (totalFrames < 1 || totalFrames > MAX_TEMPLATE_FRAMES) {
    throw new Error('manifest.json: jumlah frame (' + totalFrames + ') melebihi batas ' + MAX_TEMPLATE_FRAMES + '.')
  }

  const requiredPhotos = toSafePositiveInt(
    manifest.requiredPhotos ?? 0, 'Jumlah foto yang dibutuhkan', MIN_TEMPLATE_PHOTOS, MAX_TEMPLATE_PHOTOS)
  const descriptions = Array.isArray(manifest.photoDescriptions) ? manifest.photoDescriptions : []
  if (requiredPhotos > 0 && descriptions.length !== requiredPhotos) {
    throw new Error('manifest.json: photoDescriptions harus berisi tepat ' + requiredPhotos + ' deskripsi foto.')
  }
  for (const description of descriptions) {
    if (typeof description !== 'string' || !description.trim() || description.length > 200) {
      throw new Error('manifest.json: setiap deskripsi foto harus berupa teks 1–200 karakter.')
    }
  }

  let audioFile = null
  if (manifest.audioFile !== null && manifest.audioFile !== undefined && String(manifest.audioFile).trim() !== '') {
    audioFile = safeRelativePath(manifest.audioFile, 'File audio template')
    if (!/\.(?:mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(audioFile)) {
      throw new Error('manifest.json: audioFile harus berupa file audio (mp3/m4a/aac/wav/ogg/opus/flac).')
    }
  }

  return {
    id,
    title: String(manifest.title || id).slice(0, 200),
    entry,
    width,
    height,
    fps,
    duration,
    totalFrames,
    requiredPhotos,
    photoDescriptions: descriptions.map(item => String(item).trim()),
    audioFile
  }
}

async function findFileAtDepth(root, fileName, maxDepth = 2) {
  const matches = []
  async function walk(directory, depth) {
    if (depth > maxDepth || matches.length > 1) return
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.render-')) continue
        await walk(target, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase() === fileName) {
        matches.push(target)
      }
    }
  }
  await walk(root, 0)
  return matches
}

export async function findHtmlTemplate(packageDirectory) {
  const root = path.resolve(String(packageDirectory || ''))
  if (!packageDirectory) throw new Error('Folder paket template tidak diberikan.')
  const rootInfo = await fs.lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Folder paket template harus berupa direktori biasa.')
  }

  const manifestMatches = await findFileAtDepth(root, 'manifest.json', 2)
  if (!manifestMatches.length) {
    throw new Error('ZIP bukan paket template HTML: manifest.json tidak ditemukan.')
  }
  if (manifestMatches.length > 1) {
    throw new Error('ZIP berisi lebih dari satu manifest.json; paket harus menentukan satu template.')
  }

  const manifestPath = manifestMatches[0]
  const manifestDirectory = path.dirname(manifestPath)
  let manifest
  try {
    manifest = parseHtmlTemplateManifest(await fs.readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error('manifest.json tidak valid: ' + String(error?.message || error))
  }

  const entryPath = path.resolve(manifestDirectory, manifest.entry)
  if (!isInside(manifestDirectory, entryPath)) {
    throw new Error('Entry template berada di luar folder template.')
  }
  let entryInfo
  try {
    entryInfo = await fs.lstat(entryPath)
  } catch {
    throw new Error('Entry template tidak ditemukan: ' + manifest.entry)
  }
  if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
    throw new Error('Entry template harus berupa file biasa.')
  }

  const entrySource = await fs.readFile(entryPath, 'utf8')
  if (!/\brenderFrameAt\b/.test(entrySource) || !/\bsetRenderPhotos\b/.test(entrySource)) {
    throw new Error('Entry template harus menyediakan window.renderFrameAt(t) dan window.setRenderPhotos([foto]).')
  }

  let audioPath = null
  if (manifest.audioFile) {
    audioPath = path.resolve(manifestDirectory, manifest.audioFile)
    if (!isInside(manifestDirectory, audioPath)) {
      throw new Error('File audio template berada di luar folder template.')
    }
    try {
      const audioInfo = await fs.lstat(audioPath)
      if (!audioInfo.isFile() || audioInfo.isSymbolicLink()) {
        throw new Error('File audio template harus berupa file biasa.')
      }
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('File audio template tidak ditemukan: ' + manifest.audioFile)
      throw error
    }
  }

  const renderScriptMatches = await findFileAtDepth(root, 'render.sh', 2)
  if (renderScriptMatches.length) {
    throw new Error('ZIP berisi render.sh dan manifest.json sekaligus. Paket template HTML tidak boleh berisi render.sh — hapus salah satunya.')
  }

  return { manifest, manifestPath, manifestDirectory, entryPath, audioPath }
}

export function getRenderDataDir() {
  const configured = String(process.env.ALVARETH_DATA_DIR || '').trim()
  return path.resolve(configured || path.join(homedir(), '.alvareth-bot-data'))
}

export function getRenderBrowserCacheDir(dataDir = getRenderDataDir()) {
  return path.join(path.resolve(String(dataDir || getRenderDataDir())), 'render-browser')
}

async function isExecutableFile(filePath) {
  try {
    const info = await fs.lstat(filePath)
    if (!info.isFile() || info.isSymbolicLink()) return false
    await fs.access(filePath, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findBrowserInDirectory(root, maxDepth = 4) {
  async function walk(directory, depth) {
    if (depth > maxDepth) return ''
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return ''
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        const found = await walk(target, depth + 1)
        if (found) return found
      } else if (entry.isFile() && BROWSER_FILE_NAMES.has(entry.name)) {
        if (await isExecutableFile(target)) return target
      }
    }
    return ''
  }
  try {
    const info = await fs.lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) return ''
  } catch {
    return ''
  }
  return walk(root, 0)
}

export async function findRenderBrowser({ dataDir = getRenderDataDir(), env = process.env } = {}) {
  for (const name of BROWSER_ENV_VARS) {
    const configured = String(env[name] || '').trim()
    if (!configured) continue
    if (!path.isAbsolute(configured)) {
      throw new Error(name + ' harus berupa path absolut ke executable browser.')
    }
    if (!(await isExecutableFile(configured))) {
      throw new Error('Browser di ' + name + ' tidak ditemukan atau tidak dapat dieksekusi: ' + configured)
    }
    return configured
  }

  const pathDirs = String(env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const directory of pathDirs) {
    for (const name of BROWSER_PATH_NAMES) {
      const candidate = path.join(directory, name)
      if (await isExecutableFile(candidate)) return candidate
    }
  }

  const puppeteerCache = path.join(homedir(), '.cache', 'puppeteer')
  const foundInPuppeteerCache = await findBrowserInDirectory(puppeteerCache, 4)
  if (foundInPuppeteerCache) return foundInPuppeteerCache

  const cacheDir = getRenderBrowserCacheDir(dataDir)
  const foundInCache = await findBrowserInDirectory(cacheDir, 4)
  if (foundInCache) return foundInCache

  return ''
}

function runCommandCollect({ command, args, cwd, env, signal, onLog }) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const append = (target, chunk) => {
      const text = Buffer.from(chunk).toString('utf8')
      if (target === 'stdout') stdout = (stdout + text).slice(-8192)
      else stderr = (stderr + text).slice(-8192)
      try { onLog?.(text) } catch {}
    }
    child.stdout?.on('data', chunk => append('stdout', chunk))
    child.stderr?.on('data', chunk => append('stderr', chunk))
    child.once('error', error => {
      if (settled) return
      settled = true
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      if (code === 0) resolve({ code, stdout, stderr })
      else {
        const error = new Error('Perintah ' + command + ' keluar dengan kode ' + String(code) +
          (stderr.trim() ? ': ' + stderr.trim().slice(-500) : '.'))
        error.code = code
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      }
    })
    if (signal) {
      if (signal.aborted) { try { child.kill('SIGKILL') } catch {} return }
      signal.addEventListener('abort', () => { try { child.kill('SIGKILL') } catch {} }, { once: true })
    }
  })
}

export async function ensureRenderBrowser({ dataDir = getRenderDataDir(), env = process.env, signal = null, onLog = null } = {}) {
  const existing = await findRenderBrowser({ dataDir, env })
  if (existing) return existing

  const cacheDir = getRenderBrowserCacheDir(dataDir)
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 })
  try {
    onLog?.('[RENDER] Browser Chromium belum ditemukan; mengunduh chrome-headless-shell sekali ke ' + cacheDir + '.\n')
    await runCommandCollect({
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['-y', '@puppeteer/browsers', 'install', 'chrome-headless-shell@stable', '--path', cacheDir],
      cwd: cacheDir,
      env,
      signal,
      onLog
    })
  } catch (error) {
    throw new Error('Browser Chromium untuk render template tidak ditemukan dan unduhan otomatis gagal: ' +
      String(error?.message || error).slice(0, 500) +
      ' Pasang Chromium di server lalu atur ALVARETH_RENDER_BROWSER_EXECUTABLE ke path absolut executable-nya.')
  }

  const downloaded = await findRenderBrowser({ dataDir, env })
  if (!downloaded) {
    throw new Error('Unduhan chrome-headless-shell selesai tetapi executable-nya tidak ditemukan di ' + cacheDir +
      '. Atur ALVARETH_RENDER_BROWSER_EXECUTABLE ke path absolut executable Chromium.')
  }
  return downloaded
}

export function buildHtmlTemplateFfmpegArgs({ fps, outputPath, audioPath = null }) {
  const args = [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0'
  ]
  if (audioPath) args.push('-i', audioPath)
  args.push(
    '-map', '0:v:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-crf', '16', '-preset', 'slow', '-tune', 'animation'
  )
  if (audioPath) {
    args.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest')
  }
  args.push('-movflags', '+faststart', outputPath)
  return args
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

class CdpClient {
  constructor(webSocket) {
    this.ws = webSocket
    this.id = 0
    this.pending = new Map()
    this.events = []
    webSocket.onmessage = event => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error('Chrome DevTools: ' + String(message.error.message || 'error')))
        else resolve(message.result || {})
      } else if (message.method) {
        this.events.push(message)
      }
    }
    webSocket.onerror = () => {
      const error = new Error('Koneksi DevTools ke Chromium terputus.')
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    }
  }

  send(method, params = {}, sessionId, timeoutMs = 60000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Timeout menunggu respons DevTools untuk ' + method + '.'))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) }
      })
      try {
        this.ws.send(JSON.stringify({ id, method, params, sessionId }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async waitEvent(method, timeoutMs = 30000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const index = this.events.findIndex(event => event.method === method)
      if (index >= 0) return this.events.splice(index, 1)[0]
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Timeout menunggu event DevTools ' + method + '.')
  }

  async evaluate(expression, sessionId, timeoutMs = 60000) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    }, sessionId, timeoutMs)
    if (result.exceptionDetails) {
      const message = String(result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text || 'JavaScript template gagal dijalankan.')
      throw new Error('Template gagal dijalankan: ' + message.slice(0, 500))
    }
    return result.result?.value
  }
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return
  const error = new Error('Render template dibatalkan atas permintaan pengguna.')
  error.code = 'RENDER_SCRIPT_CANCELLED'
  throw error
}

export async function renderHtmlTemplate({
  browserExecutable,
  packageDir,
  entryPath,
  manifest,
  photoPaths = [],
  audioPath = null,
  outputPath,
  signal = null,
  onProgress = null,
  onLog = null
} = {}) {
  if (typeof WebSocket !== 'function') {
    throw new Error('Render template membutuhkan Node.js 22 atau lebih baru (WebSocket global tidak tersedia).')
  }
  if (!browserExecutable) throw new Error('Executable browser Chromium tidak diberikan.')
  if (!(await isExecutableFile(browserExecutable))) {
    throw new Error('Executable browser Chromium tidak dapat dieksekusi: ' + browserExecutable)
  }
  if (!entryPath || !outputPath) throw new Error('Path entry template dan output wajib tersedia.')
  if (!manifest || typeof manifest !== 'object') throw new Error('Manifest template wajib tersedia.')
  if (!Array.isArray(photoPaths) || photoPaths.length !== manifest.requiredPhotos) {
    throw new Error('Jumlah foto (' + photoPaths.length + ') tidak sama dengan yang dibutuhkan template (' + manifest.requiredPhotos + ').')
  }

  const jobDirectory = path.dirname(path.resolve(outputPath))
  const profileDirectory = path.join(jobDirectory, 'chrome-profile')
  await fs.mkdir(profileDirectory, { recursive: true, mode: 0o700 })
  throwIfCancelled(signal)

  const port = await getEphemeralPort()
  const chromeArgs = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--user-data-dir=' + profileDirectory,
    '--remote-debugging-port=' + port,
    'about:blank'
  ]
  const proxy = String(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim()
  if (proxy) chromeArgs.push('--proxy-server=' + proxy)

  let chrome = null
  let chromeStderr = ''
  let ffmpeg = null
  let ffmpegStderr = ''
  let webSocket = null
  try {
    chrome = spawn(browserExecutable, chromeArgs, {
      cwd: jobDirectory,
      env: { ...process.env, HOME: profileDirectory },
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true
    })
    chrome.stderr?.on('data', chunk => {
      chromeStderr = (chromeStderr + Buffer.from(chunk).toString('utf8')).slice(-4096)
    })
    chrome.once('error', () => {})
    chrome.once('exit', (code, signalName) => {
      if (code !== 0 && code !== null) {
        onLog?.('[RENDER] Chromium keluar lebih awal (kode ' + code + (signalName ? '/' + signalName : '') + ').\n')
      }
    })

    let version = null
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      throwIfCancelled(signal)
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/json/version')
        if (response.ok) { version = await response.json(); break }
      } catch {}
      if (chrome.exitCode !== null) {
        throw new Error('Chromium gagal dijalankan (keluar dengan kode ' + chrome.exitCode + ').' +
          (chromeStderr.trim() ? ' Detail: ' + chromeStderr.trim().slice(-400) : ''))
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    if (!version?.webSocketDebuggerUrl) {
      throw new Error('DevTools Chromium tidak merespons dalam 30 detik.' +
        (chromeStderr.trim() ? ' Detail: ' + chromeStderr.trim().slice(-400) : ''))
    }

    webSocket = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout menghubungkan ke DevTools Chromium.')), 15000)
      timer.unref?.()
      webSocket.onopen = () => { clearTimeout(timer); resolve() }
      webSocket.onerror = () => { clearTimeout(timer); reject(new Error('Tidak dapat terhubung ke DevTools Chromium.')) }
    })
    const cdp = new CdpClient(webSocket)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: manifest.width, height: manifest.height, deviceScaleFactor: 1, mobile: false
    }, sessionId)

    const entryUrl = 'file://' + path.resolve(entryPath)
    await cdp.send('Page.navigate', { url: entryUrl }, sessionId)
    await cdp.waitEvent('Page.loadEventFired', 30000)
    throwIfCancelled(signal)

    // Webfonts (Google Fonts) load over the network; wait for them but never
    // block the render forever when the server is offline — the template
    // still renders with fallback fonts.
    const fontsLoaded = await cdp.evaluate(
      `(async () => { try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 15000))]); } catch {} return document.fonts.size || 0 })()`,
      sessionId, 30000)
    onLog?.('[RENDER] Font template dimuat: ' + String(fontsLoaded) + '.\n')

    const hooks = await cdp.evaluate(
      `({ renderFrameAt: typeof window.renderFrameAt, setRenderPhotos: typeof window.setRenderPhotos })`,
      sessionId)
    if (hooks?.renderFrameAt !== 'function' || hooks?.setRenderPhotos !== 'function') {
      throw new Error('Template tidak menyediakan window.renderFrameAt(t) dan window.setRenderPhotos([foto]) sebagai fungsi.')
    }

    if (photoPaths.length) {
      const dataUrls = []
      for (const photoPath of photoPaths) {
        const absolute = path.resolve(photoPath)
        if (!isInside(jobDirectory, absolute) && !isInside(path.resolve(packageDir || jobDirectory), absolute)) {
          throw new Error('Foto template berada di luar folder job render.')
        }
        const buffer = await fs.readFile(absolute)
        if (buffer.length > MAX_TEMPLATE_PHOTO_BYTES) {
          throw new Error('Ukuran foto melebihi batas ' + (MAX_TEMPLATE_PHOTO_BYTES / 1024 / 1024) + ' MB.')
        }
        const header = buffer.subarray(0, 12)
        let mime = 'image/jpeg'
        if (header[0] === 0x89 && header[1] === 0x50) mime = 'image/png'
        else if (header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) mime = 'image/webp'
        dataUrls.push('data:' + mime + ';base64,' + buffer.toString('base64'))
      }
      await cdp.evaluate(
        `setRenderPhotos(${JSON.stringify(dataUrls)})`,
        sessionId, 60000)
      throwIfCancelled(signal)
      const loadedPortraits = await cdp.evaluate(
        `Array.isArray(window.userPortraits) ? window.userPortraits.map(img => img ? (img.naturalWidth || 0) + 'x' + (img.naturalHeight || 0) : null) : null`,
        sessionId)
      if (Array.isArray(loadedPortraits)) {
        const failed = loadedPortraits.filter(item => !item || item === '0x0').length
        if (failed) {
          throw new Error(failed + ' dari ' + loadedPortraits.length + ' foto gagal dimuat template. Kirim ulang foto sebagai JPG/PNG.')
        }
        onLog?.('[RENDER] Foto template dimuat: ' + loadedPortraits.join(', ') + '.\n')
      }
    }

    const ffmpegArgs = buildHtmlTemplateFfmpegArgs({
      fps: manifest.fps, outputPath, audioPath
    })
    ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      cwd: jobDirectory,
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true
    })
    ffmpeg.stderr?.on('data', chunk => {
      ffmpegStderr = (ffmpegStderr + Buffer.from(chunk).toString('utf8')).slice(-4096)
    })
    const ffmpegDone = new Promise((resolve, reject) => {
      ffmpeg.once('error', reject)
      ffmpeg.once('close', code => {
        if (code === 0) resolve()
        else reject(new Error('FFmpeg keluar dengan kode ' + String(code) +
          (ffmpegStderr.trim() ? ': ' + ffmpegStderr.trim().slice(-500) : '.')))
      })
    })
    const abortListener = () => {
      try { ffmpeg?.stdin?.end() } catch {}
      try { ffmpeg?.kill('SIGKILL') } catch {}
    }
    if (signal) signal.addEventListener('abort', abortListener, { once: true })

    const totalFrames = manifest.totalFrames
    const startedAt = Date.now()
    try {
      for (let frame = 0; frame < totalFrames; frame++) {
        throwIfCancelled(signal)
        const time = frame / manifest.fps
        await cdp.evaluate(`renderFrameAt(${time})`, sessionId, 30000)
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 100 }, sessionId, 60000)
        if (!shot?.data) throw new Error('Chromium tidak mengembalikan gambar frame ' + frame + '.')
        const buffer = Buffer.from(shot.data, 'base64')
        if (!ffmpeg.stdin.write(buffer)) {
          await new Promise(resolve => ffmpeg.stdin.once('drain', resolve))
        }
        if ((frame + 1) % 60 === 0 || frame + 1 === totalFrames) {
          try {
            onProgress?.({
              frame: frame + 1,
              totalFrames,
              percent: Math.round(((frame + 1) / totalFrames) * 100),
              elapsedMs: Date.now() - startedAt
            })
          } catch {}
        }
      }
    } finally {
      if (signal) signal.removeEventListener('abort', abortListener)
      try { ffmpeg.stdin.end() } catch {}
    }
    await ffmpegDone
    throwIfCancelled(signal)

    const outputInfo = await fs.stat(outputPath)
    if (!outputInfo.isFile() || outputInfo.size < 1) {
      throw new Error('FFmpeg selesai tetapi file MP4 hasil render tidak ditemukan atau kosong.')
    }
    return {
      outputPath,
      frames: totalFrames,
      durationSeconds: manifest.duration,
      width: manifest.width,
      height: manifest.height,
      fps: manifest.fps,
      bytes: outputInfo.size
    }
  } finally {
    try { webSocket?.close() } catch {}
    if (chrome) {
      try {
        if (process.platform !== 'win32' && chrome.pid) process.kill(-chrome.pid, 'SIGKILL')
        else chrome.kill('SIGKILL')
      } catch {}
    }
    try { ffmpeg?.kill('SIGKILL') } catch {}
    await fs.rm(profileDirectory, { recursive: true, force: true }).catch(() => {})
  }
}
