import fs from 'node:fs/promises'
import path from 'node:path'

export const DOWNLOAD_PAGE_SIZE = 8
const MAX_DIRECTORY_ENTRIES = 5000

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
}

export function encodeDownloadPath(relativePath = '.') {
  const value = String(relativePath || '.').replace(/\\/g, '/')
  return Buffer.from(value, 'utf8').toString('base64url')
}

export function decodeDownloadPath(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Tautan navigasi folder tidak valid. Ketik .download untuk membuka ulang.')
  }
  let decoded
  try {
    const buffer = Buffer.from(token, 'base64url')
    decoded = buffer.toString('utf8')
    if (buffer.toString('base64url') !== token) throw new Error('invalid base64url')
  } catch {
    throw new Error('Tautan navigasi folder tidak valid. Ketik .download untuk membuka ulang.')
  }
  if (!decoded || decoded.includes('\0')) throw new Error('Lokasi folder tidak valid.')
  return decoded
}

export async function getDownloadRoot(configuredRoot = process.env.ALVARETH_DOWNLOAD_DIR || './downloads') {
  const requestedRoot = path.resolve(String(configuredRoot || './downloads'))
  await fs.mkdir(requestedRoot, { recursive: true })
  return fs.realpath(requestedRoot)
}

export async function resolveDownloadPath(root, relativePath = '.') {
  const relative = String(relativePath || '.').replace(/\\/g, path.sep)
  if (path.isAbsolute(relative)) throw new Error('Akses di luar folder downloads tidak diizinkan.')
  const normalized = path.normalize(relative)
  if (normalized === '..' || normalized.startsWith('..' + path.sep)) {
    throw new Error('Akses di luar folder downloads tidak diizinkan.')
  }
  const absolute = path.resolve(root, normalized)
  if (!isInside(root, absolute)) throw new Error('Akses di luar folder downloads tidak diizinkan.')

  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    const info = await fs.lstat(current)
    if (info.isSymbolicLink()) throw new Error('Shortcut/symlink tidak dapat dibuka dari file manager.')
  }

  const realPath = await fs.realpath(absolute)
  if (!isInside(root, realPath)) throw new Error('Akses di luar folder downloads tidak diizinkan.')
  return realPath
}

export async function listDownloadEntries(root, relativePath = '.') {
  const directory = await resolveDownloadPath(root, relativePath)
  const directoryInfo = await fs.stat(directory)
  if (!directoryInfo.isDirectory()) throw new Error('Lokasi yang dipilih bukan folder.')

  const dirents = await fs.readdir(directory, { withFileTypes: true })
  const entries = []
  for (const dirent of dirents) {
    if (!dirent.name || dirent.name.startsWith('.') || dirent.isSymbolicLink()) continue
    if (!dirent.isDirectory() && !dirent.isFile()) continue
    const absolutePath = path.join(directory, dirent.name)
    try {
      const info = await fs.lstat(absolutePath)
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) continue
      const realPath = await fs.realpath(absolutePath)
      if (!isInside(root, realPath)) continue
      entries.push({
        name: dirent.name,
        type: info.isDirectory() ? 'directory' : 'file',
        size: info.isFile() ? info.size : 0,
        modifiedAt: info.mtime
      })
    } catch {
      // Ignore entries removed or changed while the directory is being read.
    }
    if (entries.length >= MAX_DIRECTORY_ENTRIES) break
  }

  entries.sort((a, b) =>
    (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) ||
    a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
  )
  return { directory, entries, truncated: dirents.length > entries.length && entries.length >= MAX_DIRECTORY_ENTRIES }
}

export function formatDownloadSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return size + ' B'
  if (size < 1024 ** 2) return (size / 1024).toFixed(1) + ' KB'
  if (size < 1024 ** 3) return (size / 1024 ** 2).toFixed(1) + ' MB'
  return (size / 1024 ** 3).toFixed(2) + ' GB'
}
