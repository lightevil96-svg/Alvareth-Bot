import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { arch, homedir, platform } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

const DATA_DIR = process.env.ALVARETH_DATA_DIR
  ? resolve(process.env.ALVARETH_DATA_DIR)
  : join(homedir(), '.alvareth-bot-data')
const TOKEN_FILE = process.env.VIDEO_STUDIO_TUNNEL_TOKEN_FILE
  ? resolve(process.env.VIDEO_STUDIO_TUNNEL_TOKEN_FILE)
  : join(DATA_DIR, 'video-studio', 'tunnel-token')

let child = null
let retryTimer = null
let retryDelay = 5000
let restartAttempts = 0
const MAX_RESTART_ATTEMPTS = 10
let stopping = false
let started = false

function log(message) {
  console.log('[VIDEO STUDIO TUNNEL] ' + message)
}

export function getCloudflaredAssetName(osName = platform(), archName = arch()) {
  if (osName !== 'linux') return null
  if (archName === 'x64') return 'cloudflared-linux-amd64'
  if (archName === 'arm64') return 'cloudflared-linux-arm64'
  return null
}

function findExistingBinary() {
  const configured = String(process.env.CLOUDFLARED_BIN || '').trim()
  if (configured) {
    const path = resolve(configured)
    if (!existsSync(path)) throw new Error('CLOUDFLARED_BIN menunjuk file yang tidak ditemukan: ' + path)
    return path
  }

  const candidates = [
    join(process.cwd(), 'bin', 'cloudflared'),
    join(DATA_DIR, 'bin', 'cloudflared'),
    ...String(process.env.PATH || '').split(delimiter).filter(Boolean).map(dir => join(dir, 'cloudflared'))
  ]
  return candidates.find(path => existsSync(path)) || null
}

async function downloadCloudflared() {
  const assetName = getCloudflaredAssetName()
  if (!assetName) {
    throw new Error('Auto-install cloudflared mendukung Linux x64 dan ARM64. Pasang binary secara manual untuk platform/arsitektur ini.')
  }

  log('Binary cloudflared belum ditemukan. Mengunduh rilis resmi Cloudflare dan memverifikasi SHA-256...')
  const releaseResponse = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Alvareth-Video-Studio'
    },
    signal: AbortSignal.timeout(30000)
  })
  if (!releaseResponse.ok) {
    throw new Error('Metadata rilis cloudflared gagal diambil (HTTP ' + releaseResponse.status + ').')
  }

  const release = await releaseResponse.json()
  const asset = Array.isArray(release.assets)
    ? release.assets.find(item => item.name === assetName)
    : null
  if (!asset || !asset.browser_download_url || !String(asset.digest || '').startsWith('sha256:')) {
    throw new Error('Rilis cloudflared tidak menyediakan binary atau SHA-256 tepercaya untuk ' + assetName + '.')
  }

  const downloadResponse = await fetch(asset.browser_download_url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120000)
  })
  if (!downloadResponse.ok) {
    throw new Error('Unduhan binary cloudflared gagal (HTTP ' + downloadResponse.status + ').')
  }

  const bytes = Buffer.from(await downloadResponse.arrayBuffer())
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) {
    throw new Error('Ukuran binary cloudflared tidak wajar; instalasi dibatalkan.')
  }
  if (asset.size && bytes.length !== asset.size) {
    throw new Error('Ukuran binary cloudflared tidak cocok dengan metadata rilis; instalasi dibatalkan.')
  }

  const actualDigest = createHash('sha256').update(bytes).digest('hex')
  const expectedDigest = String(asset.digest).slice('sha256:'.length).toLowerCase()
  if (actualDigest !== expectedDigest) {
    throw new Error('Verifikasi SHA-256 cloudflared gagal; binary tidak dijalankan.')
  }

  const binDir = join(DATA_DIR, 'bin')
  mkdirSync(binDir, { recursive: true, mode: 0o700 })
  const destination = join(binDir, 'cloudflared')
  const temporary = destination + '.download-' + process.pid
  writeFileSync(temporary, bytes, { mode: 0o700 })
  chmodSync(temporary, 0o700)
  renameSync(temporary, destination)
  chmodSync(destination, 0o700)
  log('cloudflared ' + String(release.tag_name || 'latest') + ' terpasang dan SHA-256 terverifikasi di ' + destination + '.')
  return destination
}

async function ensureCloudflared() {
  const existing = findExistingBinary()
  return existing || downloadCloudflared()
}

function prepareTokenFile() {
  const supplied = String(process.env.VIDEO_STUDIO_TUNNEL_TOKEN || '').trim()
  if (supplied) {
    if (supplied.length < 32) throw new Error('VIDEO_STUDIO_TUNNEL_TOKEN terlalu pendek; periksa token tunnel Cloudflare.')
    mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 })
    writeFileSync(TOKEN_FILE, supplied + '\n', { mode: 0o600 })
    chmodSync(TOKEN_FILE, 0o600)
    return true
  }

  if (!existsSync(TOKEN_FILE)) return false
  const saved = readFileSync(TOKEN_FILE, 'utf8').trim()
  if (saved.length < 32) throw new Error('File token tunnel kosong atau tidak valid: ' + TOKEN_FILE)
  try { chmodSync(TOKEN_FILE, 0o600) } catch {}
  return true
}

function scheduleRetry() {
  if (stopping || retryTimer) return
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    log('Batas ' + MAX_RESTART_ATTEMPTS + ' percobaan restart tercapai. Periksa log/koneksi lalu restart bot secara manual.')
    return
  }
  restartAttempts += 1
  const delay = retryDelay
  log('Mencoba kembali dalam ' + Math.round(delay / 1000) + ' detik.')
  retryTimer = setTimeout(() => {
    retryTimer = null
    void launch()
  }, delay)
  retryDelay = Math.min(retryDelay * 2, 60000)
}

async function launch() {
  if (stopping || child) return

  try {
    const binary = await ensureCloudflared()
    if (stopping || child) return

    log('Menjalankan named tunnel ke origin http://127.0.0.1:' + (process.env.PORT || process.env.SERVER_PORT || 3000) + ' menggunakan konfigurasi Cloudflare.')
    const tokenForRedaction = readFileSync(TOKEN_FILE, 'utf8').trim()
    const proc = spawn(binary, [
      'tunnel',
      '--no-autoupdate',
      'run',
      '--token-file',
      TOKEN_FILE
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child = proc

    let pending = ''
    let connected = false
    const consume = chunk => {
      pending += String(chunk)
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() || ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (/registered tunnel connection|connection registered|connected to cloudflare/i.test(line)) {
          if (!connected) log('Koneksi Cloudflare aktif; hostname video.lightjurnal.my.id siap menerima trafik.')
          connected = true
          retryDelay = 5000
          restartAttempts = 0
        }
        const safeLine = tokenForRedaction ? line.replaceAll(tokenForRedaction, '[REDACTED]') : line
        log(safeLine)
      }
    }

    proc.stdout.on('data', consume)
    proc.stderr.on('data', consume)
    proc.on('error', error => {
      if (child === proc) child = null
      log('Gagal menjalankan cloudflared: ' + error.message)
      scheduleRetry()
    })
    proc.on('spawn', () => {
      log('Proses cloudflared berjalan; menunggu koneksi ke edge Cloudflare.')
    })
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null
      if (stopping) return
      log('Proses tunnel berhenti (code=' + code + ', signal=' + signal + ').')
      scheduleRetry()
    })
  } catch (error) {
    log('Persiapan tunnel gagal: ' + (error && error.message ? error.message : String(error)))
    scheduleRetry()
  }
}

function stop() {
  stopping = true
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (child) child.kill('SIGTERM')
}

export function startVideoStudioTunnel(port) {
  if (started) return
  started = true

  if (process.env.VIDEO_STUDIO_TUNNEL === 'false') {
    log('Dinonaktifkan melalui VIDEO_STUDIO_TUNNEL=false.')
    return
  }

  try {
    if (!prepareTokenFile()) {
      log('Token belum tersedia. Tambahkan VIDEO_STUDIO_TUNNEL_TOKEN pada environment server atau simpan token di ' + TOKEN_FILE + '.')
      log('Cloudflare DNS dan hostname sudah dikonfigurasi; konektor akan aktif otomatis setelah token tersedia dan bot direstart.')
      return
    }
  } catch (error) {
    log(error.message)
    return
  }

  stopping = false
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  log('Autostart aktif untuk hostname video.lightjurnal.my.id (port aplikasi ' + port + ').')
  void launch()
}
