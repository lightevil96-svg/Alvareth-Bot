import path from 'node:path'
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
const MAX_CODE_BYTES = 256 * 1024
const MAX_FILES = 80
const MAX_FILE_BYTES = 96 * 1024

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
    '12. Gunakan dependency dari npm registry saja. Jangan sertakan script install, postinstall, shell script, file .env, node_modules, lockfile, atau binary.',
    '',
    'FORMAT OUTPUT WAJIB',
    'Keluarkan seluruh file proyek dalam satu jawaban. Jangan memberikan tutorial atau penjelasan di luar file.',
    'Setiap file harus diawali marker persis seperti ===FILE: package.json===, lalu isi file di dalam satu code fence. Ulangi untuk setiap file.',
    'Sertakan minimal package.json, motion.config.json, src/index.tsx, src/Root.tsx, dan file komponen yang diperlukan.',
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
    'Jika ide video belum saya berikan, balas hanya dengan satu pertanyaan singkat untuk meminta tema/cerita video. Setelah saya menjawab, langsung hasilkan seluruh kode sesuai format di atas tanpa menanyakan parameter teknis tambahan.'
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

export function parseMotionCode(input, options = {}) {
  const source = String(input ?? '').replace(/\r\n?/g, '\n')
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : MAX_CODE_BYTES
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0
    ? options.maxFiles
    : MAX_FILES

  const totalBytes = Buffer.byteLength(source, 'utf8')
  if (!source.trim()) throw new Error('Kode proyek masih kosong.')
  if (totalBytes > maxBytes) {
    throw new Error('Kode terlalu besar (' + totalBytes + ' byte). Batas satu pesan adalah ' + maxBytes + ' byte.')
  }

  const markerPattern = /^\s*(?:={3,}\s*)?(?:FILE|PATH)\s*:\s*(.*?)\s*(?:={3,})?\s*$/gim
  const markers = [...source.matchAll(markerPattern)]
  if (!markers.length) {
    throw new Error('Marker file tidak ditemukan. Gunakan format ===FILE: src/Root.tsx=== sebelum setiap kode file.')
  }
  if (markers.length > maxFiles) {
    throw new Error('Jumlah file terlalu banyak. Maksimal ' + maxFiles + ' file dalam satu pesan.')
  }

  const files = []
  const seen = new Set()
  let totalFileBytes = 0

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]
    const start = marker.index + marker[0].length
    const end = index + 1 < markers.length ? markers[index + 1].index : source.length
    const filePath = safeProjectPath(marker[1])
    const content = stripCodeFence(source.slice(start, end)).trimEnd()
    if (!content.trim()) throw new Error('Isi file ' + filePath + ' kosong.')
    if (content.includes('\0')) throw new Error('File ' + filePath + ' berisi byte NUL dan ditolak.')

    const fileBytes = Buffer.byteLength(content, 'utf8')
    if (fileBytes > MAX_FILE_BYTES) {
      throw new Error('File ' + filePath + ' melebihi batas ' + MAX_FILE_BYTES + ' byte.')
    }
    if (seen.has(filePath)) throw new Error('File duplikat ditemukan: ' + filePath)
    seen.add(filePath)
    totalFileBytes += fileBytes
    files.push({ path: filePath, content })
  }

  if (!seen.has('package.json')) throw new Error('package.json wajib disertakan.')
  if (!seen.has('motion.config.json')) throw new Error('motion.config.json wajib disertakan untuk naskah voiceover.')
  if (!files.some(file => /^src\/.+\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(file.path))) {
    throw new Error('File kode utama harus berada di folder src/.')
  }

  return { files, totalBytes, totalFileBytes }
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
