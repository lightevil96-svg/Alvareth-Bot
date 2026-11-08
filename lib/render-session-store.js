import fs from 'node:fs/promises'
import path from 'node:path'

const MANIFEST_NAME = 'render-session.json'
const DIRECTORY_PREFIX = 'alvareth-render-'

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..' + path.sep) &&
    relative !== '..' && !path.isAbsolute(relative)
}

function safeOutputName(value) {
  if (typeof value !== 'string' || !value || path.basename(value) !== value) return false
  return /^render-result\.[a-z0-9]{1,8}$/i.test(value)
}

async function assertRegularFile(filePath, label) {
  const stat = await fs.lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(label + ' harus berupa file biasa, bukan symlink.')
  }
  return stat
}

export async function persistRenderOutputSession({
  root,
  directory,
  key,
  outputPath,
  outputFileName,
  createdAt = Date.now(),
  progress = null
} = {}) {
  if (typeof key !== 'string' || !key || key.length > 512) {
    throw new TypeError('Kunci sesi render tidak valid.')
  }

  const rootPath = path.resolve(String(root || ''))
  const directoryPath = path.resolve(String(directory || ''))
  const outputFilePath = path.resolve(String(outputPath || ''))
  const outputName = outputFileName || path.basename(outputFilePath)

  if (!root || !directory || !outputPath ||
      !isInside(rootPath, directoryPath) ||
      !isInside(directoryPath, outputFilePath) ||
      path.dirname(outputFilePath) !== directoryPath ||
      !safeOutputName(outputName) ||
      path.basename(outputFilePath) !== outputName) {
    throw new Error('Lokasi sesi atau file hasil render berada di luar direktori sesi yang diizinkan.')
  }

  const directoryStat = await fs.lstat(directoryPath)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Direktori sesi render tidak aman.')
  }

  const outputStat = await assertRegularFile(outputFilePath, 'Hasil render')
  if (outputStat.size < 1) throw new Error('File hasil render kosong.')
  if (!Number.isFinite(Number(createdAt)) || Number(createdAt) <= 0) {
    throw new TypeError('Waktu pembuatan sesi render tidak valid.')
  }

  const manifest = {
    schema: 1,
    key,
    createdAt: Number(createdAt),
    outputFileName: outputName,
    outputSize: outputStat.size,
    progress: {
      percent: 95,
      stage: 'Hasil render tersimpan - pengiriman tertunda',
      detail: String(progress?.detail || 'Hasil render siap dikirim ulang tanpa menjalankan render dari awal.').slice(0, 700),
      updatedAt: Date.now()
    }
  }

  const manifestPath = path.join(directoryPath, MANIFEST_NAME)
  const tempPath = manifestPath + '.tmp-' + process.pid + '-' + Date.now()

  try {
    await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    await fs.rename(tempPath, manifestPath)
    await fs.chmod(manifestPath, 0o600).catch(() => {})
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {})
    throw error
  }

  return manifest
}

export async function restorePendingRenderSessions({
  root,
  staleTtlMs = 24 * 60 * 60 * 1000,
  maxOutputBytes = 500 * 1024 * 1024,
  now = Date.now()
} = {}) {
  if (!root) throw new TypeError('Root penyimpanan sesi render wajib diisi.')

  const rootPath = path.resolve(root)
  await fs.mkdir(rootPath, { recursive: true, mode: 0o700 })
  const rootStat = await fs.lstat(rootPath)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Direktori penyimpanan render harus berupa direktori biasa, bukan symlink.')
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  const restored = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DIRECTORY_PREFIX)) continue

    const directory = path.join(rootPath, entry.name)
    let directoryStat
    try {
      directoryStat = await fs.lstat(directory)
    } catch {
      continue
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue

    const manifestPath = path.join(directory, MANIFEST_NAME)
    let manifest
    try {
      const manifestStat = await assertRegularFile(manifestPath, 'Manifest sesi render')
      if (manifestStat.size > 16 * 1024) throw new Error('Manifest sesi render terlalu besar.')
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    } catch {
      if (now - directoryStat.mtimeMs > staleTtlMs) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
      }
      continue
    }

    const createdAt = Number(manifest?.createdAt)
    if (manifest?.schema !== 1 ||
        typeof manifest.key !== 'string' ||
        !manifest.key ||
        manifest.key.length > 512 ||
        !Number.isFinite(createdAt) ||
        createdAt <= 0 ||
        createdAt > now ||
        now - createdAt > staleTtlMs ||
        !safeOutputName(manifest.outputFileName)) {
      if (now - directoryStat.mtimeMs > staleTtlMs) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
      }
      continue
    }

    const outputPath = path.join(directory, manifest.outputFileName)
    try {
      const outputStat = await assertRegularFile(outputPath, 'Hasil render')
      if (outputStat.size < 1 || outputStat.size > maxOutputBytes) continue

      const progress = manifest.progress && typeof manifest.progress === 'object'
        ? {
            percent: 95,
            stage: 'Hasil render tersimpan - pengiriman tertunda',
            detail: String(manifest.progress.detail || 'Hasil render siap dikirim ulang tanpa menjalankan render dari awal.').slice(0, 700),
            updatedAt: Number(manifest.progress.updatedAt) || createdAt
          }
        : {
            percent: 95,
            stage: 'Hasil render tersimpan - pengiriman tertunda',
            detail: 'Hasil render siap dikirim ulang tanpa menjalankan render dari awal.',
            updatedAt: createdAt
          }

      restored.push({
        key: manifest.key,
        session: {
          directory,
          createdAt,
          processing: false,
          progress,
          updateLockHeld: false,
          abortController: null,
          cancelRequested: false,
          outputPath,
          outputFileName: String(manifest.outputFileName),
          outputSize: outputStat.size,
          restored: true
        }
      })
    } catch {
      // Keep an invalid or temporarily inaccessible result untouched for manual inspection.
    }
  }

  return restored
}
