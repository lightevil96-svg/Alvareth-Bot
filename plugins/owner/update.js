import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import JSZip from 'jszip'

const REPOSITORY = 'lightevil96-svg/Alvareth-Bot'
const BRANCH = process.env.AUTO_UPDATE_BRANCH || 'main'
const UPDATE_PLUGIN_PATH = 'plugins/owner/update.js'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_COMPARE_FILES = 20_000
const REST_COMPARE_FILE_LIMIT = 300
const MAX_GIT_OUTPUT_BYTES = 20 * 1024 * 1024
const API_ROOT = 'https://api.github.com/repos/' + REPOSITORY
const RAW_ROOT = 'https://raw.githubusercontent.com/' + REPOSITORY
const STATE_DIRECTORY = process.env.ALVARETH_DATA_DIR
  ? path.resolve(process.env.ALVARETH_DATA_DIR)
  : path.join(os.homedir(), '.alvareth-bot-data')
const STATE_PATH = path.join(STATE_DIRECTORY, 'update-state-v1.json')

const githubToken = String(process.env.ALVARETH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim()
const requestHeaders = {
  'User-Agent': 'Alvareth-Bot-Updater',
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(githubToken ? { Authorization: 'Bearer ' + githubToken } : {})
}
const GIT_REMOTE_URL = 'https://github.com/' + REPOSITORY + '.git'

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const isSha = (value) => /^[0-9a-f]{40}$/i.test(String(value || ''))

function log(message) {
  console.log('[Alvareth updater]', message)
}

function describeFetchCause(error) {
  const parts = []
  let current = error
  for (let depth = 0; current && depth < 4; depth++, current = current.cause) {
    const code = current.code || current.errno
    const hostname = current.hostname ? ' host=' + current.hostname : ''
    const message = String(current.message || current).replace(/[\\r\\n]+/g, ' ').slice(0, 180)
    parts.push((code ? code + ': ' : '') + message + hostname)
  }
  return [...new Set(parts)].join(' <- ')
}

async function fetchWithRetry(url, options = {}, label = 'GitHub') {
  const maxAttempts = 3
  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options)
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
        return response
      }
      lastError = new Error('HTTP ' + response.status)
      log(label + ': percobaan ' + attempt + '/' + maxAttempts + ' mendapat HTTP ' + response.status + '; mencoba ulang.')
    } catch (error) {
      lastError = error
      log(label + ': percobaan ' + attempt + '/' + maxAttempts + ' gagal: ' + describeFetchCause(error))
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1200))
    }
  }

  throw new Error(
    label + ' gagal setelah ' + maxAttempts + ' percobaan: ' +
    describeFetchCause(lastError || new Error('penyebab tidak diketahui')),
    { cause: lastError }
  )
}

function isDependencyFile(rel) {
  return ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'].includes(rel)
}

// Protect runtime files, credentials, and generated state. .env.example is safe
// to update; real .env files and local variants are not.
function protectedPath(rel) {
  const p = String(rel || '').replace(/^\/+/, '')
  const parts = p.split('/')
  return (
    !p ||
    p === '.' ||
    p === '..' ||
    p.startsWith('../') ||
    p.includes(String.fromCharCode(0)) ||
    p === '.git' || p.startsWith('.git/') ||
    p === '.env' || (p.startsWith('.env.') && p !== '.env.example') ||
    p === 'node_modules' || p.startsWith('node_modules/') ||
    p === 'sessions' || p.startsWith('sessions/') ||
    p === 'session' || p.startsWith('session/') ||
    p === 'auth_info' || p.startsWith('auth_info/') ||
    p === 'auth_info_baileys' || p.startsWith('auth_info_baileys/') ||
    p === '.baileys_auth_info' || p.startsWith('.baileys_auth_info/') ||
    p === 'baileys_auth_info' || p.startsWith('baileys_auth_info/') ||
    p === 'tmp' || p.startsWith('tmp/') ||
    p === 'logs' || p.startsWith('logs/') ||
    p === 'data' || p.startsWith('data/') ||
    p === 'database' || p.startsWith('database/') ||
    p === 'database.json' || p === 'data.json' ||
    p === 'lib/chat.json' ||
    p === '.alvareth-update-state.json' ||
    p.startsWith('.alvareth-bot-data/') ||
    parts.some(part => part === '..')
  )
}

function normalizeRepoPath(input) {
  if (typeof input !== 'string' || !input || input.includes(String.fromCharCode(0))) return null
  const normalized = path.posix.normalize(input.replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized === '..' ||
      normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

async function fetchJson(url, label) {
  const response = await fetchWithRetry(url, { headers: requestHeaders }, label || 'GitHub API')
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = Number(response.headers.get('x-ratelimit-reset') || 0)
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    const error = new Error((label || 'GitHub API') + ' gagal: HTTP ' + response.status +
      (remaining === '0' && reset > 0
        ? ' (batas permintaan GitHub tercapai sampai ' + new Date(reset * 1000).toISOString() + ')'
        : retryAfter > 0 ? ' (GitHub meminta menunggu ' + retryAfter + ' detik)' : ''))
    error.status = response.status
    error.rateLimited = (response.status === 403 || response.status === 429) &&
      (remaining === '0' || retryAfter > 0)
    error.retryAfter = retryAfter
    error.resetAt = reset
    throw error
  }
  return response.json()
}

// Git smart HTTP does not consume the unauthenticated GitHub REST API quota.
// All commands run against an isolated, temporary bare repository: never reset
// or change the current bot's files, repository, runtime data or Git metadata.
function shouldUseGitFallback(error) {
  return error?.status === 403 || error?.status === 429 ||
    (Number(error?.status) >= 500 && Number(error?.status) <= 599) ||
    error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET'
}

async function runReadOnlyGit(args, cwd = process.cwd()) {
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        if (!settled) {
          settled = true
          reject(new Error('Git cadangan melewati batas waktu 120 detik.'))
        }
      }, 120_000)
      const done = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(value)
      }
      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8')
        if (stdout.length > MAX_GIT_OUTPUT_BYTES) {
          child.kill('SIGKILL')
          done(new Error('Output Git cadangan terlalu besar.'))
        }
      })
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString('utf8')).slice(-5000)
      })
      child.once('error', error => done(new Error('Git cadangan tidak tersedia: ' + error.message)))
      child.once('close', code => {
        if (code !== 0) return done(new Error('Git cadangan gagal (code ' + code + '): ' + stderr.trim().slice(-350)))
        done(null, { stdout })
      })
    })
    return stdout
  } catch (error) {
    throw error
  }
}

async function fetchLatestCommitViaGit() {
  const ref = 'refs/heads/' + BRANCH
  const output = await runReadOnlyGit(['ls-remote', '--exit-code', GIT_REMOTE_URL, ref])
  const line = output.split('\n').find(row => row.endsWith('\t' + ref))
  const sha = line?.split('\t')[0]?.trim()
  if (!isSha(sha)) throw new Error('Git cadangan tidak bisa memverifikasi SHA branch ' + BRANCH)
  return sha
}

function parseGitNameStatusZ(output) {
  const entries = String(output).split('\0')
  const files = []
  let index = 0
  while (index < entries.length && entries[index] !== '') {
    const status = entries[index++]
    const filename = entries[index++]
    if (!filename) throw new Error('Output diff Git cadangan tidak lengkap.')
    if (/^R[0-9]+$/.test(status)) {
      const renamedTo = entries[index++]
      if (!renamedTo) throw new Error('Nama file rename dari Git cadangan hilang.')
      files.push({ status: 'renamed', previous_filename: filename, filename: renamedTo })
    } else {
      if (!/^[AMDT]$/.test(status)) {
        throw new Error('Status file dari Git cadangan tidak dikenal: ' + status.slice(0, 15))
      }
      files.push({ status: status === 'D' ? 'removed' : status === 'A' ? 'added' : 'modified', filename })
    }
    if (files.length > MAX_COMPARE_FILES) {
      throw new Error('Git cadangan mendeteksi lebih dari ' + MAX_COMPARE_FILES.toLocaleString('id-ID') + ' file berubah; batas pengaman terlampaui dan sinkronisasi dibatalkan.')
    }
  }
  return files
}

async function compareCommitsViaGit(baseSha, headSha) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-update-git-'))
  try {
    await runReadOnlyGit(['init', '--quiet', '--bare', tempDir])
    await runReadOnlyGit([
      '-C', tempDir, 'fetch', '--quiet', '--no-tags', '--filter=blob:none',
      GIT_REMOTE_URL, 'refs/heads/' + BRANCH
    ])
    await runReadOnlyGit(['-C', tempDir, 'cat-file', '-e', baseSha + '^{commit}'])
    await runReadOnlyGit(['-C', tempDir, 'cat-file', '-e', headSha + '^{commit}'])
    try {
      await runReadOnlyGit(['-C', tempDir, 'merge-base', '--is-ancestor', baseSha, headSha])
    } catch {
      throw new Error('Baseline lokal bukan leluhur commit terbaru GitHub. Update dibatalkan demi keamanan.')
    }
    const aheadText = await runReadOnlyGit(['-C', tempDir, 'rev-list', '--count', baseSha + '..' + headSha])
    const aheadBy = Number(aheadText.trim())
    if (!Number.isSafeInteger(aheadBy) || aheadBy < 0) throw new Error('Jumlah commit Git cadangan tidak valid.')
    const output = await runReadOnlyGit([
      '-C', tempDir, 'diff', '--no-ext-diff', '--name-status', '-z',
      '--find-renames', baseSha, headSha
    ])
    return { status: aheadBy === 0 ? 'identical' : 'ahead', ahead_by: aheadBy, files: parseGitNameStatusZ(output) }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function fetchLatestCommitSha() {
  try {
    const data = await fetchJson(
      API_ROOT + '/commits/' + encodeURIComponent(BRANCH),
      'Membaca commit terbaru'
    )
    if (!isSha(data?.sha)) throw new Error('GitHub tidak mengembalikan SHA commit branch yang valid.')
    return data.sha
  } catch (error) {
    if (!shouldUseGitFallback(error)) throw error
    log('GitHub REST tidak dapat membaca commit (HTTP ' + (error.status || '?') +
      '). Memakai Git read-only sebagai cadangan tanpa mengubah file lokal.')
    try { return await fetchLatestCommitViaGit() }
    catch (fallbackError) {
      throw new Error('GitHub API ditolak dan jalur Git cadangan gagal. ' +
        'Periksa akses github.com dari server atau atur ALVARETH_GITHUB_TOKEN pada environment server. ' +
        'Detail: ' + fallbackError.message)
    }
  }
}

async function readSavedState() {
  try {
    const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'))
    if (state?.schema === 1 &&
        state.repository === REPOSITORY &&
        state.branch === BRANCH &&
        isSha(state.sha)) {
      return state
    }
    log('State update lama tidak cocok dengan repository/branch ini; mencoba mencari baseline dari versi updater lokal.')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('State update tidak dapat dibaca; akan mencoba memulihkan baseline dari versi updater lokal.')
    }
  }
  return null
}

async function saveState(sha) {
  await fs.mkdir(STATE_DIRECTORY, { recursive: true })
  const tempPath = STATE_PATH + '.tmp-' + process.pid
  const state = {
    schema: 1,
    repository: REPOSITORY,
    branch: BRANCH,
    sha,
    updatedAt: new Date().toISOString()
  }
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(tempPath, STATE_PATH)
}

// Older installations did not store a base commit SHA. Recover it by matching
// the installed updater file against its own GitHub history. If no exact match
// exists, stop rather than treating every local difference as an update.
async function inferInstalledBaseSha(root) {
  const localUpdaterPath = path.join(root, ...UPDATE_PLUGIN_PATH.split('/'))
  let localBuffer
  try {
    localBuffer = await fs.readFile(localUpdaterPath)
  } catch {
    return null
  }
  const localHash = sha256(localBuffer)
  const commitsUrl = API_ROOT + '/commits?path=' +
    encodeURIComponent(UPDATE_PLUGIN_PATH) + '&per_page=100&sha=' + encodeURIComponent(BRANCH)
  const commits = await fetchJson(commitsUrl, 'Mencari versi dasar updater')
  if (!Array.isArray(commits)) throw new Error('Riwayat file updater dari GitHub tidak valid.')

  for (const commit of commits) {
    if (!isSha(commit?.sha)) continue
    const url = RAW_ROOT + '/' + commit.sha + '/' +
      UPDATE_PLUGIN_PATH.split('/').map(encodeURIComponent).join('/')
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': 'Alvareth-Bot-Updater' } }, 'Mencari versi dasar updater')
    if (!response.ok) continue
    const remoteBuffer = Buffer.from(await response.arrayBuffer())
    if (sha256(remoteBuffer) === localHash) {
      log('Baseline lama berhasil dikenali dari versi plugins/owner/update.js yang terpasang.')
      return commit.sha
    }
  }
  return null
}

async function compareCommits(baseSha, headSha) {
  if (baseSha === headSha) return { status: 'identical', ahead_by: 0, files: [] }
  let data
  let usedGitFallback = false
  try {
    data = await fetchJson(
      API_ROOT + '/compare/' + baseSha + '...' + headSha,
      'Membandingkan file antarversi'
    )
  } catch (error) {
    if (!shouldUseGitFallback(error)) throw error
    log('GitHub REST tidak dapat membandingkan commit (HTTP ' + (error.status || '?') +
      '). Memakai Git diff read-only sebagai cadangan.')
    try {
      data = await compareCommitsViaGit(baseSha, headSha)
      usedGitFallback = true
    } catch (fallbackError) {
      throw new Error('API GitHub ditolak dan perbandingan Git cadangan gagal. ' +
        'Tidak ada file yang diubah. Periksa koneksi GitHub atau ALVARETH_GITHUB_TOKEN. ' +
        'Detail: ' + fallbackError.message)
    }
  }

  // GitHub's compare endpoint truncates the file list at 300 entries. A full
  // list is required before applying any writes, so transparently switch to
  // an isolated read-only Git diff whenever the REST response reaches that cap.
  if (!usedGitFallback && Array.isArray(data?.files) && data.files.length >= REST_COMPARE_FILE_LIMIT) {
    log('Daftar file dari GitHub REST mencapai batas 300. Mengambil diff lengkap melalui Git read-only.')
    try {
      data = await compareCommitsViaGit(baseSha, headSha)
      usedGitFallback = true
    } catch (fallbackError) {
      throw new Error('Daftar perubahan GitHub mungkin terpotong pada 300 file dan Git diff cadangan gagal. ' +
        'Tidak ada file yang diubah. Detail: ' + fallbackError.message)
    }
  }
  if (data?.status === 'behind' || data?.status === 'diverged') {
    throw new Error('Riwayat lokal dan branch GitHub tidak lagi berada pada satu jalur commit. Tidak ada file yang diubah demi keamanan; baseline perlu diperiksa manual.')
  }
  if (!Array.isArray(data?.files)) {
    throw new Error('GitHub tidak mengembalikan daftar file yang berubah; update dibatalkan.')
  }
  if (data.files.length > MAX_COMPARE_FILES) {
    throw new Error('Ada lebih dari ' + MAX_COMPARE_FILES.toLocaleString('id-ID') + ' file berubah sejak baseline. Update otomatis dihentikan karena batas pengaman ' + MAX_COMPARE_FILES.toLocaleString('id-ID') + ' file terlampaui.')
  }
  if (Number(data.ahead_by) > 0 && data.files.length === 0) {
    // A valid commit can change only parent metadata or produce an empty tree diff.
    // Never perform a blind write; record the new commit without touching files.
    log('Perbedaan commit kosong; tidak ada file yang akan diganti.')
  }
  return data
}

async function downloadArchiveAtCommit(commitSha) {
  const url = 'https://codeload.github.com/' + REPOSITORY + '/zip/' + commitSha
  const response = await fetchWithRetry(url, { headers: { 'User-Agent': 'Alvareth-Bot-Updater' } }, 'Mengunduh arsip GitHub')
  if (!response.ok) throw new Error('Arsip GitHub gagal diunduh: HTTP ' + response.status)

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_ARCHIVE_BYTES) {
    throw new Error('Arsip update melebihi batas 100 MB; update dibatalkan demi keamanan.')
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer())
  if (archiveBuffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error('Arsip update melebihi batas 100 MB; update dibatalkan demi keamanan.')
  }

  const zip = await JSZip.loadAsync(archiveBuffer, { checkCRC32: true })
  const entries = Object.values(zip.files).filter(entry => !entry.dir)
  if (!entries.length) throw new Error('Arsip GitHub kosong atau tidak valid.')

  const firstSlash = entries[0].name.indexOf('/')
  const rootPrefix = firstSlash >= 0 ? entries[0].name.slice(0, firstSlash + 1) : ''
  const files = new Map()

  for (const entry of entries) {
    if (entry.name.startsWith('__MACOSX/')) continue
    const relativeName = rootPrefix && entry.name.startsWith(rootPrefix)
      ? entry.name.slice(rootPrefix.length)
      : entry.name
    const rel = normalizeRepoPath(relativeName)
    if (!rel) continue
    files.set(rel, entry)
  }
  return files
}

async function fetchBaseFile(baseSha, rel) {
  const url = RAW_ROOT + '/' + baseSha + '/' +
    rel.split('/').map(encodeURIComponent).join('/')
  const response = await fetchWithRetry(url, { headers: { 'User-Agent': 'Alvareth-Bot-Updater' } }, 'Membaca file baseline')
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Gagal membaca file baseline ' + rel + ': HTTP ' + response.status)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_FILE_BYTES) throw new Error('File baseline terlalu besar: ' + rel)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_FILE_BYTES) throw new Error('File baseline terlalu besar: ' + rel)
  return buffer
}

async function ensureSafeParents(root, destination) {
  const relativeDirectory = path.relative(root, path.dirname(destination))
  if (relativeDirectory.startsWith('..' + path.sep) || relativeDirectory === '..' || path.isAbsolute(relativeDirectory)) {
    throw new Error('Path tujuan keluar dari direktori proyek.')
  }
  let current = root
  for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Direktori tujuan tidak aman (symlink/bukan folder): ' + current)
      }
    } catch (error) {
      if (error.code === 'ENOENT') break
      throw error
    }
  }
}

async function inspectLocalFile(root, rel) {
  const destination = path.resolve(root, ...rel.split('/'))
  if (destination !== root && !destination.startsWith(root + path.sep)) {
    throw new Error('Path tujuan keluar dari direktori proyek: ' + rel)
  }
  await ensureSafeParents(root, destination)
  try {
    const stat = await fs.lstat(destination)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { destination, exists: true, unsafe: true, buffer: null, mode: null }
    }
    return {
      destination,
      exists: true,
      unsafe: false,
      buffer: await fs.readFile(destination),
      mode: stat.mode & 0o777
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { destination, exists: false, unsafe: false, buffer: null, mode: null }
    throw error
  }
}

async function writeUpdatedFile(destination, buffer, mode) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const tempPath = destination + '.alvareth-update-tmp-' + process.pid
  await fs.writeFile(tempPath, buffer, { mode: mode || 0o644 })
  if (mode) await fs.chmod(tempPath, mode)
  await fs.rename(tempPath, destination)
}

function buildChangedPathList(files) {
  const changes = new Map()
  for (const file of files) {
    const rel = normalizeRepoPath(file.filename)
    if (!rel) throw new Error('Daftar perubahan GitHub mengandung path tidak valid.')
    if (file.status === 'renamed' && file.previous_filename) {
      const previous = normalizeRepoPath(file.previous_filename)
      if (!previous) throw new Error('Path lama dari file rename tidak valid.')
      changes.set(previous, { path: previous, action: 'delete' })
      changes.set(rel, { path: rel, action: 'upsert' })
    } else {
      changes.set(rel, {
        path: rel,
        action: file.status === 'removed' ? 'delete' : 'upsert'
      })
    }
  }
  return [...changes.values()]
}

async function handleUpdate(m, { isOwner }) {
  if (!isOwner) throw '❌ Perintah ini khusus owner bot.'
  if (global.__alvarethUpdateRunning) {
    return m.reply('⏳ Update sedang berjalan, tunggu sampai selesai.')
  }

  global.__alvarethUpdateRunning = true
  const root = process.cwd()
  let restartNeeded = false

  try {
    await m.reply('🔎 Memeriksa perubahan GitHub dan menyusun daftar file yang benar-benar berubah...')

    const headSha = await fetchLatestCommitSha()
    const savedState = await readSavedState()
    let baseSha = savedState?.sha || null

    if (!baseSha) {
      baseSha = await inferInstalledBaseSha(root)
      if (!baseSha) {
        throw new Error(
          'Versi dasar instalasi tidak dapat dipastikan dari riwayat plugins/owner/update.js. ' +
          'Tidak ada file proyek yang diubah. Pulihkan file updater asli dari versi GitHub yang dipasang, lalu jalankan .update lagi.'
        )
      }
    }

    if (!isSha(baseSha)) throw new Error('SHA baseline tidak valid; update dibatalkan.')
    const comparison = await compareCommits(baseSha, headSha)
    const changedPaths = buildChangedPathList(comparison.files || [])
      .filter(item => !protectedPath(item.path))

    if (!changedPaths.length) {
      await saveState(headSha)
      await m.reply(
        '✅ Tidak ada file proyek yang perlu diterapkan dari perubahan GitHub sejak versi dasar. ' +
        'File lain, konfigurasi, sesi, database, dan file lokal tidak disentuh.'
      )
      return
    }

    const remoteFiles = await downloadArchiveAtCommit(headSha)
    const plans = []
    const conflicts = []
    const ignored = []
    let dependencyFilesChanged = false

    // Fetch baseline versions before writing anything. A file is replaced only
    // if the current local bytes still match the version at baseSha.
    const uniquePaths = [...new Set(changedPaths.map(item => item.path))]
    const baseContents = new Map()
    let cursor = 0
    const workers = Array.from({ length: Math.min(6, uniquePaths.length) }, async () => {
      while (true) {
        const index = cursor++
        if (index >= uniquePaths.length) return
        const rel = uniquePaths[index]
        baseContents.set(rel, await fetchBaseFile(baseSha, rel))
      }
    })
    await Promise.all(workers)

    for (const change of changedPaths) {
      const rel = change.path
      if (protectedPath(rel)) {
        ignored.push(rel)
        continue
      }

      const baseBuffer = baseContents.get(rel) ?? null
      const remoteEntry = change.action === 'delete' ? null : remoteFiles.get(rel)
      if (change.action !== 'delete' && !remoteEntry) {
        throw new Error('File yang dinyatakan berubah tidak ditemukan dalam arsip commit baru: ' + rel)
      }

      const remoteBuffer = remoteEntry ? await remoteEntry.async('nodebuffer') : null
      if (remoteBuffer && remoteBuffer.length > MAX_FILE_BYTES) {
        throw new Error('File update terlalu besar (maksimal 50 MB): ' + rel)
      }

      const local = await inspectLocalFile(root, rel)
      if (local.unsafe) {
        conflicts.push(rel + ' (tujuan berupa symlink atau bukan file biasa)')
        continue
      }

      const remoteHash = remoteBuffer ? sha256(remoteBuffer) : null
      const baseHash = baseBuffer ? sha256(baseBuffer) : null
      const localHash = local.buffer ? sha256(local.buffer) : null

      // Already applied by an interrupted previous run: do not rewrite it.
      if (change.action === 'upsert' && local.exists && localHash === remoteHash) {
        if (isDependencyFile(rel)) dependencyFilesChanged = true
        continue
      }

      if (change.action === 'delete') {
        if (!local.exists) continue
        if (!baseBuffer || localHash !== baseHash) {
          conflicts.push(rel + ' (file lokal berubah; tidak dihapus)')
          continue
        }
        plans.push({ action: 'delete', path: rel, destination: local.destination })
        continue
      }

      if (!local.exists) {
        if (baseBuffer) {
          conflicts.push(rel + ' (file lokal yang ada pada baseline telah hilang; tidak dibuat ulang)')
          continue
        }
        plans.push({
          action: 'write',
          path: rel,
          destination: local.destination,
          buffer: remoteBuffer,
          mode: remoteEntry.unixPermissions ? (remoteEntry.unixPermissions & 0o777) : 0o644
        })
        if (isDependencyFile(rel)) dependencyFilesChanged = true
        continue
      }

      if (!baseBuffer || localHash !== baseHash) {
        conflicts.push(rel + ' (ada perubahan lokal; dipertahankan)')
        continue
      }

      plans.push({
        action: 'write',
        path: rel,
        destination: local.destination,
        buffer: remoteBuffer,
        mode: local.mode || (remoteEntry.unixPermissions ? (remoteEntry.unixPermissions & 0o777) : 0o644)
      })
      if (isDependencyFile(rel)) dependencyFilesChanged = true
    }

    // Commit only paths recorded in the GitHub compare result. Unrelated files
    // are never examined for replacement and are never removed.
    for (const plan of plans) {
      if (plan.action === 'delete') {
        await fs.unlink(plan.destination)
        log('Dihapus sesuai commit GitHub: ' + plan.path)
        restartNeeded = true
      } else {
        await writeUpdatedFile(plan.destination, plan.buffer, plan.mode)
        log('Diterapkan dari commit GitHub: ' + plan.path)
        restartNeeded = true
      }
    }

    if (dependencyFilesChanged) {
      await m.reply('📦 File dependensi berubah. Menjalankan npm install...')
      await new Promise((resolve, reject) => {
        const child = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
          cwd: root,
          stdio: 'inherit',
          shell: process.platform === 'win32'
        })
        child.once('error', reject)
        child.once('close', code => code === 0
          ? resolve()
          : reject(new Error('npm install keluar dengan kode ' + code)))
      })
      // A previous attempt may already have written the manifest before npm
      // failed; a successful retry still requires a worker restart.
      restartNeeded = true
    }

    // If local edits conflicted with changed upstream files, keep the old base
    // so the user can resolve the conflict and run .update again. Files that
    // were already applied are recognized by their hash and won't be rewritten.
    await saveState(conflicts.length ? baseSha : headSha)

    const sections = []
    if (plans.some(plan => plan.action === 'write')) {
      const written = plans.filter(plan => plan.action === 'write').map(plan => plan.path)
      sections.push('Diubah/ditambahkan (' + written.length + '):\n' +
        written.slice(0, 25).map(file => '• ' + file).join('\n'))
    }
    if (plans.some(plan => plan.action === 'delete')) {
      const removed = plans.filter(plan => plan.action === 'delete').map(plan => plan.path)
      sections.push('Dihapus sesuai commit (' + removed.length + '):\n' +
        removed.slice(0, 25).map(file => '• ' + file).join('\n'))
    }
    if (conflicts.length) {
      sections.push('Dipertahankan karena ada perubahan lokal (' + conflicts.length + '):\n' +
        conflicts.slice(0, 15).map(file => '• ' + file).join('\n') +
        '\nBaseline tidak dimajukan; jalankan .update lagi setelah konflik file tersebut diselesaikan.')
    }
    if (ignored.length) {
      sections.push('File terlindungi dilewati (' + ignored.length + ').')
    }
    const totalListed = plans.length + conflicts.length + ignored.length
    const summary = sections.join('\n\n') || 'Tidak ada perubahan file yang perlu ditulis.'
    const restartText = restartNeeded
      ? '\n\n🔄 File yang berhasil diterapkan sudah siap. Bot akan restart sekarang.'
      : '\n\nTidak ada file yang ditulis ulang.'
    await m.reply(
      '✅ Pemeriksaan update selesai.\n\n' + summary +
      (totalListed > 40 ? '\n...daftar dipotong.' : '') +
      '\n\n🔒 Hanya file yang berubah pada commit GitHub yang diproses. File lokal yang berbeda dari baseline tidak ditimpa; sesi, .env, database, node_modules, dan file lain di luar daftar perubahan tetap dilindungi.' +
      restartText
    )

    if (restartNeeded) {
      setTimeout(() => {
        if (typeof process.send === 'function') process.send('reset')
        else process.exit(0)
      }, 1500)
    }
  } catch (error) {
    console.error('[Alvareth updater]', error?.stack || error)
    await m.reply(
      '❌ Update dibatalkan/gagal. File di luar daftar perubahan tidak disentuh.\n' +
      (error?.message || String(error))
    )
  } finally {
    global.__alvarethUpdateRunning = false
  }
}

const handler = handleUpdate
handler.help = ['update']
handler.tags = ['owner']
handler.command = /^update$/i
handler.owner = true
// Maintenance/update must be callable by the owner even before .daftar.
handler.register = false

export default handler
