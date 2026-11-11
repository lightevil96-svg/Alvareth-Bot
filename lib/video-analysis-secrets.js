import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const SECRET_FILE = 'gemini-api-key.json'

export function isValidGeminiApiKey(value) {
  const key = String(value || '').trim()
  return key.length >= 20 && key.length <= 256 && /^[A-Za-z0-9_-]+$/.test(key)
}

function getDataRoot() {
  const configured = String(process.env.ALVARETH_DATA_DIR || '').trim()
  return path.resolve(configured || path.join(homedir(), '.alvareth-bot-data'))
}

export function getGeminiApiKeyFilePath() {
  return path.join(getDataRoot(), 'video-analysis', SECRET_FILE)
}

async function ensurePrivateDirectory() {
  const directory = path.dirname(getGeminiApiKeyFilePath())
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Folder penyimpanan API key harus berupa direktori biasa.')
  }
  await fs.chmod(directory, 0o700)
  return directory
}

async function readStoredKey() {
  try {
    const filePath = getGeminiApiKeyFilePath()
    const stat = await fs.lstat(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
    const key = String(parsed?.apiKey || '').trim()
    if (!isValidGeminiApiKey(key)) return null
    return { apiKey: key, updatedAt: Number(parsed.updatedAt) || null }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[ANALISIS] File API key lokal tidak dapat dibaca:', error?.code || 'read-error')
    }
    return null
  }
}

export async function saveGeminiApiKey(value) {
  const apiKey = String(value || '').trim()
  if (!isValidGeminiApiKey(apiKey)) {
    throw new Error('Format API key tidak valid. Pastikan kamu menyalin API key Gemini secara utuh tanpa spasi.')
  }

  const directory = await ensurePrivateDirectory()
  const filePath = getGeminiApiKeyFilePath()
  const temporaryPath = path.join(directory, '.gemini-api-key-' + randomUUID() + '.tmp')
  const handle = await fs.open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify({
      version: 1,
      apiKey,
      updatedAt: Date.now()
    }) + '\n', 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await fs.rename(temporaryPath, filePath)
    await fs.chmod(filePath, 0o600)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
  return { saved: true, filePath }
}

export async function getGeminiApiKey() {
  const stored = await readStoredKey()
  if (stored?.apiKey) return stored.apiKey

  const environmentKey = String(process.env.GEMINI_API_KEY || '').trim()
  return isValidGeminiApiKey(environmentKey) ? environmentKey : ''
}

export async function getGeminiApiKeyStatus() {
  const stored = await readStoredKey()
  if (stored?.apiKey) {
    return { configured: true, source: 'local', updatedAt: stored.updatedAt }
  }
  const environmentKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (isValidGeminiApiKey(environmentKey)) {
    return { configured: true, source: 'environment', updatedAt: null }
  }
  return { configured: false, source: 'none', updatedAt: null }
}

export async function clearGeminiApiKey() {
  try {
    await fs.unlink(getGeminiApiKeyFilePath())
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}
