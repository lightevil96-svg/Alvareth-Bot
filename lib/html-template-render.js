import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import net from 'node:net'
import zlib from 'node:zlib'
import { constants as fsConstants } from 'node:fs'
import WebSocket from 'ws'

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
// the `ws` package (already a direct dependency, used by Baileys), so the
// renderer works on Node.js 18+ — the panel runs older Node than 22 and the
// global WebSocket client (Node.js 22+) is not available there. Frames are
// captured as JPEG quality 100 — a visually lossless intermediate. PNG capture
// costs ~9x more per frame (measured 478 ms vs 52 ms at 1080x1080) while the
// final H.264 encode at CRF 16 already dominates visible quality, so JPEG 100
// is the right intermediate here.
//
// Browser provisioning mirrors how Remotion provisions its browser: an
// explicit executable wins, then PATH, then the puppeteer/Remotion caches,
// then a one-time download of chrome-headless-shell into the bot data dir.
// Only owner-trusted template ZIPs are rendered; the page runs with
// --no-sandbox like the existing render.sh flow, so this is not an OS
// sandbox.
//
// chrome-headless-shell is dynamically linked and minimal containers (the
// panel) miss system libraries it needs — the loader then fails with exit
// code 127 ("error while loading shared libraries: libatk-1.0.so.0 ...").
// The bot cannot apt-get as root, so before every render it checks the
// binary with `ldd` (and a `--version` probe as fallback) and installs just
// the missing libraries itself: it reads the distro's Packages index,
// downloads the .deb that provides each missing soname, extracts the .so
// files into <dataDir>/render-browser/libs and launches Chromium with that
// directory in LD_LIBRARY_PATH. One-time per missing library; the libs
// directory persists in the bot data dir across restarts.

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

function runCommandRaw({ command, args, cwd, env, signal, timeoutMs = 60000, onLog } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      reject(error)
      return
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch {}
      const error = new Error('Perintah ' + command + ' kehabisan waktu (' + timeoutMs + ' ms).')
      error.code = 'ETIMEDOUT'
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    }, timeoutMs)
    timer.unref?.()
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
      clearTimeout(timer)
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (signal) {
      if (signal.aborted) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          try { child.kill('SIGKILL') } catch {}
          resolve({ code: null, stdout, stderr, aborted: true })
        }
        return
      }
      signal.addEventListener('abort', () => { try { child.kill('SIGKILL') } catch {} }, { once: true })
    }
  })
}

function runCommandCollect({ command, args, cwd, env, signal, onLog }) {
  return runCommandRaw({ command, args, cwd, env, signal, onLog }).then(({ code, stdout, stderr, aborted }) => {
    if (aborted) {
      const error = new Error('Perintah ' + command + ' dibatalkan.')
      error.code = 'ABORTED'
      error.stdout = stdout
      error.stderr = stderr
      throw error
    }
    if (code === 0) return { code, stdout, stderr }
    const error = new Error('Perintah ' + command + ' keluar dengan kode ' + String(code) +
      (stderr.trim() ? ': ' + stderr.trim().slice(-500) : '.'))
    error.code = code
    error.stdout = stdout
    error.stderr = stderr
    throw error
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

export const MAX_CHROME_LIBRARY_INSTALLS = 40

// Soname -> Debian/Ubuntu package that provides it. The map covers every
// library chrome-headless-shell links (measured with `ldd` on 158.x) plus
// the libraries a distro build of one of those may pull in transitively
// (wayland, fontconfig, cairo, pango, cups). Package names are identical
// on Debian and Ubuntu for all of these.
export const CHROME_SHARED_LIBRARY_PACKAGES = {
  'libatk-1.0.so.0': 'libatk1.0-0',
  'libatk-bridge-2.0.so.0': 'libatk-bridge2.0-0',
  'libatspi.so.0': 'libatspi2.0-0',
  'libdbus-1.so.3': 'libdbus-1-3',
  'libexpat.so.1': 'libexpat1',
  'libglib-2.0.so.0': 'libglib2.0-0',
  'libgobject-2.0.so.0': 'libglib2.0-0',
  'libgio-2.0.so.0': 'libglib2.0-0',
  'libgmodule-2.0.so.0': 'libglib2.0-0',
  'libnspr4.so': 'libnspr4',
  'libplc4.so': 'libnspr4',
  'libplds4.so': 'libnspr4',
  'libnss3.so': 'libnss3',
  'libnssutil3.so': 'libnss3',
  'libsmime3.so': 'libnss3',
  'libssl3.so': 'libnss3',
  'libudev.so.1': 'libudev1',
  'libX11.so.6': 'libx11-6',
  'libxcb.so.1': 'libxcb1',
  'libXcomposite.so.1': 'libxcomposite1',
  'libXdamage.so.1': 'libxdamage1',
  'libXext.so.6': 'libxext6',
  'libXfixes.so.3': 'libxfixes3',
  'libXrandr.so.2': 'libxrandr2',
  'libXrender.so.1': 'libxrender1',
  'libXi.so.6': 'libxi6',
  'libXau.so.6': 'libxau6',
  'libXdmcp.so.6': 'libxdmcp6',
  'libgbm.so.1': 'libgbm1',
  'libdrm.so.2': 'libdrm2',
  'libxkbcommon.so.0': 'libxkbcommon0',
  'libasound.so.2': 'libasound2',
  'libpcre2-8.so.0': 'libpcre2-8-0',
  'libffi.so.8': 'libffi8',
  'libz.so.1': 'libz1g',
  'libmount.so.1': 'libmount1',
  'libselinux.so.1': 'libselinux1',
  'libsystemd.so.0': 'libsystemd0',
  'libcap.so.2': 'libcap2',
  'libblkid.so.1': 'libblkid1',
  'libgcrypt.so.20': 'libgcrypt20',
  'liblz4.so.1': 'liblz4-1',
  'liblzma.so.5': 'liblzma5',
  'libzstd.so.1': 'libzstd1',
  'libbsd.so.0': 'libbsd0',
  'libgpg-error.so.0': 'libgpg-error0',
  'libmd.so.0': 'libmd0',
  'libwayland-client.so.0': 'libwayland-client0',
  'libwayland-server.so.0': 'libwayland-server0',
  'libxcb-dri3.so.0': 'libxcb-dri3-0',
  'libxcb-present.so.0': 'libxcb-present0',
  'libxcb-sync.so.1': 'libxcb-sync1',
  'libxcb-xfixes.so.0': 'libxcb-xfixes0',
  'libxshmfence.so.1': 'libxshmfence1',
  'libxxf86vm.so.1': 'libxxf86vm1',
  'libfontconfig.so.1': 'libfontconfig1',
  'libfreetype.so.6': 'libfreetype6',
  'libpng16.so.16': 'libpng16-16',
  'libharfbuzz.so.0': 'libharfbuzz0b',
  'libfribidi.so.0': 'libfribidi0',
  'libthai.so.0': 'libthai0',
  'libdatrie.so.1': 'libdatrie1',
  'libpixman-1.so.0': 'libpixman-1-0',
  'libcairo.so.2': 'libcairo2',
  'libpango-1.0.so.0': 'libpango-1.0-0',
  'libpangocairo-1.0.so.0': 'libpango-1.0-0',
  'libpangoft2-1.0.so.0': 'libpango-1.0-0',
  'libcups.so.2': 'libcups2'
}

export function detectLinuxPackageArchive(osReleaseText) {
  const fields = {}
  for (const line of String(osReleaseText || '').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match) fields[match[1]] = match[2].replace(/^"|"$/g, '')
  }
  const id = (fields.ID || '').toLowerCase()
  const versionId = String(fields.VERSION_ID || '')
  if (id === 'ubuntu') {
    if (versionId.startsWith('24.04')) return { base: 'https://archive.ubuntu.com/ubuntu', suite: 'noble', kind: 'ubuntu' }
    if (versionId.startsWith('22.04')) return { base: 'https://archive.ubuntu.com/ubuntu', suite: 'jammy', kind: 'ubuntu' }
    if (versionId.startsWith('20.04')) return { base: 'https://archive.ubuntu.com/ubuntu', suite: 'focal', kind: 'ubuntu' }
    return { base: 'https://archive.ubuntu.com/ubuntu', suite: 'noble', kind: 'ubuntu' }
  }
  if (id === 'debian') {
    if (versionId.startsWith('12')) return { base: 'https://deb.debian.org/debian', suite: 'bookworm', kind: 'debian' }
    if (versionId.startsWith('11')) return { base: 'https://deb.debian.org/debian', suite: 'bullseye', kind: 'debian' }
    return { base: 'https://deb.debian.org/debian', suite: 'bookworm', kind: 'debian' }
  }
  // Unknown distro (most bot panels are Debian-based): bookworm is the
  // safest default — its libraries only need a glibc from 2022 or newer.
  return { base: 'https://deb.debian.org/debian', suite: 'bookworm', kind: 'debian' }
}

export function parseDebianPackagesIndex(text) {
  const map = new Map()
  for (const block of String(text || '').split('\n\n')) {
    const pkg = /^Package: (.+)$/m.exec(block)?.[1]?.trim()
    const filename = /^Filename: (.+)$/m.exec(block)?.[1]?.trim()
    if (!pkg || !filename) continue
    const sha256 = /^SHA256: ([0-9a-f]{64})$/m.exec(block)?.[1] || null
    const version = /^Version: (.+)$/m.exec(block)?.[1]?.trim() || ''
    map.set(pkg, { filename, sha256, version })
  }
  return map
}

export function parseLddMissingLibraries(lddOutput) {
  const missing = []
  for (const line of String(lddOutput || '').split('\n')) {
    const match = line.match(/^\s*(\S+)\s+=>\s+not found\s*$/)
    if (match && !missing.includes(match[1])) missing.push(match[1])
  }
  return missing
}

export function parseLoaderMissingLibrary(stderr) {
  const match = String(stderr || '').match(/error while loading shared libraries:\s*(\S+):\s*cannot open shared object file/)
  return match ? match[1] : ''
}

function aptInstallHint(packages) {
  const unique = [...new Set(packages)].filter(Boolean)
  return 'Alternatif: jalankan di terminal panel sebagai root: apt-get update && apt-get install -y ' + unique.join(' ') + '.'
}

async function resolvePackageArchive({ osReleasePath = '/etc/os-release', archiveBase = null } = {}) {
  let osRelease = ''
  try { osRelease = await fs.readFile(osReleasePath, 'utf8') } catch {}
  const detected = detectLinuxPackageArchive(osRelease)
  const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : null
  if (!arch) {
    throw new Error('Arsitektur CPU ' + process.arch + ' tidak didukung untuk instalasi library Chromium otomatis. ' +
      aptInstallHint(Object.values(CHROME_SHARED_LIBRARY_PACKAGES)))
  }
  return { base: archiveBase || detected.base, suite: detected.suite, kind: detected.kind, arch }
}

async function downloadBytes(url, { signal } = {}) {
  let response
  try {
    response = await fetch(url, { signal, redirect: 'follow' })
  } catch (error) {
    throw new Error('Gagal mengunduh ' + url + ': ' + String(error?.message || error).slice(0, 200))
  }
  if (!response.ok) {
    throw new Error('Gagal mengunduh ' + url + ': HTTP ' + response.status + '.')
  }
  return Buffer.from(await response.arrayBuffer())
}

async function getPackageIndex(archive, ctx) {
  if (ctx.indexPromise) return ctx.indexPromise
  ctx.indexPromise = (async () => {
    const cacheDir = path.join(ctx.libsDir, '.cache')
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 })
    const cachePath = path.join(cacheDir, 'Packages-' + archive.suite + '-' + archive.arch + '.gz')
    let gz = null
    try {
      const info = await fs.stat(cachePath)
      if (Date.now() - info.mtimeMs < 24 * 3600 * 1000) gz = await fs.readFile(cachePath)
    } catch {}
    if (!gz) {
      const url = archive.base + '/dists/' + archive.suite + '/main/binary-' + archive.arch + '/Packages.gz'
      ctx.onLog?.('[RENDER] Mengunduh indeks paket ' + archive.suite + '...\n')
      try {
        gz = await downloadBytes(url, { signal: ctx.signal })
      } catch (error) {
        throw new Error('Tidak dapat mengunduh indeks paket ' + archive.suite + ' dari ' + archive.base +
          ' (' + String(error?.message || error).slice(0, 200) + '). Periksa koneksi panel ke ' + archive.base + '. ' +
          aptInstallHint(Object.values(CHROME_SHARED_LIBRARY_PACKAGES)))
      }
      await fs.writeFile(cachePath, gz)
    }
    let text
    try {
      text = zlib.gunzipSync(gz).toString('utf8')
    } catch {
      await fs.rm(cachePath, { force: true }).catch(() => {})
      throw new Error('Indeks paket ' + archive.suite + ' rusak atau tidak dapat dibaca; coba .render retry.')
    }
    return parseDebianPackagesIndex(text)
  })()
  return ctx.indexPromise
}

async function pipeCommands(first, second) {
  const firstChild = spawn(first.command, first.args, {
    env: first.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  })
  const secondChild = spawn(second.command, second.args, {
    env: second.env, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true
  })
  firstChild.stdout?.pipe(secondChild.stdin)
  let firstError = ''
  let secondError = ''
  firstChild.stderr?.on('data', chunk => { firstError = (firstError + chunk.toString('utf8')).slice(-2000) })
  secondChild.stderr?.on('data', chunk => { secondError = (secondError + chunk.toString('utf8')).slice(-2000) })
  const [firstCode, secondCode] = await Promise.all([
    new Promise(resolve => { firstChild.once('error', () => resolve(-1)); firstChild.once('close', resolve) }),
    new Promise(resolve => { secondChild.once('error', () => resolve(-1)); secondChild.once('close', resolve) })
  ])
  if (firstCode !== 0) {
    throw new Error(first.command + ' keluar dengan kode ' + String(firstCode) +
      (firstError.trim() ? ': ' + firstError.trim().slice(-300) : '.'))
  }
  if (secondCode !== 0) {
    throw new Error(second.command + ' keluar dengan kode ' + String(secondCode) +
      (secondError.trim() ? ': ' + secondError.trim().slice(-300) : '.'))
  }
}

export async function extractDeb(debPath, destDir, { env } = {}) {
  await fs.mkdir(destDir, { recursive: true })
  try {
    await runCommandCollect({ command: 'dpkg-deb', args: ['-x', debPath, destDir], env })
    return 'dpkg-deb'
  } catch {}
  try {
    const members = await runCommandRaw({ command: 'ar', args: ['t', debPath], env, timeoutMs: 30000 })
    const dataMember = String(members.stdout || '').split('\n').map(line => line.trim())
      .find(name => /^data\.tar\./.test(name))
    if (!dataMember) throw new Error('anggota data.tar tidak ditemukan di .deb')
    const flag = dataMember.endsWith('.xz') ? '-xJ'
      : dataMember.endsWith('.gz') ? '-xz'
      : dataMember.endsWith('.zst') ? '--zstd -x'
      : dataMember.endsWith('.bz2') ? '-xj'
      : '-xf'
    await pipeCommands(
      { command: 'ar', args: ['p', debPath, dataMember], env },
      { command: 'tar', args: flag.split(' ').concat(['-C', destDir]), env }
    )
    return 'ar+tar'
  } catch (error) {
    throw new Error('Tidak dapat mengekstrak paket .deb: dpkg-deb dan ar/tar tidak tersedia atau gagal (' +
      String(error?.message || error).slice(0, 200) + ').')
  }
}

async function collectSharedLibraries(extractDir, libsDir) {
  const triplet = process.arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu'
  const roots = [
    path.join(extractDir, 'usr', 'lib', triplet),
    path.join(extractDir, 'usr', 'lib'),
    path.join(extractDir, 'lib', triplet),
    path.join(extractDir, 'lib')
  ]
  const placed = []
  for (const root of roots) {
    let entries
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      if (!/\.so(\.|$)/.test(entry.name)) continue
      const source = path.join(root, entry.name)
      const dest = path.join(libsDir, entry.name)
      await fs.rm(dest, { force: true }).catch(() => {})
      if (entry.isSymbolicLink()) {
        await fs.symlink(await fs.readlink(source), dest)
      } else {
        await fs.copyFile(source, dest)
        await fs.chmod(dest, 0o644).catch(() => {})
      }
      if (!placed.includes(entry.name)) placed.push(entry.name)
    }
  }
  return placed
}

async function installSharedLibrary(soname, ctx) {
  const packageName = CHROME_SHARED_LIBRARY_PACKAGES[soname]
  if (!packageName) {
    throw new Error('Library sistem ' + soname + ' yang dibutuhkan Chromium tidak ada di container dan tidak ada paket yang diketahui menyediakannya. ' +
      aptInstallHint([soname]))
  }
  // One package can provide several missing libraries (for example
  // libglib2.0-0 provides libglib, libgobject, libgio and libgmodule);
  // download it once per render.
  if (!ctx.installedPackages.has(packageName)) {
    const archive = ctx.archive
    const index = await getPackageIndex(archive, ctx)
    const entry = index.get(packageName)
    if (!entry) {
      throw new Error('Paket ' + packageName + ' (penyedia ' + soname + ') tidak ditemukan di indeks paket ' + archive.suite + '. ' +
        aptInstallHint([packageName]))
    }
    const debUrl = archive.base + '/' + entry.filename
    const cacheDir = path.join(ctx.libsDir, '.cache')
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 })
    const debPath = path.join(cacheDir, packageName + '.deb')
    ctx.onLog?.('[RENDER] Library ' + soname + ' belum ada di container; mengunduh paket ' + packageName +
      (entry.version ? ' (' + entry.version + ')' : '') + '.\n')
    const bytes = await downloadBytes(debUrl, { signal: ctx.signal })
    if (entry.sha256) {
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest !== entry.sha256) {
        throw new Error('Checksum paket ' + packageName + ' tidak cocok; unduhan mungkin rusak. Coba .render retry.')
      }
    }
    await fs.writeFile(debPath, bytes)
    const extractDir = path.join(cacheDir, packageName + '-extracted')
    await fs.rm(extractDir, { recursive: true, force: true })
    try {
      await extractDeb(debPath, extractDir, { env: ctx.env })
      await collectSharedLibraries(extractDir, ctx.libsDir)
    } finally {
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {})
    }
    await fs.rm(debPath, { force: true }).catch(() => {})
    ctx.installedPackages.add(packageName)
    ctx.onLog?.('[RENDER] Paket ' + packageName + ' terpasang ke folder library render.\n')
  }
  try {
    await fs.lstat(path.join(ctx.libsDir, soname))
  } catch {
    throw new Error('Paket ' + packageName + ' sudah diunduh tetapi tidak berisi ' + soname + '. ' +
      aptInstallHint([packageName]))
  }
}

async function findMissingLibrariesViaLdd(browserExecutable, ldLibraryPath, { env, lddCommand = 'ldd' }) {
  let result
  try {
    result = await runCommandRaw({
      command: lddCommand, args: [browserExecutable],
      env: { ...env, LD_LIBRARY_PATH: ldLibraryPath },
      timeoutMs: 30000
    })
  } catch {
    return null // ldd itself is missing or cannot run: use the probe loop
  }
  // ldd prints the missing libraries on stdout even when it exits non-zero.
  return parseLddMissingLibraries(result.stdout)
}

async function probeBrowserLaunch(browserExecutable, ldLibraryPath, { env, spawnEnv = {} }) {
  let result
  try {
    result = await runCommandRaw({
      command: browserExecutable, args: ['--version'],
      env: { ...env, ...spawnEnv, LD_LIBRARY_PATH: ldLibraryPath },
      timeoutMs: 30000
    })
  } catch (error) {
    throw new Error('Chromium gagal dijalankan saat pemeriksaan library: ' +
      String(error?.message || error).slice(0, 300))
  }
  if (result.code === 0) return ''
  const missing = parseLoaderMissingLibrary(result.stderr)
  if (missing) return missing
  throw new Error('Chromium gagal dijalankan (keluar dengan kode ' + String(result.code) + ').' +
    (result.stderr.trim() ? ' Detail: ' + result.stderr.trim().slice(-400) : ''))
}

export async function ensureChromeSharedLibraries(browserExecutable, {
  dataDir = getRenderDataDir(),
  env = process.env,
  signal = null,
  onLog = null,
  spawnEnv = {},
  archiveBase = null,
  lddCommand = 'ldd',
  osReleasePath = '/etc/os-release'
} = {}) {
  if (!browserExecutable) throw new Error('Executable browser Chromium tidak diberikan.')
  const libsDir = path.join(getRenderBrowserCacheDir(dataDir), 'libs')
  await fs.mkdir(libsDir, { recursive: true, mode: 0o700 })
  const archive = await resolvePackageArchive({ osReleasePath, archiveBase })
  const ctx = {
    libsDir, env, signal, onLog, archive,
    installedPackages: new Set(), indexPromise: null
  }
  const ldLibraryPath = () => [libsDir, String(env.LD_LIBRARY_PATH || '')].filter(Boolean).join(path.delimiter)
  const installed = []

  // Round 1: `ldd` lists every missing library at once.
  for (let round = 0; round < 4; round++) {
    throwIfCancelled(signal)
    const missing = await findMissingLibrariesViaLdd(
      browserExecutable, ldLibraryPath(), { env: { ...env, ...spawnEnv }, lddCommand })
    if (missing === null) break // no ldd: fall through to the probe loop
    if (!missing.length) break
    for (const soname of missing) {
      throwIfCancelled(signal)
      await installSharedLibrary(soname, ctx)
      installed.push(soname)
      if (installed.length > MAX_CHROME_LIBRARY_INSTALLS) {
        throw new Error('Terlalu banyak library sistem yang hilang (' + installed.length +
          '); instalasi otomatis dihentikan. ' + aptInstallHint(Object.values(CHROME_SHARED_LIBRARY_PACKAGES)))
      }
    }
  }

  // Round 2: actually launch the binary. The loader reports any remaining
  // missing library one at a time — this also covers libraries `ldd`
  // cannot see and libraries a downloaded package itself needs.
  for (let attempt = 0; attempt < MAX_CHROME_LIBRARY_INSTALLS; attempt++) {
    throwIfCancelled(signal)
    const missing = await probeBrowserLaunch(browserExecutable, ldLibraryPath(), { env, spawnEnv })
    if (!missing) break
    await installSharedLibrary(missing, ctx)
    installed.push(missing)
  }
  throwIfCancelled(signal)
  const stillMissing = await probeBrowserLaunch(browserExecutable, ldLibraryPath(), { env, spawnEnv })
  if (stillMissing) {
    throw new Error('Library ' + stillMissing + ' tetap tidak ditemukan setelah instalasi otomatis. ' +
      aptInstallHint([CHROME_SHARED_LIBRARY_PACKAGES[stillMissing] || stillMissing]))
  }

  if (installed.length) {
    onLog?.('[RENDER] ' + installed.length + ' library sistem terpasang untuk Chromium: ' + installed.join(', ') + '.\n')
  }
  return { libsDir, installed, ldLibraryPath: ldLibraryPath(), needed: installed.length > 0 }
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

export class CdpClient {
  constructor(webSocket) {
    this.ws = webSocket
    this.id = 0
    this.pending = new Map()
    this.events = []
    webSocket.onmessage = event => {
      let message
      try {
        // `ws` delivers text frames as a string, but be tolerant of Buffers
        // (binary frames) so a transport change never breaks parsing.
        const text = typeof event.data === 'string'
          ? event.data
          : Buffer.from(event.data).toString('utf8')
        message = JSON.parse(text)
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
  dataDir = getRenderDataDir(),
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

  // Minimal containers miss system libraries Chromium is linked against
  // (live failure 2026-11-27: libatk-1.0.so.0, exit 127). Install just the
  // missing ones into the render-browser libs dir and point the loader
  // there; on a complete system this is a no-op (one ldd + one probe).
  const { ldLibraryPath } = await ensureChromeSharedLibraries(browserExecutable, {
    dataDir, signal, onLog, spawnEnv: { HOME: profileDirectory }
  })
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
      env: { ...process.env, HOME: profileDirectory, LD_LIBRARY_PATH: ldLibraryPath },
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
