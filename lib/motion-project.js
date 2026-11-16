import path from 'node:path'
import JSZip from 'jszip'
import { TTS_VOICE_PROFILES } from './tts-config.js'

export const MOTION_STYLES = Object.freeze([
  {
    id: 'crayon-book',
    name: 'Crayon Picture Book',
    description: 'Ilustrasi buku cerita anak dengan tekstur krayon, garis tangan, dan warna ceria.',
    direction: 'Gunakan tekstur krayon yang terlihat, garis sedikit tidak rata seperti gambar tangan, bidang warna hangat, bentuk sederhana yang ekspresif, dan transisi lembut seperti halaman buku cerita.'
  },
  {
    id: 'watercolor',
    name: 'Watercolor Brush',
    description: 'Lukisan cat air dengan sapuan transparan dan perpaduan warna lembut.',
    direction: 'Gunakan sapuan cat air berlapis, tepi warna yang sedikit menyebar, tekstur kertas, palet harmonis, dan gerakan transisi seperti cat yang mengalir. Simulasikan semuanya secara prosedural dengan SVG, Canvas, atau CSS.'
  },
  {
    id: 'cel-anime-80s',
    name: '80s Cel Anime',
    description: 'Anime retro dengan cel shading, outline tegas, dan nuansa sinematik.',
    direction: 'Gunakan cel shading dua atau tiga tingkat, outline bersih, highlight dramatis, komposisi sinematik, warna retro 1980-an, dan gerakan karakter yang ekspresif.'
  },
  {
    id: 'pixel-rpg',
    name: '16-bit Pixel RPG',
    description: 'Animasi game RPG pixel art 16-bit dengan karakter dan lingkungan retro.',
    direction: 'Gunakan pixel art 16-bit dengan grid piksel konsisten, palet terbatas, sprite yang tajam, parallax sederhana, dan animasi frame-by-frame bergaya RPG klasik.'
  },
  {
    id: 'rubber-hose',
    name: '1930s Rubber Hose Cartoon',
    description: 'Kartun retro dengan gerakan lentur, ekspresi lucu, dan nuansa film klasik.',
    direction: 'Gunakan karakter dengan anggota tubuh lentur seperti selang karet, gerak squash-and-stretch, ekspresi komedi, bentuk siluet kuat, serta nuansa kartun hitam-putih atau warna vintage.'
  },
  {
    id: 'whiteboard',
    name: 'Whiteboard Explainer',
    description: 'Animasi penjelasan seperti ilustrasi yang digambar langsung di papan putih.',
    direction: 'Bangun adegan seolah tangan sedang menggambar di papan putih: garis muncul bertahap, panah dan label ditulis, ilustrasi sederhana saling terhubung, serta kamera bergerak mengikuti alur penjelasan.'
  },
  {
    id: 'paper-popup',
    name: 'Paper Pop-up Book',
    description: 'Dunia buku kertas tiga dimensi dengan lapisan yang terbuka dan bergerak.',
    direction: 'Gunakan lapisan kertas bertingkat, lipatan, bayangan lembut, parallax, dan gerakan seperti halaman buku pop-up yang terbuka. Semua objek dibuat dari bentuk vektor dan geometri.'
  },
  {
    id: 'lowpoly-isometric',
    name: 'Low-poly Isometric',
    description: 'Diorama 3D low-poly dengan sudut pandang isometrik dan warna pastel.',
    direction: 'Gunakan geometri low-poly, sudut kamera isometrik, bidang-bidang geometris, pencahayaan sederhana, bayangan halus, dan gerakan kamera yang tenang.'
  },
  {
    id: 'swiss-motion',
    name: 'Swiss Motion Graphics',
    description: 'Tipografi modern, grid presisi, komposisi editorial, dan gerakan minimalis.',
    direction: 'Gunakan grid Swiss yang presisi, tipografi sans-serif tegas, hierarki informasi jelas, komposisi asimetris yang seimbang, bentuk geometris, dan transisi motion graphic yang bersih.'
  },
  {
    id: 'chalkboard',
    name: 'Chalkboard',
    description: 'Animasi papan tulis kapur dengan garis berdebu dan tulisan tangan.',
    direction: 'Gunakan latar papan tulis gelap, garis kapur dengan tekstur berdebu, tulisan tangan yang muncul bertahap, diagram sederhana, dan animasi penghapusan kapur yang halus.'
  },
])

const STYLE_BY_ID = new Map(MOTION_STYLES.map(style => [style.id, style]))
const ALLOWED_EXTENSIONS = new Set([
  '.json', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.css', '.scss', '.sass', '.txt', '.md', '.html', '.svg',
  '.yml', '.yaml'
])
const BLOCKED_NAMES = new Set([
  '.env', '.npmrc', 'npm-shrinkwrap.json', 'package-lock.json'
])
const BLOCKED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'out', 'dist', 'coverage', '.cache'
])
const MAX_ZIP_BYTES = 25 * 1024 * 1024
const MAX_ZIP_ENTRIES = 120
const MAX_ZIP_FILES = 80
const MAX_ZIP_FILE_BYTES = 1024 * 1024
const MAX_ZIP_TOTAL_BYTES = 10 * 1024 * 1024

export function getMotionStyle(styleId) {
  return STYLE_BY_ID.get(String(styleId || '').trim()) || null
}

export function buildMotionPrompt(styleId) {
  const style = getMotionStyle(styleId)
  if (!style) throw new Error('Gaya animasi .motion tidak dikenal.')

  const lines = [
    'Kamu adalah creative director, motion designer, animator, dan engineer Remotion profesional.',
    'Buat satu proyek video animasi lengkap berdasarkan ide/brief yang akan saya berikan setelah prompt ini.',
    '',
    'GAYA ANIMASI YANG WAJIB DIPAKAI',
    style.name + ' — ' + style.description,
    style.direction,
    'Pertahankan gaya ini secara konsisten pada seluruh adegan, karakter, warna, tipografi, dan transisi.',
    '',
    'ATURAN PRODUKSI',
    '1. Buat proyek Remotion mandiri yang siap dirender dengan Node.js 20+ dan Remotion 4.0.534.',
    '2. Semua visual wajib dibuat dari kode: React, SVG, Canvas, CSS, path, shape, tekstur prosedural, dan animasi. Jangan meminta atau memakai gambar, foto, video, font, audio, atau aset upload dari pengguna.',
    '3. Jangan memakai URL aset eksternal, image generator, API pembuat gambar/video, atau mengunduh aset dari internet.',
    '4. Buat karakter, latar, properti, ekspresi, gerakan kamera, transisi, dan efek visual secara prosedural. Jangan mengganti animasi dengan slideshow gambar diam.',
    '5. Tulis naskah voiceover yang utuh dan natural dalam Bahasa Indonesia di motion.config.json. Buat narasi yang sesuai dengan ide video dan alur adegannya.',
    '6. Bot akan membuat file public/voiceover.mp3 dari voiceoverText menggunakan TTS. File audio ini tidak perlu kamu buat atau sertakan.',
    '7. Durasi video WAJIB mengikuti durasi audio voiceover, bukan angka durasi yang ditentukan manual. Gunakan calculateMetadata pada Composition dan getAudioDuration dari @remotion/media-utils untuk menghitung durationInFrames berdasarkan public/voiceover.mp3.',
    '8. Putar voiceover dengan komponen Audio dari Remotion menggunakan staticFile("voiceover.mp3"). Pastikan seluruh adegan, subtitle, dan transisi selesai selaras dengan narasi.',
    '9. Gunakan fps 30 dan komposisi vertikal 1080x1920 (9:16). Jangan menambahkan pilihan pengaturan durasi atau kualitas.',
    '10. Tambahkan subtitle Bahasa Indonesia yang sinkron dengan voiceover, kecuali jika ide video secara eksplisit tidak memerlukan subtitle.',
    '11. Pastikan kode lengkap, konsisten, tidak ada placeholder, import hilang, atau fungsi yang belum diimplementasikan.',
    '12. Gunakan dependency dari npm registry saja. Jangan sertakan script install, postinstall, shell script, file .env, node_modules, lockfile, binary, atau aset gambar/audio/video.',
    '13. Semua file proyek harus berupa source code atau teks UTF-8. Jangan memakai aset eksternal; seluruh visual dibuat secara prosedural dari kode.',
    '',
    'FORMAT OUTPUT WAJIB — FILE ZIP',
    'Jangan menampilkan source code, code fence, atau isi file proyek di chat.',
    'Buat satu arsip ZIP yang benar-benar dapat diunduh sebagai lampiran bernama alvareth-motion-project.zip.',
    'Gunakan fitur pembuatan file yang tersedia (misalnya Python/Code Interpreter dan modul zipfile) untuk membuat ZIP berisi seluruh proyek Remotion.',
    'Letakkan package.json dan motion.config.json langsung di root ZIP, lalu sertakan folder src/ dan seluruh file source yang diperlukan. Jangan bungkus proyek dalam folder induk tambahan.',
    'ZIP hanya boleh berisi file teks/source yang diperlukan. Jangan sertakan node_modules, .git, out, dist, coverage, .cache, .env, .npmrc, package-lock.json, npm-shrinkwrap.json, binary, atau aset media.',
    'Setelah ZIP selesai dibuat, lampirkan file ZIP yang dapat diunduh. Balasan chat cukup berisi lampiran ZIP dan satu kalimat singkat bahwa file siap dikirim ke bot.',
    'Jangan mengaku ZIP berhasil dibuat jika file ZIP tidak benar-benar tersedia. Jika fitur pembuatan file tidak tersedia, jelaskan singkat bahwa ZIP belum dapat dibuat dan jangan mengganti hasilnya dengan menempelkan semua kode di chat.',
    'Sertakan minimal package.json, motion.config.json, src/index.tsx, src/Root.tsx, dan file komponen yang diperlukan di dalam ZIP.',
    '',
    'ISI motion.config.json WAJIB memiliki struktur:',
    '{',
    '  "title": "Judul video",',
    '  "voiceoverText": "Naskah narasi lengkap dalam Bahasa Indonesia",',
    '  "voiceProfile": "female"',
    '}',
    'voiceProfile yang valid: ' + Object.keys(TTS_VOICE_PROFILES).join(', ') + '.',
    '',
    'KONFIGURASI REMOTION',
    'package.json harus mencantumkan remotion, @remotion/cli, @remotion/media-utils, react, dan react-dom dengan versi 4.0.534 untuk paket Remotion.',
    'Tambahkan konfigurasi alvarethRemotion di package.json dengan entryPoint "src/index.tsx" dan compositionId "MotionVideo".',
    'Composition wajib memiliki calculateMetadata yang membaca durasi public/voiceover.mp3 melalui getAudioDuration(staticFile("voiceover.mp3")).',
    'Pastikan komponen utama merender <Audio src={staticFile("voiceover.mp3")} />.',
    '',
    'Jika ide video belum saya berikan, balas hanya dengan satu pertanyaan singkat untuk meminta tema/cerita video. Setelah saya menjawab, langsung buat proyek lengkap, kemas sebagai ZIP yang dapat diunduh, dan jangan menampilkan kode sumber di chat.'
  ]

  return lines.join('\n')
}

function safeProjectPath(input) {
  const raw = String(input || '').trim()
  if (!raw || raw.includes('\0') || raw.includes('\\') ||
      path.posix.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('Path file proyek tidak aman: ' + raw.slice(0, 100))
  }

  const normalized = raw.replace(/^\.\/+/, '')
  const segments = normalized.split('/')
  if (!normalized || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Path file proyek tidak boleh keluar dari folder proyek: ' + raw.slice(0, 100))
  }

  const lowerSegments = segments.map(segment => segment.toLowerCase())
  if (lowerSegments.some(segment => BLOCKED_DIRECTORIES.has(segment))) {
    throw new Error('Folder terlarang tidak boleh disertakan: ' + raw.slice(0, 100))
  }

  const baseName = lowerSegments[lowerSegments.length - 1]
  if (BLOCKED_NAMES.has(baseName) || baseName.startsWith('.env.')) {
    throw new Error('File konfigurasi privat atau lockfile tidak boleh disertakan: ' + raw.slice(0, 100))
  }

  const extension = path.posix.extname(normalized).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('File harus berupa kode atau teks. Aset/binary tidak didukung: ' + raw.slice(0, 100))
  }

  return normalized
}

function stripCodeFence(value) {
  const source = String(value || '').trim()
  const match = source.match(/^\x60{3,}[^\n]*\n([\s\S]*?)\n\x60{3,}\s*$/)
  return match ? match[1].replace(/\r\n?/g, '\n') : source.replace(/\r\n?/g, '\n')
}

function safeZipDirectoryPath(input) {
  const raw = String(input || '').trim()
  if (!raw || raw.includes('\0') || raw.includes('\\') ||
      path.posix.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('Path folder di ZIP tidak aman: ' + raw.slice(0, 100))
  }

  const normalized = raw.replace(/^\.\/+/, '').replace(/\/+$/, '')
  const segments = normalized.split('/')
  if (!normalized || segments.length > 16 ||
      segments.some(segment => !segment || segment === '.' || segment === '..' || segment.length > 180)) {
    throw new Error('Path folder di ZIP tidak valid atau terlalu dalam: ' + raw.slice(0, 100))
  }
  if (segments.some(segment => BLOCKED_DIRECTORIES.has(segment.toLowerCase()))) {
    throw new Error('ZIP tidak boleh menyertakan folder hasil generate atau dependency: ' + raw.slice(0, 100))
  }
  return segments.join('/')
}

function getZipEntryMode(entry) {
  const value = entry?.unixPermissions
  if (value === null || value === undefined) return 0
  if (typeof value === 'string' && /^[0-7]{3,6}$/.test(value)) return Number.parseInt(value, 8)
  const mode = Number(value)
  return Number.isFinite(mode) ? mode : 0
}

export async function parseMotionZip(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
  const maxArchiveBytes = Number.isSafeInteger(options.maxArchiveBytes) && options.maxArchiveBytes > 0
    ? options.maxArchiveBytes
    : MAX_ZIP_BYTES
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0
    ? options.maxFiles
    : MAX_ZIP_FILES
  const maxFileBytes = Number.isSafeInteger(options.maxFileBytes) && options.maxFileBytes > 0
    ? options.maxFileBytes
    : MAX_ZIP_FILE_BYTES
  const maxTotalBytes = Number.isSafeInteger(options.maxTotalBytes) && options.maxTotalBytes > 0
    ? options.maxTotalBytes
    : MAX_ZIP_TOTAL_BYTES
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : MAX_ZIP_ENTRIES

  if (!buffer.length) throw new Error('File ZIP kosong.')
  if (buffer.length > maxArchiveBytes) {
    throw new Error('Ukuran ZIP ' + buffer.length + ' byte melebihi batas ' + maxArchiveBytes + ' byte.')
  }

  const hasZipSignature = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
     (buffer[2] === 0x05 && buffer[3] === 0x06) ||
     (buffer[2] === 0x07 && buffer[3] === 0x08))
  if (!hasZipSignature) throw new Error('File yang dikirim bukan arsip ZIP yang valid.')

  let archive
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: false })
  } catch (error) {
    throw new Error('Arsip ZIP tidak dapat dibuka: ' + String(error?.message || error).slice(0, 180))
  }

  const entries = Object.values(archive.files)
  if (!entries.length) throw new Error('Arsip ZIP tidak berisi file proyek.')
  if (entries.length > maxEntries) {
    throw new Error('ZIP memiliki terlalu banyak entri. Maksimal ' + maxEntries + ' entri.')
  }

  const files = []
  const seen = new Set()
  let totalFileBytes = 0

  for (const entry of entries) {
    const originalName = typeof entry.unsafeOriginalName === 'string'
      ? entry.unsafeOriginalName
      : entry.name
    if (originalName !== entry.name) {
      throw new Error('ZIP berisi path yang telah dinormalisasi dan berpotensi keluar dari folder proyek.')
    }

    const isDirectory = Boolean(entry.dir || originalName.endsWith('/'))
    const rawPath = isDirectory ? originalName.replace(/\/+$/, '') : originalName
    if (!rawPath) continue

    const filePath = isDirectory
      ? safeZipDirectoryPath(rawPath)
      : safeProjectPath(rawPath)

    const mode = getZipEntryMode(entry)
    const fileType = mode & 0o170000
    if (fileType === 0o120000) {
      throw new Error('ZIP tidak boleh berisi symbolic link: ' + filePath)
    }
    if (fileType && fileType !== (isDirectory ? 0o040000 : 0o100000)) {
      throw new Error('ZIP berisi file khusus yang tidak didukung: ' + filePath)
    }
    if (isDirectory) continue

    if (files.length >= maxFiles) {
      throw new Error('ZIP memiliki terlalu banyak file. Maksimal ' + maxFiles + ' file source.')
    }

    const normalizedKey = filePath.toLowerCase()
    if (seen.has(normalizedKey)) throw new Error('ZIP berisi path file duplikat: ' + filePath)
    seen.add(normalizedKey)

    const declaredSize = Number(entry._data?.uncompressedSize)
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
      throw new Error('Ukuran file ZIP tidak valid: ' + filePath)
    }
    if (declaredSize > maxFileBytes) {
      throw new Error('File ' + filePath + ' melebihi batas ' + maxFileBytes + ' byte.')
    }
    totalFileBytes += declaredSize
    if (totalFileBytes > maxTotalBytes) {
      throw new Error('Total isi ZIP melebihi batas ' + maxTotalBytes + ' byte.')
    }

    let fileBuffer
    try {
      fileBuffer = await entry.async('nodebuffer')
    } catch (error) {
      throw new Error('Gagal mengekstrak ' + filePath + ': ' + String(error?.message || error).slice(0, 160))
    }
    if (fileBuffer.length !== declaredSize) {
      throw new Error('Ukuran hasil ekstraksi tidak cocok untuk file ' + filePath + '.')
    }
    if (fileBuffer.includes(0)) {
      throw new Error('File ' + filePath + ' bukan file teks/source yang didukung.')
    }

    let fileContent
    try {
      fileContent = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer)
    } catch {
      throw new Error('File ' + filePath + ' harus menggunakan encoding UTF-8.')
    }
    if (!fileContent.trim()) throw new Error('File proyek ' + filePath + ' kosong.')
    files.push({ path: filePath, content: fileContent.replace(/\r\n?/g, '\n') })
  }

  if (!files.length) throw new Error('ZIP tidak berisi file source yang dapat diproses.')

  const packageCandidates = []
  for (const file of files.filter(item => path.posix.basename(item.path).toLowerCase() === 'package.json')) {
    let packageJson
    try {
      packageJson = JSON.parse(file.content)
    } catch (error) {
      throw new Error('package.json tidak valid: ' + String(error?.message || error).slice(0, 160))
    }
    const dependencies = {
      ...(packageJson.dependencies && typeof packageJson.dependencies === 'object' ? packageJson.dependencies : {}),
      ...(packageJson.devDependencies && typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies : {}),
      ...(packageJson.optionalDependencies && typeof packageJson.optionalDependencies === 'object' ? packageJson.optionalDependencies : {})
    }
    if (dependencies.remotion || dependencies['@remotion/cli']) {
      packageCandidates.push(path.posix.dirname(file.path))
    }
  }

  if (!packageCandidates.length) {
    throw new Error('ZIP tidak berisi package.json proyek Remotion. Pastikan dependency remotion dan @remotion/cli tersedia.')
  }
  if (packageCandidates.length > 1) {
    throw new Error('ZIP berisi lebih dari satu proyek Remotion. Kirim satu proyek mandiri.')
  }

  const projectRoot = packageCandidates[0] === '.' ? '' : packageCandidates[0]
  const configPath = projectRoot ? projectRoot + '/motion.config.json' : 'motion.config.json'
  if (!seen.has(configPath.toLowerCase())) {
    throw new Error('motion.config.json wajib berada di folder yang sama dengan package.json.')
  }
  const sourcePrefix = projectRoot ? projectRoot + '/src/' : 'src/'
  if (!files.some(file => file.path.startsWith(sourcePrefix) && /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(file.path))) {
    throw new Error('ZIP wajib menyertakan file kode utama di folder src/.')
  }

  return {
    files,
    totalBytes: buffer.length,
    totalFileBytes,
    fileCount: files.length,
    projectRoot
  }
}

export function parseMotionConfig(value) {
  let config
  try {
    config = typeof value === 'string' ? JSON.parse(value) : value
  } catch (error) {
    throw new Error('motion.config.json tidak valid: ' + String(error?.message || error).slice(0, 180))
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('motion.config.json harus berupa objek JSON.')
  }

  const voiceoverText = String(config.voiceoverText || '').trim()
  if (!voiceoverText) throw new Error('motion.config.json belum memiliki voiceoverText.')
  if (Array.from(voiceoverText).length > 5000) {
    throw new Error('Naskah voiceover maksimal 5.000 karakter.')
  }

  const voiceProfile = String(config.voiceProfile || 'female').trim()
  if (!Object.prototype.hasOwnProperty.call(TTS_VOICE_PROFILES, voiceProfile)) {
    throw new Error('voiceProfile tidak dikenal. Pilihan: ' + Object.keys(TTS_VOICE_PROFILES).join(', '))
  }

  return {
    title: String(config.title || 'Alvareth Motion').trim().slice(0, 120),
    voiceoverText,
    voiceProfile
  }
}

export function validateMotionVoiceoverImplementation(files) {
  const source = files
    .filter(file => /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(file.path))
    .map(file => file.content)
    .join('\n')

  const checks = [
    [/@remotion\/media-utils/, 'import @remotion/media-utils'],
    [/\bgetAudioDuration\s*\(/, 'getAudioDuration()'],
    [/\bcalculateMetadata\s*=/, 'calculateMetadata pada Composition'],
    [/staticFile\s*\(\s*['"]voiceover\.mp3['"]\s*\)/, 'staticFile("voiceover.mp3")'],
    [/<Audio\b/, 'komponen Audio untuk memutar voiceover']
  ]

  const missing = checks.filter(([pattern]) => !pattern.test(source)).map(([, label]) => label)
  if (missing.length) {
    throw new Error('Kode belum menyinkronkan video dengan voiceover. Lengkapi: ' + missing.join(', ') + '.')
  }
}
