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
    const directoryStat = await fs.lstat(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue

    const manifestPath = path.join(directory, MANIFEST_NAME)
    let manifestStat
    try {
      manifestStat = await fs.lstat(manifestPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      if (now - directoryStat.mtimeMs > staleTtlMs) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
      }
      continue
    }

    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error('Manifest sesi render tidak aman: ' + directory)
    }
    if (manifestStat.size > 16 * 1024) {
      throw new Error('Manifest sesi render terlalu besar: ' + directory)
    }

    let manifest
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error('Manifest sesi render tidak dapat dibaca; update ditahan demi melindungi hasil: ' +
        String(error?.message || error))
    }

    const createdAt = Number(manifest?.createdAt)
    if (manifest?.schema !== 1 ||
        typeof manifest.key !== 'string' ||
        !manifest.key ||
        manifest.key.length > 512 ||
        !Number.isFinite(createdAt) ||
        createdAt <= 0 ||
        createdAt > now ||
        !safeOutputName(manifest.outputFileName)) {
      throw new Error('Metadata sesi render tidak valid; update ditahan demi melindungi hasil: ' + directory)
    }

    if (now - createdAt > staleTtlMs) {
      await fs.rm(directory, { recursive: true, force: true }).catch(error => {
        throw new Error('Sesi render kedaluwarsa tidak dapat dibersihkan: ' + String(error?.message || error))
      })
      continue
    }

    const outputPath = path.join(directory, manifest.outputFileName)
    const outputStat = await assertRegularFile(outputPath, 'Hasil render')
    if (outputStat.size < 1 || outputStat.size > maxOutputBytes) {
      throw new Error('Ukuran atau isi hasil render tidak valid; update ditahan: ' + outputPath)
    }

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
  }

  // If a chat has more than one completed result, the newest one wins when
  // the render plugin rebuilds its in-memory session map.
  restored.sort((a, b) => a.session.createdAt - b.session.createdAt)
  return restored
}
