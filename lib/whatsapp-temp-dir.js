import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

/**
 * Put Node.js/Baileys temporary media files on the bot's writable server
 * storage instead of Pterodactyl's small /tmp tmpfs mount.
 *
 * ALVARETH_WA_TMPDIR can point to another absolute writable directory.
 * By default, use <ALVARETH_DATA_DIR or ~/.alvareth-bot-data>/tmp.
 */
export function configureWhatsAppTempDir({
  env = process.env,
  homeDirectory = homedir(),
  log = console.log,
  warn = console.warn
} = {}) {
  const configuredDataDir = String(env.ALVARETH_DATA_DIR || '').trim()
  const dataDir = configuredDataDir
    ? path.resolve(configuredDataDir)
    : path.join(homeDirectory, '.alvareth-bot-data')
  const defaultTempDir = path.join(dataDir, 'tmp')
  const configuredTempDir = String(env.ALVARETH_WA_TMPDIR || '').trim()
  const candidates = [...new Set([
    configuredTempDir ? path.resolve(configuredTempDir) : null,
    defaultTempDir
  ].filter(Boolean))]

  const failures = []
  for (const directory of candidates) {
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      if (!fs.statSync(directory).isDirectory()) {
        throw new Error('Path bukan direktori.')
      }
      fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK)

      // Confirm the process can actually create files, not merely list the path.
      const probeDirectory = fs.mkdtempSync(path.join(directory, '.alvareth-write-check-'))
      fs.rmdirSync(probeDirectory)

      // Node's os.tmpdir() checks TMPDIR first on Linux. Baileys uses that
      // directory while encrypting outgoing media before it uploads.
      env.TMPDIR = directory
      const source = configuredTempDir && directory === path.resolve(configuredTempDir)
        ? 'ALVARETH_WA_TMPDIR'
        : 'direktori data bot'
      log?.('[WA-TMP] Direktori sementara Node/Baileys: ' + directory + ' (' + source + ').')
      return { path: directory, source }
    } catch (error) {
      const detail = directory + ': ' + (error?.message || error)
      failures.push(detail)
      if (
        configuredTempDir &&
        directory === path.resolve(configuredTempDir) &&
        directory !== defaultTempDir
      ) {
        warn?.('[WA-TMP] ALVARETH_WA_TMPDIR tidak dapat dipakai (' + detail + '); mencoba direktori data bot.')
      }
    }
  }

  warn?.(
    '[WA-TMP] Tidak dapat menyiapkan direktori sementara pada storage server. ' +
    failures.join(' | ') +
    '. TMPDIR sebelumnya dipertahankan.'
  )
  return null
}
