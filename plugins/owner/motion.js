import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { constants as fsConstants } from 'node:fs'
import { fileTypeFromBuffer } from 'file-type'
import { synthesizeEdgeTTS } from '../../lib/tts-edge.js'
import { createRenderSessionKey, getCurrentRenderDocument, isZipDocumentEvent } from '../../lib/render-message.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import { isWhatsAppSocketOpen, sendWithWhatsAppReconnect } from '../../lib/whatsapp-connection.js'
import {
  persistRenderOutputSession,
  restorePendingRenderSessions
} from '../../lib/render-session-store.js'
import {
  runRenderScript,
  createRenderProgressReporter
} from '../../lib/render-script.js'
import {
  buildRemotionRenderScript,
  ensureRemotionProgressDependencies,
  findRemotionProject
} from '../../lib/remotion-project.js'
import {
  MOTION_STYLES,
  buildMotionPrompt,
  getMotionStyle,
  parseMotionZip,
  parseMotionConfig,
  validateMotionVoiceoverImplementation
} from '../../lib/motion-project.js'

const HEARTBEAT_MS = 60_000
const pendingJobs = new Map()
let recoveryPromise = null
let stateWritePromise = Promise.resolve()

function getMotionRoot() {
  const configured = String(process.env.ALVARETH_MOTION_TMPDIR || '').trim()
  const dataRoot = String(process.env.ALVARETH_DATA_DIR || path.join(homedir(), '.alvareth-bot-data'))
  return path.resolve(configured || path.join(dataRoot, 'motion-jobs'))
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return value.toFixed(0) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  return (value / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes >= 60) return Math.floor(minutes / 60) + 'j ' + (minutes % 60) + 'm'
  if (minutes) return minutes + 'm ' + remainder + ' dtk'
  return remainder + ' dtk'
}

function safeError(error) {
  const message = String(error?.message || error || 'Kesalahan tidak diketahui')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
  if (message.length <= 700) return message
  if (['RENDER_SCRIPT_FAILED', 'RENDER_BROWSER_TARGET_CLOSED'].includes(error?.code)) {
    return message.slice(0, 150) + ' … ' + message.slice(-520)
  }
  return message.slice(0, 700)
}

function getSocket(m) {
  const socket = typeof global.conn?.sendMessage === 'function' ? global.conn : m?.conn
  return socket && typeof socket.sendMessage === 'function' ? socket : null
}

async function safeReply(m, message) {
  try {
    const socket = getSocket(m)
    if (!socket || !m?.chat || !isWhatsAppSocketOpen(socket)) return null
    return await socket.sendMessage(m.chat, { text: message }, socket === m.conn && m?.key ? { quoted: m } : {})
  } catch (error) {
    console.warn('[MOTION] Gagal mengirim balasan WhatsApp:', error?.message || error)
    return null
  }
}

async function safeReact(m, emoji) {
  try {
    const socket = getSocket(m)
    if (!socket || !m?.chat || !m?.key || !isWhatsAppSocketOpen(socket)) return null
    return await socket.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
  } catch (error) {
    console.warn('[MOTION] Gagal mengirim reaksi WhatsApp:', error?.message || error)
    return null
  }
}

async function ensureMotionRoot() {
  const root = getMotionRoot()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('ALVARETH_MOTION_TMPDIR harus berupa direktori biasa, bukan symbolic link.')
  }
  return root
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && relative !== '..' &&
    !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function getPersistableSessions() {
  return [...pendingJobs.entries()]
    .filter(([, session]) => ['awaiting-zip', 'processing', 'failed'].includes(session.status))
    .map(([key, session]) => ({
      key,
      status: session.status,
      styleId: session.styleId,
      createdAt: session.createdAt,
      projectDirectory: session.projectDirectory || null,
      progress: session.progress || null,
      lastError: session.lastError || ''
    }))
}

async function persistMotionState() {
  const root = await ensureMotionRoot()
  const statePath = path.join(root, 'motion-sessions.json')
  const snapshot = JSON.stringify({ schema: 1, sessions: getPersistableSessions() }, null, 2) + '\n'

  stateWritePromise = stateWritePromise.then(async () => {
    try {
      const current = await fs.lstat(statePath)
      if (!current.isFile() || current.isSymbolicLink()) {
        throw new Error('File status sesi .motion tidak aman.')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    const temporary = statePath + '.tmp-' + process.pid
    await fs.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporary, statePath)
    await fs.chmod(statePath, 0o600).catch(() => {})
  })

  return stateWritePromise
}

async function restoreMotionState(root) {
  const statePath = path.join(root, 'motion-sessions.json')
  let raw
  try {
    const info = await fs.lstat(statePath)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) {
      throw new Error('File status sesi .motion tidak aman atau terlalu besar.')
    }
    raw = await fs.readFile(statePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }

  let state
  try {
    state = JSON.parse(raw)
  } catch (error) {
    throw new Error('Status sesi .motion tidak dapat dibaca: ' + safeError(error))
  }
  if (state?.schema !== 1 || !Array.isArray(state.sessions)) {
    throw new Error('Format status sesi .motion tidak dikenal.')
  }

  let restored = 0
  for (const item of state.sessions) {
    if (!item || typeof item.key !== 'string' || !item.key || item.key.length > 512) continue
    if (pendingJobs.has(item.key)) continue
    if (!['awaiting-zip', 'awaiting-code', 'processing', 'failed'].includes(item.status)) continue

    const session = {
      status: item.status === 'processing' ? 'failed' : item.status === 'awaiting-code' ? 'awaiting-zip' : item.status,
      styleId: getMotionStyle(item.styleId)?.id || '',
      createdAt: Number(item.createdAt) > 0 ? Number(item.createdAt) : Date.now(),
      processingStartedAt: null,
      progress: item.progress && typeof item.progress === 'object' ? item.progress : null,
      directory: null,
      projectDirectory: null,
      outputPath: null,
      outputSize: 0,
      abortController: null,
      cancelRequested: false,
      updateLockHeld: false,
      lastError: item.status === 'processing'
        ? 'Server bot sempat berhenti saat rendering. Gunakan .motion retry untuk melanjutkan.'
        : String(item.lastError || '')
    }

    if (typeof item.projectDirectory === 'string') {
      const projectDirectory = path.resolve(item.projectDirectory)
      const directory = path.dirname(projectDirectory)
      if (isInside(root, directory) && path.basename(directory).startsWith('alvareth-render-')) {
        try {
          const directoryInfo = await fs.lstat(directory)
          const projectInfo = await fs.lstat(projectDirectory)
          if (directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink() &&
              projectInfo.isDirectory() && !projectInfo.isSymbolicLink()) {
            session.directory = directory
            session.projectDirectory = projectDirectory
          }
        } catch {}
      }
    }

    if (session.status !== 'awaiting-zip' && !session.projectDirectory) {
      session.status = 'failed'
      session.lastError = 'Folder proyek tidak ditemukan setelah bot dimulai ulang. Kirim ulang file ZIP proyek.'
    }
    pendingJobs.set(item.key, session)
    restored++
  }
  return restored
}

function acquireUpdateLock(session) {
  if (!session || session.updateLockHeld) return
  if (global.__alvarethUpdateRunning) {
    const error = new Error('Pembaruan bot sedang berlangsung. Coba lagi setelah update selesai.')
    error.code = 'MOTION_UPDATE_RUNNING'
    throw error
  }
  session.updateLockHeld = true
  global.__alvarethRenderJobs = Math.max(0, Number(global.__alvarethRenderJobs) || 0) + 1
}

function releaseUpdateLock(session) {
  if (!session?.updateLockHeld) return false
  session.updateLockHeld = false
  global.__alvarethRenderJobs = Math.max(0, (Number(global.__alvarethRenderJobs) || 1) - 1)
  return true
}

function createTerminalProgress(session) {
  const progress = createRenderProgressReporter(session, message => console.log(message))
  let closed = false
  const heartbeat = setInterval(() => {
    if (closed || session.status !== 'processing') return
    const current = session.progress || {}
    console.log('[MOTION] HEARTBEAT | elapsed=' +
      formatElapsed(Date.now() - Number(session.processingStartedAt || session.createdAt || Date.now())) +
      ' | stage=' + String(current.stage || 'Menyiapkan render') +
      ' | childPid=' + String(session.renderChildPid || 'not-started') +
      ' | childState=' + String(session.renderChildState || 'not-started'))
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  return {
    update: progress.update,
    close() {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
    }
  }
}

async function removeJob(session) {
  if (!session) return
  releaseUpdateLock(session)
  if (!session.directory) return
  try {
    const root = getMotionRoot()
    const directory = path.resolve(session.directory)
    if (!isInside(root, directory) || !path.basename(directory).startsWith('alvareth-render-')) {
      throw new Error('Direktori job .motion berada di luar root penyimpanan.')
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 })
  } catch (error) {
    console.warn('[MOTION] Cleanup job gagal:', error?.message || error)
  }
}

async function ensureMotionRecovery() {
  if (!recoveryPromise) {
    recoveryPromise = (async () => {
      const root = await ensureMotionRoot()
      const restoredStateCount = await restoreMotionState(root)
      const restoredOutputs = await restorePendingRenderSessions({
        root,
        staleTtlMs: Number.POSITIVE_INFINITY,
        maxOutputBytes: Number.MAX_SAFE_INTEGER
      })

      for (const item of restoredOutputs) {
        pendingJobs.set(item.key, {
          ...item.session,
          status: 'output-ready',
          styleId: '',
          processingStartedAt: null,
          deliveryWaiting: false,
          deliveryStarted: false
        })
      }

      if (restoredStateCount || restoredOutputs.length) {
        console.log('[MOTION] Sesi dipulihkan:', {
          waitingOrFailed: restoredStateCount,
          outputReady: restoredOutputs.length
        })
        await persistMotionState()
      }
      return restoredStateCount + restoredOutputs.length
    })().catch(error => {
      global.__alvarethMotionRecoveryError = error
      console.error('[MOTION] Pemulihan sesi gagal:', error?.stack || error)
      throw error
    })
    global.__alvarethMotionRecoveryReady = recoveryPromise
  }
  return recoveryPromise
}

void ensureMotionRecovery().catch(() => {})

function throwIfCancelled(session) {
  if (!session?.cancelRequested && !session?.abortController?.signal?.aborted) return
  const error = new Error('Render .motion dibatalkan atas permintaan pengguna.')
  error.code = 'RENDER_SCRIPT_CANCELLED'
  throw error
}

async function findConfiguredBrowser() {
  const configured = String(process.env.ALVARETH_REMOTION_BROWSER_EXECUTABLE || '').trim()
  if (!configured) return ''
  if (!path.isAbsolute(configured)) {
    throw new Error('ALVARETH_REMOTION_BROWSER_EXECUTABLE harus berupa path absolut.')
  }
  await fs.access(configured, fsConstants.X_OK)
  const info = await fs.stat(configured)
  if (!info.isFile()) throw new Error('Browser executable Remotion bukan file biasa.')
  return configured
}

async function writeMotionZip(session, parsed) {
  const root = await ensureMotionRoot()
  session.directory = await fs.mkdtemp(path.join(root, 'alvareth-render-'))
  await fs.chmod(session.directory, 0o700).catch(() => {})
  session.projectDirectory = path.join(session.directory, 'project')
  await fs.mkdir(session.projectDirectory, { recursive: true, mode: 0o700 })

  for (const file of parsed.files) {
    const destination = path.resolve(session.projectDirectory, ...file.path.split('/'))
    if (!isInside(session.projectDirectory, destination)) {
      throw new Error('Path file ZIP keluar dari folder sesi.')
    }
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await fs.writeFile(destination, file.content, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
  }
}

async function removeGeneratedNodeModules(rootDirectory) {
  const root = path.resolve(rootDirectory)

  async function walk(directory, depth = 0) {
    if (depth > 16) throw new Error('Struktur folder proyek terlalu dalam saat membersihkan dependency.')
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Folder proyek berisi symbolic link yang tidak diizinkan.')
      if (!entry.isDirectory()) continue
      if (entry.name.toLowerCase() === 'node_modules') {
        const info = await fs.lstat(target)
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw new Error('Folder node_modules hasil proses sebelumnya tidak aman.')
        }
        await fs.rm(target, { recursive: true, force: true })
        continue
      }
      await walk(target, depth + 1)
    }
  }

  await walk(root)
}

async function prepareRemotionProgressRunner(project) {
  const runnerPath = path.join(project.projectRoot, '__alvareth_remotion_runner.mjs')
  try {
    const info = await fs.lstat(runnerPath)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('File runner Remotion sementara tidak aman.')
    }
    await fs.rm(runnerPath, { force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const sourcePath = new URL('../../lib/remotion-progress-runner.mjs', import.meta.url)
  const source = await fs.readFile(sourcePath, 'utf8')
  await fs.writeFile(runnerPath, source, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  })
  return runnerPath
}

async function readAndValidateMotionProject(projectDirectory) {
  const project = await findRemotionProject(projectDirectory)
  const configPath = path.join(project.projectRoot, 'motion.config.json')
  const packagePath = project.packageJsonPath
  const [configSource, packageSource] = await Promise.all([
    fs.readFile(configPath, 'utf8'),
    fs.readFile(packagePath, 'utf8')
  ])
  const config = parseMotionConfig(configSource)

  let packageJson
  try {
    packageJson = JSON.parse(packageSource)
  } catch (error) {
    throw new Error('package.json tidak valid: ' + safeError(error))
  }

  const dependencies = {
    ...(packageJson.dependencies && typeof packageJson.dependencies === 'object' ? packageJson.dependencies : {}),
    ...(packageJson.devDependencies && typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies : {}),
    ...(packageJson.optionalDependencies && typeof packageJson.optionalDependencies === 'object' ? packageJson.optionalDependencies : {})
  }
  if (!dependencies['@remotion/media-utils']) {
    throw new Error('package.json wajib mencantumkan @remotion/media-utils untuk menghitung durasi voiceover.')
  }

  const sourceFiles = []
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Proyek ZIP berisi symbolic link yang tidak diizinkan.')
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'out', 'dist', '.cache', '.render-home', '.render-tmp'].includes(entry.name.toLowerCase())) continue
        await walk(target)
      } else if (entry.isFile() && /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(entry.name)) {
        sourceFiles.push({
          path: path.relative(project.projectRoot, target).split(path.sep).join('/'),
          content: await fs.readFile(target, 'utf8')
        })
      }
    }
  }
  await walk(project.projectRoot)
  validateMotionVoiceoverImplementation(sourceFiles)
  return { config, project }
}

async function persistOutput(key, session) {
  return persistRenderOutputSession({
    root: getMotionRoot(),
    directory: session.directory,
    key,
    outputPath: session.outputPath,
    outputFileName: 'render-result.mp4',
    createdAt: session.createdAt,
    progress: session.progress
  })
}

async function deliverMotionOutput({ m, key, session, progress }) {
  const outputPath = session.outputPath
  const outputInfo = await fs.lstat(outputPath)
  if (!outputInfo.isFile() || outputInfo.isSymbolicLink() || outputInfo.size < 1) {
    throw new Error('File hasil .motion tidak valid atau kosong.')
  }

  await persistOutput(key, session)
  releaseUpdateLock(session)
  session.status = 'output-ready'
  session.deliveryWaiting = true
  session.deliveryStarted = false

  try {
    const result = await sendWithWhatsAppReconnect({
      getSocket: () => global.conn || m?.conn || null,
      signal: session.abortController?.signal,
      onWait: details => {
        if (details?.reason === 'waiting-for-connection' ||
            details?.reason === 'connection-still-unavailable' ||
            details?.reason === 'retry-after-disconnect') {
          try {
            global.requestWhatsAppReconnect?.('Video .motion selesai, tetapi koneksi WhatsApp belum siap.')
          } catch (error) {
            console.warn('[MOTION] Permintaan reconnect gagal:', error?.message || error)
          }
        }
      },
      onReconnectRequired: details => {
        try {
          global.requestWhatsAppReconnect?.('Pengiriman hasil .motion terputus: ' + safeError(details?.error))
        } catch (error) {
          console.warn('[MOTION] Permintaan reconnect gagal:', error?.message || error)
        }
      },
      send: socket => {
        if (session.abortController?.signal.aborted) {
          const error = new Error('Pengiriman .motion dibatalkan.')
          error.code = 'RENDER_SCRIPT_CANCELLED'
          throw error
        }
        if (global.__alvarethUpdateRunning) {
          const error = new Error('Pembaruan bot sedang berlangsung. Hasil tetap tersimpan untuk dikirim setelah update.')
          error.code = 'MOTION_DELIVERY_DEFERRED'
          throw error
        }
        acquireUpdateLock(session)
        if (global.__alvarethUpdateRunning) {
          releaseUpdateLock(session)
          const error = new Error('Pembaruan bot dimulai sebelum upload. Hasil tetap tersimpan untuk dikirim setelah update.')
          error.code = 'MOTION_DELIVERY_DEFERRED'
          throw error
        }
        session.deliveryWaiting = false
        session.deliveryStarted = true
        progress.update(96, 'Mengirim MP4 ke WhatsApp', formatBytes(outputInfo.size), true)
        return sendLocalFile(socket, m.chat, outputPath, {
          quoted: socket === m.conn ? m : undefined,
          caption: '🎬 Video .motion selesai dirender. Berikut hasilnya.'
        })
      }
    })

    await safeReact(m, '✅')
    progress.update(100, 'Selesai', 'MP4 berhasil dikirim ke WhatsApp.', true)
    if (pendingJobs.get(key) === session) pendingJobs.delete(key)
    await removeJob(session)
    await persistMotionState()
    console.log('[MOTION] Hasil terkirim:', {
      fileName: 'render-result.mp4',
      size: formatBytes(result?.size || outputInfo.size),
      messageId: result?.messageId
    })
    return true
  } catch (error) {
    session.status = 'output-ready'
    session.processingStartedAt = null
    session.deliveryWaiting = false
    session.deliveryStarted = false
    session.abortController = null
    releaseUpdateLock(session)
    if (session.outputPath) {
      progress.update(95, 'Video tersimpan - pengiriman tertunda', safeError(error), true)
      try { await persistOutput(key, session) } catch (persistError) {
        console.error('[MOTION] Manifest hasil gagal disimpan:', persistError?.stack || persistError)
      }
      await safeReact(m, '⚠️')
      await safeReply(m,
        '⚠️ Video sudah selesai dirender dan tetap tersimpan di server, tetapi belum terkirim: ' +
        safeError(error) + '\n\nKetik *.motion send* untuk mengirim video yang sama tanpa render ulang.')
    }
    return false
  }
}

async function processMotionProject({ m, key, session }) {
  const progress = createTerminalProgress(session)
  try {
    if (Number(String(process.versions.node).split('.')[0]) < 20) {
      throw new Error('Fitur .motion membutuhkan Node.js 20 atau lebih baru pada server bot.')
    }

    if (!session.projectDirectory) {
      throw new Error('Folder proyek .motion tidak ditemukan. Kirim ulang file ZIP proyek.')
    }

    acquireUpdateLock(session)
    throwIfCancelled(session)
    progress.update(3, 'Memeriksa proyek ZIP', 'Memvalidasi konfigurasi, struktur file, dan voiceover.', true)

    await removeGeneratedNodeModules(session.projectDirectory)
    const { config, project } = await readAndValidateMotionProject(session.projectDirectory)
    const progressDependencies = await ensureRemotionProgressDependencies(project)
    const runnerPath = await prepareRemotionProgressRunner(project)
    console.log('[MOTION] Renderer progres Remotion disiapkan:', {
      version: progressDependencies.version,
      addedDependencies: progressDependencies.added,
      runner: path.basename(runnerPath)
    })
    const { audio, profile } = await synthesizeEdgeTTS(config.voiceoverText, config.voiceProfile)
    throwIfCancelled(session)

    const publicDirectory = path.join(project.projectRoot, 'public')
    await fs.mkdir(publicDirectory, { recursive: true, mode: 0o700 })
    const voiceoverPath = path.join(publicDirectory, 'voiceover.mp3')
    await fs.writeFile(voiceoverPath, audio, { mode: 0o600 })
    progress.update(10, 'Voiceover selesai dibuat', profile.label + ' · ' + formatBytes(audio.length), true)

    const outputRelativePath = 'out/render-result.mp4'
    const outputPath = path.join(project.projectRoot, outputRelativePath)
    const scriptPath = path.join(project.projectRoot, '__alvareth_remotion_run.sh')

    try {
      const existingScript = await fs.lstat(scriptPath)
      if (!existingScript.isFile() || existingScript.isSymbolicLink()) {
        throw new Error('File sementara Remotion yang sudah ada tidak aman.')
      }
      await fs.rm(scriptPath, { force: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    try {
      const existingOutput = await fs.lstat(outputPath)
      if (!existingOutput.isFile() || existingOutput.isSymbolicLink()) {
        throw new Error('File output sementara Remotion yang sudah ada tidak aman.')
      }
      await fs.rm(outputPath, { force: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    const browserExecutable = await findConfiguredBrowser()
    const script = buildRemotionRenderScript({
      entryPoint: project.entryPoint,
      compositionId: project.compositionId,
      outputPath: outputRelativePath,
      browserExecutable,
      concurrency: 1,
      gl: project.renderGL
    })
    await fs.writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o600, flag: 'wx' })

    progress.update(15, 'Menyiapkan proyek Remotion',
      project.packageName + ' · ' + project.entryPoint + ' · ' + project.compositionId +
      (project.usesWebGL ? ' · WebGL ' + project.renderGL : ''), true)
    progress.update(18, 'Menginstal dependency', 'Lifecycle scripts dinonaktifkan untuk keamanan.', true)

    const processResult = await runRenderScript({
      scriptPath,
      workingDirectory: project.projectRoot,
      inputPath: project.packageJsonPath,
      signal: session.abortController?.signal,
      onStage: value => {
        const command = String(value.command || '').toLowerCase()
        if (command === 'npm') {
          progress.update(18, 'Menginstal dependency', 'Menggunakan --ignore-scripts.', true)
        } else if (command === 'node') {
          progress.update(20, 'Menjalankan Remotion SSR renderer', project.compositionId, true)
        } else {
          progress.update(22, 'Menjalankan pipeline', command, true)
        }
      },
      onProcess: value => {
        session.renderChildPid = value.pid || null
        session.renderChildState = value.running ? 'running' : String(value.state || 'unknown')
        if (value.state === 'started') {
          progress.update(25, 'Proses render aktif', 'PID ' + String(value.pid || 'tidak diketahui'), true)
        } else if (value.state === 'closed') {
          progress.update(88, 'Proses Remotion selesai', 'Exit code: ' + String(value.code), true)
        }
      },
      onProgress: value => {
        if (value.kind === 'bundle') {
          const raw = Number(value.percent)
          if (!Number.isFinite(raw)) return
          const bundlePercent = Math.max(0, Math.min(100, raw))
          progress.update(
            20 + Math.round(bundlePercent * 0.1),
            'Membundelkan proyek Remotion',
            bundlePercent.toFixed(1) + '%'
          )
          return
        }

        if (value.kind === 'composition') {
          const frames = Number(value.durationInFrames)
          const fps = Number(value.fps)
          const detail = [
            Number.isSafeInteger(frames) ? frames.toLocaleString('id-ID') + ' frame' : '',
            Number.isFinite(fps) && fps > 0 ? fps + ' FPS' : ''
          ].filter(Boolean).join(' · ')
          progress.update(30, 'Composition siap dirender', detail, true)
          return
        }

        if (value.kind === 'render-start') {
          session.renderFrameCount = Number.isSafeInteger(Number(value.frameCount))
            ? Number(value.frameCount)
            : null
          session.renderFps = Number.isFinite(Number(value.fps)) ? Number(value.fps) : null
          progress.update(30, 'Rendering dimulai',
            (session.renderFrameCount ? session.renderFrameCount.toLocaleString('id-ID') + ' frame' : '') +
            (session.renderFps ? ' · ' + session.renderFps + ' FPS' : '') +
            (Number.isFinite(Number(value.concurrency)) ? ' · concurrency ' + value.concurrency : ''), true)
          return
        }

        if (value.kind === 'render') {
          const raw = Number(value.progress)
          const normalized = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null
          const percent = normalized === null ? 30 : 30 + Math.round(normalized * 61)
          const rendered = Number(value.renderedFrames)
          const encoded = Number(value.encodedFrames)
          const detail = [
            Number.isFinite(rendered) && session.renderFrameCount
              ? 'Frame ' + Math.min(rendered, session.renderFrameCount).toLocaleString('id-ID') +
                '/' + session.renderFrameCount.toLocaleString('id-ID')
              : Number.isFinite(rendered) ? 'Frame ' + rendered.toLocaleString('id-ID') : '',
            Number.isFinite(encoded) && encoded > 0 ? 'Encoded ' + encoded.toLocaleString('id-ID') : '',
            session.renderFps ? session.renderFps + ' FPS' : ''
          ].filter(Boolean).join(' · ')
          const stage = value.stitchStage === 'muxing'
            ? 'Menggabungkan audio dan video'
            : 'Merender animasi'
          progress.update(percent, stage, detail)
        }
      }
    })
    throwIfCancelled(session)

    console.log('[MOTION] Render CLI selesai:', {
      package: project.packageName,
      composition: project.compositionId,
      entryPoint: project.entryPoint,
      duration: formatElapsed(processResult.durationMs),
      exitCode: processResult.code
    })

    progress.update(91, 'Memvalidasi MP4 hasil render', '', true)
    const outputInfo = await fs.lstat(outputPath)
    if (!outputInfo.isFile() || outputInfo.isSymbolicLink() || outputInfo.size < 1) {
      throw new Error('Remotion selesai, tetapi MP4 hasil render tidak ditemukan atau kosong.')
    }
    const handle = await fs.open(outputPath, 'r')
    const header = Buffer.alloc(4100)
    try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
    const detected = await fileTypeFromBuffer(header)
    if (detected && !['mp4', 'mov'].includes(String(detected.ext || '').toLowerCase())) {
      throw new Error('File keluaran tidak dikenali sebagai video MP4.')
    }

    session.outputPath = path.join(session.directory, 'render-result.mp4')
    session.outputFileName = 'render-result.mp4'
    session.outputSize = outputInfo.size
    await fs.rm(session.outputPath, { force: true }).catch(() => {})
    await fs.rename(outputPath, session.outputPath)
    await fs.chmod(session.outputPath, 0o600).catch(() => {})
    session.status = 'output-ready'
    session.processingStartedAt = null
    progress.update(94, 'Menyimpan hasil render', formatBytes(session.outputSize), true)
    await persistOutput(key, session)
    releaseUpdateLock(session)
    await persistMotionState()
    await deliverMotionOutput({ m, key, session, progress })
  } catch (error) {
    console.error('[MOTION] Proses rendering gagal:', error?.stack || error)
    session.processingStartedAt = null
    session.abortController = null
    session.deliveryWaiting = false
    session.deliveryStarted = false

    const cancelled = error?.code === 'RENDER_SCRIPT_CANCELLED' ||
      session.cancelRequested
    if (session.outputPath) {
      session.status = 'output-ready'
      releaseUpdateLock(session)
      try { await persistOutput(key, session) } catch (persistError) {
        console.error('[MOTION] Manifest pemulihan gagal:', persistError?.stack || persistError)
      }
      await safeReact(m, '⚠️')
      await safeReply(m, '⚠️ MP4 sudah tersimpan. Gunakan *.motion send* untuk mengirimnya tanpa render ulang.')
    } else if (cancelled) {
      if (pendingJobs.get(key) === session) pendingJobs.delete(key)
      await removeJob(session)
      await persistMotionState()
      await safeReact(m, '🛑')
      await safeReply(m, '🛑 Proses .motion dibatalkan dan file sementara dibersihkan.')
    } else {
      session.status = 'failed'
      session.lastError = safeError(error)
      releaseUpdateLock(session)
      await persistMotionState()
      await safeReact(m, '❌')
      await safeReply(m,
        '❌ Proses .motion gagal: ' + safeError(error) +
        '\n\nProyek dari ZIP tetap disimpan. Perbaiki proyek di GPT, kirim ulang ZIP, atau ketik *.motion retry* untuk mencoba proyek yang sama.')
    }
  } finally {
    progress.close()
  }
}

async function showStyleMenu(m, conn, usedPrefix = '.', requestedPage = 0) {
  const prefix = usedPrefix || '.'
  const pageSize = 8
  const pageCount = Math.max(1, Math.ceil(MOTION_STYLES.length / pageSize))
  const page = Math.max(0, Math.min(pageCount - 1,
    Number.isSafeInteger(requestedPage) ? requestedPage : 0))
  const start = page * pageSize
  const visibleStyles = MOTION_STYLES.slice(start, start + pageSize)
  const rows = visibleStyles.map(style => ({
    header: '',
    title: style.name,
    description: style.description.slice(0, 72),
    id: prefix + 'motion style ' + style.id
  }))

  if (page > 0) {
    rows.unshift({
      header: '',
      title: '⬅️ Gaya sebelumnya',
      description: 'Kembali ke halaman ' + page,
      id: prefix + 'motion page ' + page
    })
  }
  if (page < pageCount - 1) {
    rows.push({
      header: '',
      title: '➡️ Gaya lainnya',
      description: 'Lihat ' + (MOTION_STYLES.length - start - visibleStyles.length) + ' gaya berikutnya',
      id: prefix + 'motion page ' + (page + 2)
    })
  }

  return conn.sendMessage(m.chat, {
    text: [
      '🎬 *ALVARETH MOTION*',
      '',
      'Pilih gaya animasi terlebih dahulu.',
      'Halaman ' + (page + 1) + '/' + pageCount + ' · ' + MOTION_STYLES.length + ' gaya tersedia.',
      'Setelah dipilih, bot akan membuat prompt khusus untuk disalin ke GPT.',
      '',
      'Visual video dibuat dari kode. Tidak perlu mengirim gambar, video, atau aset.'
    ].join('\n'),
    footer: 'Alvareth Bot · ZIP-to-Animation',
    optionText: '🎨 Pilih Gaya Animasi',
    optionTitle: 'Gaya Animasi ' + (page + 1) + '/' + pageCount,
    nativeFlow: [{
      text: 'Pilih salah satu gaya',
      sections: [{ title: 'Gaya ' + (start + 1) + '–' + (start + visibleStyles.length) + ' dari ' + MOTION_STYLES.length, rows }],
      icon: 'review'
    }],
    interactiveAsTemplate: false
  }, m.key ? { quoted: m } : {})
}

async function sendPromptCopyButton(m, conn, style, usedPrefix = '.') {
  const prompt = buildMotionPrompt(style.id)
  const prefix = usedPrefix || '.'
  const session = {
    status: 'awaiting-zip',
    styleId: style.id,
    createdAt: Date.now(),
    processingStartedAt: null,
    progress: null,
    directory: null,
    projectDirectory: null,
    outputPath: null,
    outputSize: 0,
    abortController: null,
    cancelRequested: false,
    updateLockHeld: false,
    lastError: ''
  }
  const key = createRenderSessionKey(m)
  if (!key) throw new Error('Identitas chat/pengirim tidak terbaca.')
  const previous = pendingJobs.get(key)
  if (previous?.status === 'processing') {
    return safeReply(m, 'Job .motion sebelumnya masih berjalan. Gunakan *.motion status* atau *.motion cancel*.')
  }
  if (previous?.status === 'output-ready') {
    return safeReply(m, 'Hasil sebelumnya masih tersimpan. Gunakan *.motion send* atau *.motion cancel* terlebih dahulu.')
  }
  if (previous?.directory) await removeJob(previous)
  pendingJobs.set(key, session)
  await persistMotionState()

  return conn.sendMessage(m.chat, {
    text: [
      '🎨 *Gaya dipilih: ' + style.name + '*',
      '',
      'Tekan tombol *Salin Prompt GPT*, tempel prompt tersebut ke ChatGPT, lalu berikan tema video.',
      'GPT akan membuat satu file ZIP yang dapat diunduh. Kirim file ZIP itu ke chat ini sebagai dokumen WhatsApp.',
      '',
      'Bot akan mengekstrak proyek, membuat voiceover otomatis dari motion.config.json, lalu merender MP4.',
      '',
      'Kirim satu file .zip saja. Jangan tempel kode proyek ke chat.'
    ].join('\n'),
    footer: 'Prompt disesuaikan dengan gaya ' + style.name,
    nativeFlow: [
      { text: '📋 Salin Prompt GPT', copy: prompt },
      { text: '🎨 Pilih Gaya Lain', id: prefix + 'motion' },
      { text: '❌ Batalkan', id: prefix + 'motion cancel' }
    ],
    interactiveAsTemplate: false
  }, m.key ? { quoted: m } : {})
}

async function handleSend(m, key, session) {
  if (!session?.outputPath) return safeReply(m, 'Belum ada MP4 .motion yang menunggu dikirim.')
  if (session.status === 'processing') return safeReply(m, 'Job .motion masih berjalan.')
  session.status = 'output-ready'
  session.processingStartedAt = Date.now()
  session.abortController = new AbortController()
  const progress = createTerminalProgress(session)
  await safeReply(m, '📤 Mengirim ulang MP4 yang sudah tersimpan. Bot tidak akan merender ulang.')
  void deliverMotionOutput({ m, key, session, progress })
    .catch(async error => {
      session.status = 'output-ready'
      session.abortController = null
      releaseUpdateLock(session)
      try { await persistOutput(key, session) } catch (persistError) {
        console.error('[MOTION] Gagal menyimpan status pengiriman:', persistError?.stack || persistError)
      }
      await safeReply(m, '⚠️ MP4 tetap tersimpan, tetapi belum terkirim: ' + safeError(error) +
        '\n\nKetik *.motion send* untuk mencoba lagi.')
    })
    .finally(() => progress.close())
}

async function handler(m, { conn, text = '', usedPrefix = '.' } = {}) {
  if (!m?.chat) return
  try {
    await ensureMotionRecovery()
  } catch (error) {
    return safeReply(m, '⏳ Penyimpanan sesi .motion belum siap: ' + safeError(error))
  }

  const key = createRenderSessionKey(m)
  if (!key) return safeReply(m, 'Identitas chat/pengirim tidak terbaca. Coba ulangi perintah di chat pribadi bot.')
  const actionText = String(text || '').trim()
  const [action = '', argument = ''] = actionText.split(/\s+/, 2)
  const session = pendingJobs.get(key)

  if (!action) return showStyleMenu(m, conn, usedPrefix)

  if (action.toLowerCase() === 'page') {
    const requestedPage = Number(argument)
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      return showStyleMenu(m, conn, usedPrefix)
    }
    return showStyleMenu(m, conn, usedPrefix, requestedPage - 1)
  }

  if (action.toLowerCase() === 'style') {
    const style = getMotionStyle(argument)
    if (!style) return safeReply(m, 'Gaya animasi tidak dikenal. Ketik *.motion* untuk melihat daftar gaya.')
    return sendPromptCopyButton(m, conn, style, usedPrefix)
  }

  if (action.toLowerCase() === 'status') {
    if (!session) return safeReply(m, 'Tidak ada sesi .motion aktif.')
    if (session.status === 'awaiting-zip') {
      const style = getMotionStyle(session.styleId)
      return safeReply(m, '🎨 Menunggu file ZIP proyek untuk gaya ' + (style?.name || 'animasi') +
        '. Kirim file .zip sebagai dokumen WhatsApp. Sesi ini tidak kedaluwarsa otomatis.')
    }
    if (session.status === 'processing') {
      return safeReply(m, '🎬 Rendering .motion sedang berjalan di server. Detail progres hanya tersedia di terminal bot.')
    }
    if (session.status === 'output-ready' && session.outputPath) {
      return safeReply(m, '✅ MP4 selesai dan tersimpan (' + formatBytes(session.outputSize) +
        '), tetapi belum terkirim. Ketik *.motion send* untuk mengirim tanpa render ulang.')
    }
    if (session.status === 'failed') {
      return safeReply(m, '⚠️ Proyek dari ZIP masih tersimpan. Error: ' + String(session.lastError || 'Render gagal') +
        '\nKetik *.motion retry* untuk mencoba lagi atau *.motion cancel* untuk menghapus sesi.')
    }
    return safeReply(m, 'Status sesi .motion: ' + String(session.status || 'tidak diketahui'))
  }

  if (action.toLowerCase() === 'send') return handleSend(m, key, session)

  if (action.toLowerCase() === 'retry') {
    if (!session || session.status !== 'failed' || !session.projectDirectory) {
      return safeReply(m, 'Tidak ada proyek gagal yang bisa dicoba ulang. Kirim ZIP proyek setelah memilih gaya.')
    }
    if (global.__alvarethUpdateRunning) {
      return safeReply(m, '⏳ Render ditunda karena pembaruan bot sedang berlangsung. ZIP proyek tetap tersimpan; coba *.motion retry* setelah update selesai.')
    }
    session.status = 'processing'
    session.processingStartedAt = Date.now()
    session.abortController = new AbortController()
    session.cancelRequested = false
    session.lastError = ''
    session.progress = { percent: 0, stage: 'Mengulang render', detail: '', updatedAt: Date.now() }
    await persistMotionState()
    await safeReact(m, '🎬')
    await safeReply(m, '🔁 Mencoba render ulang dari proyek ZIP yang tersimpan. Tidak perlu mengirim ZIP lagi.')
    void processMotionProject({ m, key, session })
    return
  }

  if (action.toLowerCase() === 'cancel') {
    if (!session) return safeReply(m, 'Tidak ada sesi .motion yang bisa dibatalkan.')
    if (session.status === 'processing') {
      session.cancelRequested = true
      session.abortController?.abort()
      return safeReply(m, '🛑 Permintaan pembatalan diterima. Proses rendering sedang dihentikan.')
    }
    pendingJobs.delete(key)
    await removeJob(session)
    await persistMotionState()
    return safeReply(m, '🛑 Sesi .motion dibatalkan dan file sementara dibersihkan.')
  }

  return safeReply(m, [
    '*Perintah .motion*',
    '• .motion — pilih gaya animasi',
    '• .motion page 2 — lihat halaman gaya berikutnya',
    '• .motion status — cek proses atau sesi',
    '• .motion retry — ulangi render yang gagal',
    '• .motion send — kirim ulang MP4 yang tersimpan',
    '• .motion cancel — batalkan dan bersihkan sesi'
  ].join('\n'))
}

async function downloadMotionZip(m, conn, media = getCurrentRenderDocument(m)) {
  media = media || {}
  let buffer = null
  if (typeof m?.download === 'function') {
    try { buffer = await m.download() } catch (error) {
      console.warn('[MOTION] Download dokumen ZIP melalui serializer gagal:', error?.message || error)
    }
  }
  if ((!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) &&
      typeof conn?.downloadM === 'function') {
    buffer = await conn.downloadM(media, 'document')
  }
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new Error('Bot tidak berhasil mengunduh dokumen ZIP dari WhatsApp.')
  }

  const result = Buffer.from(buffer)
  if (!result.length) throw new Error('File ZIP yang dikirim kosong.')
  return result
}

async function before(m, { conn } = {}) {
  // This hook runs for every incoming message. Only ZIP documents belong to
  // this workflow; replying to ordinary text here causes a self-chat reply loop.
  if (!m?.chat || m?.__alvarethRenderZipHandled || m?.__alvarethMotionZipHandled) return false

  const document = getCurrentRenderDocument(m)
  if (!isZipDocumentEvent(m)) return false

  const key = createRenderSessionKey(m)
  if (!key) return false
  try {
    await ensureMotionRecovery()
  } catch {
    return false
  }

  const session = pendingJobs.get(key)
  if (!session || session.status !== 'awaiting-zip') return false

  // Claim this document only after confirming that this chat owns a waiting
  // .motion session. Unrelated ZIPs remain available to other workflows.
  m.__alvarethMotionZipHandled = true

  if (global.__alvarethUpdateRunning) {
    await safeReply(m, '⏳ Pembaruan bot sedang berlangsung. ZIP belum diproses. Kirim ulang ZIP setelah update selesai.')
    return true
  }

  let parsed
  try {
    const archiveBuffer = await downloadMotionZip(m, conn, document)
    parsed = await parseMotionZip(archiveBuffer)
    validateMotionVoiceoverImplementation(parsed.files)
  } catch (error) {
    await safeReact(m, '⚠️')
    await safeReply(m,
      '⚠️ ZIP belum bisa diproses: ' + safeError(error) +
      '\n\nPastikan ZIP berisi satu proyek Remotion, package.json, motion.config.json, dan folder src/. Perbaiki lalu kirim ulang ZIP.')
    return true
  }

  session.status = 'processing'
  session.processingStartedAt = Date.now()
  session.abortController = new AbortController()
  session.cancelRequested = false
  session.lastError = ''
  session.progress = {
    percent: 0,
    stage: 'Menerima ZIP proyek',
    detail: parsed.fileCount + ' file · ' + formatBytes(parsed.totalFileBytes),
    updatedAt: Date.now()
  }

  try {
    await writeMotionZip(session, parsed)
    await persistMotionState()
  } catch (error) {
    await removeJob(session)
    session.directory = null
    session.projectDirectory = null
    session.status = 'awaiting-zip'
    session.abortController = null
    session.processingStartedAt = null
    session.lastError = safeError(error)
    await persistMotionState()
    await safeReact(m, '❌')
    await safeReply(m, '❌ Gagal mengekstrak ZIP: ' + safeError(error) +
      '\nSesi tetap menunggu ZIP. Coba kirim ulang file ZIP.')
    return true
  }

  await safeReact(m, '🎬')
  await safeReply(m,
    '📦 ZIP diterima dan berhasil diekstrak (' + parsed.fileCount + ' file, ' +
    formatBytes(parsed.totalFileBytes) + ').\n' +
    'Bot sedang memeriksa proyek, membuat voiceover otomatis, dan merender MP4 di background.\n\n' +
    'Tidak ada batas waktu kedaluwarsa. Gunakan *.motion status* untuk mengecek proses.')
  void processMotionProject({ m, key, session })
  return true
}

handler.help = ['motion', 'motion status', 'motion retry', 'motion send', 'motion cancel']
handler.tags = ['owner']
handler.command = /^motion$/i
handler.rowner = true
handler.before = before

export default handler
