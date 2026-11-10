import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import archiver from 'archiver'
import { fileTypeFromBuffer } from 'file-type'
import { getQuotedMediaInfo, downloadQuotedMedia } from '../../lib/simple.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'
import {
  analyzeVideoFile,
  buildAnalysisReport,
  buildEditorialBrief,
  buildSrt,
  formatSrtTimestamp,
  probeVideoDuration
} from '../../lib/video-analysis.js'

const MAX_VIDEO_BYTES = Math.max(10 * 1024 * 1024,
  Number(process.env.ALVARETH_VIDEO_ANALYSIS_MAX_BYTES) || 250 * 1024 * 1024)
const MAX_OUTPUT_BYTES = Math.max(20 * 1024 * 1024,
  Number(process.env.ALVARETH_VIDEO_ANALYSIS_MAX_OUTPUT_BYTES) || 500 * 1024 * 1024)
const MAX_DURATION_SECONDS = Math.max(60,
  Number(process.env.ALVARETH_VIDEO_ANALYSIS_MAX_DURATION_SECONDS) || 1800)
const STALE_SESSION_MS = Math.max(60 * 60 * 1000,
  Number(process.env.ALVARETH_VIDEO_ANALYSIS_RETENTION_HOURS) * 60 * 60 * 1000 || 24 * 60 * 60 * 1000)
const sessions = global.__alvarethVideoAnalysisSessions ||
  (global.__alvarethVideoAnalysisSessions = new Map())

const MENU_ROWS = [
  ['full', '🎬 Analisis lengkap', 'Semua hasil analisis + paket ZIP'],
  ['transcript', '📝 Transkrip + subtitle', 'ASR, speaker, dan SRT draft'],
  ['speakers', '🎙️ Deteksi speaker', 'Pemisahan giliran bicara dan overlap'],
  ['characters', '👤 Identifikasi karakter', 'Deskripsi visual dan kandidat wajah'],
  ['summary', '📋 Ringkasan video', 'Konteks dan isi video'],
  ['highlights', '✨ Cari highlight', 'Hook, setup, payoff, dan timestamp'],
  ['scenes', '🎞️ Deteksi adegan', 'Scene breakdown berdasarkan waktu'],
  ['export', '📦 Export Skills-Clip', 'JSON, SRT, speaker map, dan brief'],
  ['status', 'ℹ️ Status analisis', 'Periksa progres job saat ini'],
  ['cancel', '🛑 Batalkan job', 'Hentikan analisis dan hapus source sementara']
]

function getRoot() {
  const configured = String(process.env.ALVARETH_VIDEO_ANALYSIS_TMPDIR || '').trim()
  const dataRoot = String(process.env.ALVARETH_DATA_DIR || path.join(homedir(), '.alvareth-bot-data'))
  return path.resolve(configured || path.join(dataRoot, 'video-analysis'))
}

function sessionKey(m) {
  if (!m?.chat || !m?.sender) return ''
  return String(m.chat) + ':' + String(m.sender)
}

function safeError(error) {
  return String(error?.message || error || 'Kesalahan tidak diketahui')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 700)
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1024 ** 3) return (value / (1024 * 1024)).toFixed(1) + ' MB'
  return (value / (1024 ** 3)).toFixed(2) + ' GB'
}

function safeVideoFileName(value, fallback) {
  const normalized = String(value || fallback || 'video.mp4').replace(/\\/g, '/')
  const base = path.basename(normalized)
    .replace(/[\r\n\u0000-\u001f<>:"|?*]/g, '_')
    .slice(0, 120)
  return base || fallback || 'video.mp4'
}

async function safeReply(m, text) {
  try {
    if (typeof m?.reply === 'function') return await m.reply(text)
    const conn = m?.conn || global.conn
    if (conn?.sendMessage && m?.chat) return await conn.sendMessage(m.chat, { text }, m.key ? { quoted: m } : {})
  } catch (error) {
    console.warn('[ANALISIS] Balasan WhatsApp gagal:', error?.message || error)
  }
  return null
}

async function ensureRoot() {
  const root = getRoot()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Folder analisis harus berupa direktori biasa, bukan symbolic link.')
  }
  const active = new Set([...sessions.values()].map(item => path.resolve(item.directory)))
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('alvareth-analysis-')) continue
    const candidate = path.join(root, entry.name)
    if (active.has(path.resolve(candidate))) continue
    try {
      const stat = await fs.lstat(candidate)
      if (stat.isDirectory() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > STALE_SESSION_MS) {
        await fs.rm(candidate, { recursive: true, force: true })
      }
    } catch {}
  }
  return root
}

async function showMenu(m, conn, usedPrefix, hasSession) {
  const prefix = usedPrefix || '.'
  const rows = MENU_ROWS.map(([action, title, description]) => ({
    title,
    description,
    rowId: prefix + 'analisis ' + action
  }))
  const intro = [
    '🎬 *ALVARETH VIDEO INTELLIGENCE*',
    '',
    hasSession
      ? 'Video sudah tersimpan sementara. Pilih fitur analisis di bawah.'
      : 'Belum ada video aktif. Reply/kutip sebuah video, lalu ketik .analisis untuk memuatnya.',
    '',
    'Fitur: transkrip, subtitle draft, speaker diarization, face tracking, karakter, scene, highlight, ringkasan, dan handoff Skills-Clip.',
    '',
    'Batas default: ' + formatBytes(MAX_VIDEO_BYTES) + ' dan ' + Math.round(MAX_DURATION_SECONDS / 60) + ' menit.',
    'Hasil ASR dan pencocokan karakter tetap perlu verifikasi manusia.'
  ].join('\n')

  try {
    await conn.sendMessage(m.chat, {
      text: intro,
      footer: global.namebot || 'Alvareth Bot',
      title: 'Pilih fitur analisis',
      buttonText: 'Buka fitur analisis',
      sections: [{ title: 'VIDEO ANALYSIS', rows }]
    }, { quoted: m })
  } catch (error) {
    console.warn('[ANALISIS] Menu interaktif gagal, memakai fallback teks:', error?.message || error)
    await safeReply(m, intro + '\n\n' + rows.map(row => row.title + ' — ' + row.rowId).join('\n'))
  }
}

function getVideoExtension(detected, mediaInfo) {
  const ext = String(detected?.ext || '').toLowerCase()
  if (['3gp', 'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv'].includes(ext)) return ext
  const fileName = String(mediaInfo?.media?.fileName || mediaInfo?.media?.file_name || '')
  const supplied = path.extname(fileName).replace(/^\./, '').toLowerCase()
  if (['3gp', 'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv'].includes(supplied)) return supplied
  const mime = String(mediaInfo?.mime || '').toLowerCase()
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('matroska')) return 'mkv'
  return 'mp4'
}

async function prepareVideoSession(m, conn) {
  const mediaInfo = getQuotedMediaInfo(m)
  const mediaType = String(mediaInfo?.type || '').toLowerCase()
  const mime = String(mediaInfo?.mime || mediaInfo?.media?.mimetype || '').toLowerCase()
  if (!mediaInfo || (!/^(?:video|ptv)message$/.test(mediaType) && !mime.startsWith('video/'))) {
    throw new Error('Reply/kutip video yang ingin dianalisis, lalu ketik .analisis.')
  }

  const declaredSize = Number(mediaInfo.media?.fileLength)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_VIDEO_BYTES) {
    throw new Error('Ukuran video ' + formatBytes(declaredSize) + ' melebihi batas ' + formatBytes(MAX_VIDEO_BYTES) + '.')
  }

  const buffer = await downloadQuotedMedia(m, conn)
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Video gagal diunduh dari WhatsApp.')
  if (buffer.length > MAX_VIDEO_BYTES) {
    throw new Error('Ukuran video ' + formatBytes(buffer.length) + ' melebihi batas ' + formatBytes(MAX_VIDEO_BYTES) + '.')
  }

  const detected = await fileTypeFromBuffer(buffer.subarray(0, Math.min(buffer.length, 8192))).catch(() => null)
  if (detected?.mime && !String(detected.mime).startsWith('video/')) {
    throw new Error('Isi file tidak dikenali sebagai video. Kirim ulang file video asli.')
  }

  const root = await ensureRoot()
  const directory = await fs.mkdtemp(path.join(root, 'alvareth-analysis-'))
  await fs.chmod(directory, 0o700).catch(() => {})
  const extension = getVideoExtension(detected, mediaInfo)
  const filePath = path.join(directory, 'source-video.' + extension)
  await fs.writeFile(filePath, buffer, { mode: 0o600, flag: 'wx' })
  const duration = await probeVideoDuration(filePath)
  if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) {
    await fs.rm(directory, { recursive: true, force: true })
    throw new Error('Durasi video ' + Math.ceil(duration / 60) + ' menit melebihi batas ' +
      Math.ceil(MAX_DURATION_SECONDS / 60) + ' menit.')
  }

  const key = sessionKey(m)
  const previous = sessions.get(key)
  if (previous?.processing) {
    await fs.rm(directory, { recursive: true, force: true })
    throw new Error('Analisis sebelumnya masih berjalan. Gunakan .analisis status atau .analisis cancel.')
  }
  if (previous?.directory) await fs.rm(previous.directory, { recursive: true, force: true }).catch(() => {})
  const session = {
    key,
    chat: m.chat,
    sender: m.sender,
    directory,
    filePath,
    fileName: safeVideoFileName(mediaInfo.media?.fileName, 'video.' + extension),
    mimeType: detected?.mime || mime || 'video/mp4',
    size: buffer.length,
    duration,
    createdAt: Date.now(),
    processing: false,
    status: 'Video siap dianalisis',
    controller: null,
    result: null,
    archivePath: null,
    artifacts: {}
  }
  sessions.set(key, session)
  return session
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}

async function writeArtifacts(session, result) {
  const files = {
    'analysis-result.json': result,
    'transcript.json': result.transcript,
    'speaker-map.json': result.speakerMap,
    'characters.json': result.analysis.characters,
    'highlights.json': result.analysis.highlights,
    'scenes.json': result.analysis.scenes
  }
  for (const [name, value] of Object.entries(files)) {
    const filePath = path.join(session.directory, name)
    await writeJson(filePath, value)
    session.artifacts[name] = filePath
  }

  const srtPath = path.join(session.directory, 'captions-draft.srt')
  const srt = buildSrt(result.transcript)
  await fs.writeFile(srtPath, srt || '# No timestamped transcript is available yet.\n', { mode: 0o600 })
  session.artifacts['captions-draft.srt'] = srtPath

  const reportPath = path.join(session.directory, 'analysis-report.md')
  await fs.writeFile(reportPath, buildAnalysisReport(result), { mode: 0o600 })
  session.artifacts['analysis-report.md'] = reportPath

  const briefPath = path.join(session.directory, 'skills-clip-editorial-brief.md')
  await fs.writeFile(briefPath, buildEditorialBrief(result), { mode: 0o600 })
  session.artifacts['skills-clip-editorial-brief.md'] = briefPath

  const manifestPath = path.join(session.directory, 'manifest.json')
  await writeJson(manifestPath, {
    format: 'alvareth-skills-clip-handoff',
    version: 1,
    source_file: result.source.file_name,
    source_sha256: result.source.sha256,
    source_included: false,
    transcript_verification: 'ASR_RAW',
    speaker_mapping: 'UNKNOWN_OR_CANDIDATE',
    artifacts: Object.keys(session.artifacts)
  })
  session.artifacts['manifest.json'] = manifestPath
  return { srt, reportPath, briefPath }
}

async function createArchive(session) {
  if (session.archivePath) {
    const stat = await fs.stat(session.archivePath).catch(() => null)
    if (stat?.isFile() && stat.size > 0) return session.archivePath
  }
  const archivePath = path.join(session.directory, 'skills-clip-analysis.zip')
  const output = createWriteStream(archivePath, { mode: 0o600 })
  const archive = archiver('zip', { zlib: { level: 6 } })
  const completed = new Promise((resolve, reject) => {
    output.once('close', resolve)
    output.once('error', reject)
    archive.once('error', reject)
  })
  archive.pipe(output)
  for (const [name, filePath] of Object.entries(session.artifacts)) {
    archive.file(filePath, { name })
  }
  await archive.finalize()
  await completed
  const stat = await fs.stat(archivePath)
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_OUTPUT_BYTES) {
    await fs.rm(archivePath, { force: true }).catch(() => {})
    throw new Error('Ukuran paket hasil tidak valid atau melebihi batas ' + formatBytes(MAX_OUTPUT_BYTES) + '.')
  }
  session.archivePath = archivePath
  return archivePath
}

async function sendArtifact(m, conn, filePath, caption, mimetype) {
  const socket = conn || m.conn || global.conn
  const delivery = await sendLocalFile(socket, m.chat, filePath, {
    jobId: 'analisis',
    mimetype: mimetype || 'application/octet-stream',
    fileName: path.basename(filePath),
    maxBytes: MAX_OUTPUT_BYTES,
    quoted: m,
    caption: caption || ''
  })
  console.log('[ANALISIS] File hasil terkirim:', {
    fileName: delivery.fileName,
    size: delivery.size,
    messageId: delivery.messageId
  })
  return delivery
}

function formatHighlights(analysis) {
  const items = Array.isArray(analysis?.highlights) ? analysis.highlights : []
  if (!items.length) return 'Belum ada kandidat highlight yang dapat dipastikan.'
  return items.slice(0, 12).map((item, index) =>
    (index + 1) + '. ' + formatSrtTimestamp(item.start) + '–' + formatSrtTimestamp(item.end) +
    '\n   Hook: ' + (item.hook || 'belum tersedia') +
    '\n   Setup: ' + (item.setup || 'belum tersedia') +
    '\n   Payoff: ' + (item.payoff || 'belum tersedia') +
    '\n   Confidence: ' + item.confidence
  ).join('\n')
}

function formatSpeakers(speakerMap) {
  const speakers = Array.isArray(speakerMap?.speakers) ? speakerMap.speakers : []
  if (!speakers.length) return 'Speaker belum berhasil dipisahkan. Konfigurasikan Cutroom sidecar untuk diarization.'
  return speakers.map(item =>
    '• ' + item.speaker_id + ' | ' + (item.display_name || 'unknown') +
    ' | mapping: ' + item.mapping_status +
    (item.mapping_evidence?.length ? '\n  Bukti: ' + item.mapping_evidence.join('; ') : '')
  ).join('\n')
}

function actionMessage(action, result) {
  const analysis = result.analysis || {}
  if (action === 'summary') {
    return '📋 *RINGKASAN VIDEO*\n\n' + (analysis.summary || 'Ringkasan belum tersedia.') +
      '\n\nAdegan terdeteksi: ' + (analysis.scenes?.length || 0) +
      '\nKandidat highlight: ' + (analysis.highlights?.length || 0)
  }
  if (action === 'highlights') return '✨ *KANDIDAT HIGHLIGHT*\n\n' + formatHighlights(analysis)
  if (action === 'speakers') {
    return '🎙️ *HASIL DETEKSI SPEAKER*\n\n' + formatSpeakers(result.speakerMap) +
      '\n\nSpeaker-to-face mapping tetap kandidat, bukan identitas terverifikasi.' +
      (result.engine.cutroom_used ? '' : '\n\nCatatan: Cutroom tidak aktif. Label speaker dari Gemini bersifat sementara dan bukan diarization khusus.')
  }
  if (action === 'characters') {
    const characters = analysis.characters || []
    return '👤 *KARAKTER YANG TERAMATI*\n\n' +
      (characters.length ? characters.map(item =>
        '• ' + item.character_id + ': ' + (item.description || 'deskripsi tidak tersedia') +
        '\n  Label terlihat: ' + (item.visible_label || 'tidak terbaca') +
        '\n  Status identitas: ' + item.mapping_status
      ).join('\n') : 'Karakter belum dapat diidentifikasi dari bukti visual yang tersedia.')
  }
  if (action === 'scenes') {
    const scenes = analysis.scenes || []
    return '🎞️ *SCENE BREAKDOWN*\n\n' +
      (scenes.length ? scenes.slice(0, 18).map((item, index) =>
        (index + 1) + '. ' + formatSrtTimestamp(item.start) + '–' + formatSrtTimestamp(item.end) +
        '\n   ' + item.description + '\n   Fokus: ' + (item.visual_focus || 'unknown')
      ).join('\n') : 'Scene belum tersedia.')
  }
  if (action === 'transcript') {
    const transcript = result.transcript
    return '📝 *TRANSKRIP & SUBTITLE DRAFT*\n\n' +
      'Word-level alignment: ' + (result.engine.transcript_word_aligned ? 'tersedia' : 'tidak tersedia') +
      '\nJumlah kata terukur: ' + (transcript.words?.length || 0) +
      '\nSegmen transkrip: ' + (transcript.segments?.length || 0) +
      '\nStatus: ASR_RAW, wajib diperiksa dengan audio sumber.'
  }
  return '🎬 *ANALISIS VIDEO SELESAI*\n\n' +
    (analysis.summary || 'Ringkasan belum tersedia.') +
    '\n\nAdegan: ' + (analysis.scenes?.length || 0) +
    '\nSpeaker: ' + (result.speakerMap?.speakers?.length || 0) +
    '\nKarakter: ' + (analysis.characters?.length || 0) +
    '\nHighlight: ' + (analysis.highlights?.length || 0) +
    '\nWord-level alignment: ' + (result.engine.transcript_word_aligned ? 'tersedia' : 'belum tersedia') +
    '\n\nGunakan .analisis export untuk mengirim semua artifact Skills-Clip.'
}

async function deliverAction(m, conn, session, action) {
  const result = session.result
  await safeReply(m, actionMessage(action, result))
  if (action === 'full' || action === 'export') {
    const archivePath = await createArchive(session)
    await sendArtifact(m, conn, archivePath,
      '📦 Skills-Clip analysis bundle. Source video tidak disertakan; transcript masih ASR_RAW.')
    return
  }
  if (action === 'transcript') {
    await sendArtifact(m, conn, session.artifacts['captions-draft.srt'],
      '📝 Subtitle SRT draft. Wajib verifikasi terhadap audio asli.', 'application/x-subrip')
    await sendArtifact(m, conn, session.artifacts['transcript.json'],
      'Transcript JSON untuk Skills-Clip. Semua kata tetap ASR_RAW.', 'application/json')
    return
  }
  if (action === 'speakers') {
    await sendArtifact(m, conn, session.artifacts['speaker-map.json'],
      'Speaker diarization dan kandidat face matching. Perlu konfirmasi manusia.', 'application/json')
    return
  }
  if (action === 'characters') {
    await sendArtifact(m, conn, session.artifacts['characters.json'],
      'Deskripsi karakter visual. Nama/identitas tidak ditebak.', 'application/json')
    return
  }
  if (action === 'highlights') {
    await sendArtifact(m, conn, session.artifacts['highlights.json'],
      'Kandidat highlight. Periksa setup dan payoff pada source video.', 'application/json')
    return
  }
  if (action === 'scenes') {
    await sendArtifact(m, conn, session.artifacts['scenes.json'],
      'Scene breakdown berdasarkan timestamp source.', 'application/json')
    return
  }
  if (action === 'summary') {
    await sendArtifact(m, conn, session.artifacts['analysis-report.md'],
      'Laporan ringkasan analisis video.', 'text/markdown')
  }
}

async function runAnalysisJob(m, conn, session, action) {
  try {
    session.status = 'Menjalankan analisis audiovisual'
    const result = await analyzeVideoFile({
      filePath: session.filePath,
      fileName: session.fileName,
      mimeType: session.mimeType,
      action,
      signal: session.controller.signal,
      onProgress: message => console.log('[ANALISIS] ' + message)
    })
    if (session.controller.signal.aborted) throw new Error('Analisis dibatalkan.')
    session.result = result
    await writeArtifacts(session, result)
    session.status = 'Analisis selesai'
    session.completedAt = Date.now()
    await deliverAction(m, conn, session, action)
  } catch (error) {
    session.status = session.controller?.signal?.aborted ? 'Analisis dibatalkan' : 'Analisis gagal'
    session.lastError = safeError(error)
    console.error('[ANALISIS] Job gagal:', error?.stack || error)
    await safeReply(m, (session.status === 'Analisis dibatalkan' ? '🛑 ' : '❌ ') +
      session.lastError + '\n\nSource sementara tetap disimpan sampai .analisis cancel atau masa retensi berakhir.')
  } finally {
    session.processing = false
    session.controller = null
  }
}

const handler = async (m, { conn, text, usedPrefix }) => {
  const key = sessionKey(m)
  if (!key) return safeReply(m, 'Identitas chat tidak terbaca. Coba ulangi perintah.')
  const parts = String(text || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const action = parts[0] || 'menu'
  let session = sessions.get(key)

  if (action === 'menu' || action === 'help') {
    if (!session && getQuotedMediaInfo(m)) {
      try {
        session = await prepareVideoSession(m, conn)
        await safeReply(m, '✅ Video diterima (' + formatBytes(session.size) + '). Menu analisis siap dibuka.')
      } catch (error) {
        await safeReply(m, '❌ ' + safeError(error))
      }
    }
    return showMenu(m, conn, usedPrefix, Boolean(session))
  }

  if (action === 'status') {
    if (!session) return safeReply(m, 'Tidak ada video aktif. Reply video dengan .analisis terlebih dahulu.')
    const elapsed = Math.max(0, Date.now() - (session.createdAt || Date.now()))
    return safeReply(m, [
      'ℹ️ *STATUS ANALISIS VIDEO*',
      'Status: ' + session.status,
      'File: ' + session.fileName,
      'Ukuran: ' + formatBytes(session.size),
      'Durasi: ' + (Number.isFinite(session.duration) ? session.duration.toFixed(2) + ' detik' : 'belum terbaca'),
      'Waktu sejak job dibuat: ' + Math.floor(elapsed / 1000) + ' detik',
      session.lastError ? 'Error terakhir: ' + session.lastError : '',
      session.result ? 'Artifact: ' + Object.keys(session.artifacts).length + ' file' : ''
    ].filter(Boolean).join('\n'))
  }

  if (action === 'cancel') {
    if (!session) return safeReply(m, 'Tidak ada sesi analisis aktif.')
    if (session.processing) {
      session.controller?.abort()
      session.status = 'Permintaan pembatalan diterima'
      return safeReply(m, '🛑 Pembatalan diminta. Worker akan berhenti dan membersihkan file sementara setelah request selesai.')
    }
    sessions.delete(key)
    await fs.rm(session.directory, { recursive: true, force: true }).catch(() => {})
    return safeReply(m, '🛑 Sesi analisis dan source sementara berhasil dibersihkan.')
  }

  if (action === 'send') {
    if (!session?.archivePath) return safeReply(m, 'Paket ZIP belum tersedia. Jalankan .analisis full atau .analisis export.')
    try {
      return await sendArtifact(m, conn, session.archivePath,
        '📦 Paket analisis Skills-Clip. Source video tidak disertakan.')
    } catch (error) {
      return safeReply(m, 'Pengiriman belum berhasil: ' + safeError(error) + '. File tetap tersimpan; coba .analisis send lagi.')
    }
  }

  const supported = new Set(['full', 'transcript', 'speakers', 'characters', 'summary', 'highlights', 'scenes', 'export'])
  if (!supported.has(action)) {
    return showMenu(m, conn, usedPrefix, Boolean(session))
  }
  if (!session) {
    return safeReply(m, 'Video belum dimuat. Reply/kutip video terlebih dahulu, lalu ketik .analisis untuk membuka menu.')
  }
  if (session.processing) {
    return safeReply(m, '⏳ Analisis masih berjalan. Gunakan .analisis status untuk memeriksa progres atau .analisis cancel untuk membatalkan.')
  }

  if (session.result) {
    try {
      return await deliverAction(m, conn, session, action)
    } catch (error) {
      return safeReply(m, 'Artifact siap tetapi pengiriman gagal: ' + safeError(error) + '. Gunakan .analisis send jika ZIP tersedia.')
    }
  }

  session.processing = true
  session.status = 'Analisis dimulai'
  session.controller = new AbortController()
  await safeReply(m, '⏳ Video masuk antrean analisis. Worker berjalan di background. Gunakan .analisis status untuk memeriksa progres.')
  void runAnalysisJob(m, conn, session, action)
}

handler.help = [
  'analisis',
  'analisis full',
  'analisis transcript',
  'analisis speakers',
  'analisis characters',
  'analisis summary',
  'analisis highlights',
  'analisis scenes',
  'analisis export',
  'analisis status',
  'analisis send',
  'analisis cancel'
]
handler.tags = ['owner']
handler.command = /^analisis$/i
handler.rowner = true
handler.private = true

export default handler
