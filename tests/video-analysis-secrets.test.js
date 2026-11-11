import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  clearGeminiApiKey,
  getGeminiApiKey,
  getGeminiApiKeyFilePath,
  getGeminiApiKeyStatus,
  isValidGeminiApiKey,
  saveGeminiApiKey
} from '../lib/video-analysis-secrets.js'

test('stores Gemini API keys privately and falls back to the environment key', async () => {
  const originalDataDir = process.env.ALVARETH_DATA_DIR
  const originalEnvironmentKey = process.env.GEMINI_API_KEY
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alvareth-gemini-key-'))
  const localKey = 'AIzaSy' + 'L'.repeat(33)
  const environmentKey = 'AIzaSy' + 'E'.repeat(33)

  try {
    process.env.ALVARETH_DATA_DIR = temporaryRoot
    process.env.GEMINI_API_KEY = environmentKey

    assert.equal(isValidGeminiApiKey(localKey), true)
    assert.equal(isValidGeminiApiKey('short'), false)
    assert.equal(isValidGeminiApiKey('AIzaSy with spaces'), false)
    await assert.rejects(saveGeminiApiKey('not-a-valid-key'), /Format API key tidak valid/)

    const saved = await saveGeminiApiKey(localKey)
    assert.equal(saved.saved, true)
    assert.equal(await getGeminiApiKey(), localKey)
    assert.deepEqual(await getGeminiApiKeyStatus(), {
      configured: true,
      source: 'local',
      updatedAt: (await getGeminiApiKeyStatus()).updatedAt
    })

    const filePath = getGeminiApiKeyFilePath()
    const fileStat = await fs.stat(filePath)
    const directoryStat = await fs.stat(path.dirname(filePath))
    assert.equal(fileStat.mode & 0o777, 0o600)
    assert.equal(directoryStat.mode & 0o777, 0o700)
    assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).apiKey, localKey)

    assert.equal(await clearGeminiApiKey(), true)
    assert.equal(await getGeminiApiKey(), environmentKey)
    assert.equal((await getGeminiApiKeyStatus()).source, 'environment')
    assert.equal(await clearGeminiApiKey(), false)
  } finally {
    if (originalDataDir === undefined) delete process.env.ALVARETH_DATA_DIR
    else process.env.ALVARETH_DATA_DIR = originalDataDir
    if (originalEnvironmentKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalEnvironmentKey
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  }
})
