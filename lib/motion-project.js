import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
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

  {
    id: 'cinematic-illustrated',
    name: 'Cinematic 2.5D Explainer',
    description: 'Ilustrasi vektor berlapis, warna navy-emas, cahaya sunset, parallax, dan storytelling sinematik.',
    direction: 'Gunakan ilustrasi vektor berlapis dengan kedalaman 2.5D dan parallax lembut. Pakai palet deep navy, amber gold, burnt orange sunset, muted plum, dan soft cream. Terapkan warm sunset key light, golden rim light, atmospheric glow, volumetric rays, serta partikel halus. Gunakan foreground dan background berlapis, push-in lambat, dan komposisi edukatif sinematik dengan satu subjek utama yang jelas serta ruang teks yang terbaca.'
  },
  {
    id: '3d-glass',
    name: 'Premium 3D Glass',
    description: 'Objek 3D transparan seperti kaca, refleksi lembut, dan pencahayaan studio premium.',
    direction: 'Bangun motion graphics 3D prosedural dengan objek kaca translucent, tepi polished, refleksi terkontrol, dan kedalaman sinematik. Gunakan midnight navy, cool cyan, pale blue highlights, dan silver. Terapkan soft three-point studio lighting, cyan rim light, gentle bloom, slow orbit, dan precise push-in. Setiap adegan memiliki satu hero object dominan, ruang negatif untuk teks, serta material dan pencahayaan yang konsisten.'
  },
  {
    id: 'kinetic-bold',
    name: 'Bold Kinetic Typography',
    description: 'Tipografi besar, animasi kata dinamis, kontras tinggi, dan transisi cepat.',
    direction: 'Utamakan kinetic typography dan motion graphics editorial modern dengan headline besar yang mudah dibaca. Gunakan near-black navy, electric yellow, putih, dan aksen violet. Terapkan high contrast, crisp highlights, subtle glow, serta grain tipis. Animasikan kata secara berurutan dengan scale-in, slide, reveal, push-in cepat tetapi tetap terbaca, dan transisi flash, wipe, glitch, atau zoom. Batasi satu headline pendek per adegan dan jaga teks pendukung tetap ringkas.'
  },
  {
    id: 'clean-editorial',
    name: 'Clean Editorial',
    description: 'Tampilan minimal, terang, rapi, tipografi editorial, dan gerakan halus.',
    direction: 'Gunakan desain editorial minimalis dengan tipografi sans-serif refined, whitespace luas, dan hierarki informasi yang jelas. Pakai warm ivory, slate navy, muted blue-gray, serta aksen warna yang terkendali. Terapkan pencahayaan lembut merata, bayangan halus, permukaan matte, grain tipis, garis bersih, dan ornamen minimal. Gunakan kamera stabil, drift perlahan, fade dan dissolve lembut. Pastikan headline singkat, rata, rapi, dan hanya elemen visual penting yang ditampilkan.'
  },
  {
    id: 'real-3d',
    name: 'Real 3D Animation (Three.js)',
    description: 'Animasi 3D sungguhan dengan geometri mesh, kamera perspektif, material, lighting, bayangan, dan pergerakan kamera sinematik.',
    direction: 'Bangun setiap adegan utama sebagai scene 3D sungguhan menggunakan Three.js melalui React Three Fiber dan ThreeCanvas dari @remotion/three. Seluruh objek harus berupa mesh dan geometri 3D nyata (BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry, ExtrudeGeometry, BufferGeometry, atau geometri prosedural), ditempatkan dalam koordinat X/Y/Z. Gunakan PerspectiveCamera dengan focal length/FOV sinematik, camera movement dolly/orbit/tracking yang dihitung dari frame Remotion, material MeshStandardMaterial atau MeshPhysicalMaterial, ambient/key/fill/rim lights, castShadow/receiveShadow, ambient occlusion palsu yang dibuat dengan geometri atau bayangan, serta depth dan parallax perspektif. Buat karakter, kendaraan, bangunan, ruangan, alam, properti, dan efek dari geometri prosedural; bentuk siluet, proporsi, artikulasi sendi, dan ekspresi harus konsisten antar adegan. Gunakan animasi transformasi 3D yang deterministik berdasarkan useCurrentFrame(), interpolate(), dan spring() dari Remotion. Jangan memakai CSS perspective/rotate3d, SVG extrude palsu, gambar datar, atau hanya objek kaca berputar sebagai pengganti scene 3D. Overlay teks/subtitle boleh memakai DOM di luar ThreeCanvas, tetapi objek visual utama wajib dirender oleh WebGL. Jangan memakai model GLB/GLTF, tekstur eksternal, HDRI, atau aset unduhan; semua model dan material dibuat dari kode.'
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
    'ZIP hanya boleh berisi file teks/source yang diperlukan. Jangan sertakan node_modules, .git, out, dist, coverage, .cache, .env, .npmrc, package-lock.json, npm-shrinkwrap.json, file placeholder kosong .gitkeep/.keep, binary, atau aset media.',
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

  if (style.id === 'real-3d') {
    lines.splice(
      lines.indexOf('ATURAN PRODUKSI'),
      0,
      'MESIN 3D WAJIB — THREE.JS SUNGGUHAN',
      'Gunakan @remotion/three, @react-three/fiber, three, dan @types/three. Jangan mengganti mesin 3D dengan SVG, CSS 3D transform, Canvas 2D, gambar, atau ilusi perspektif.',
      'Versi dependency yang kompatibel: remotion, @remotion/cli, @remotion/three = 4.0.534; react dan react-dom = 18.3.1; @react-three/fiber = 8.17.10; three dan @types/three = 0.170.0; @remotion/media-utils = 4.0.534.',
      'Render scene dengan komponen ThreeCanvas dari @remotion/three, bukan Canvas biasa. Ambil width dan height dari useVideoConfig() dan berikan keduanya sebagai props wajib ThreeCanvas.',
      'Animasi scene wajib deterministik dan seekable: gunakan useCurrentFrame(), useVideoConfig(), interpolate(), spring(), dan Easing dari Remotion. Jangan memakai useFrame(), requestAnimationFrame(), setInterval(), Date.now(), atau animasi yang bergantung pada waktu nyata.',
      'Semua gerak mesh, group, kamera, lampu, material, partikel, dan properti harus dihitung langsung dari frame aktif agar setiap frame dapat dirender ulang secara acak oleh Remotion.',
      'Buat beberapa scene 3D berbeda yang mengikuti urutan narasi. Sertakan objek dengan volume nyata, foreground/midground/background, perspektif kamera, depth, bayangan, dan pencahayaan tiga titik. Jangan membuat seluruh video hanya satu kubus atau bola berputar.',
      'Tambahkan teks, judul, dan subtitle sebagai overlay DOM terpisah di luar ThreeCanvas agar tajam dan mudah dibaca. Sinkronkan semuanya dengan frame dan voiceover.',
      'Jangan gunakan model, tekstur, HDRI, font, atau aset eksternal. Buat semua model dari geometri Three.js prosedural. Pastikan geometri tidak terlalu berat dan gunakan reuse geometry/material untuk menjaga konsumsi RAM.',
      'Konfigurasi alvarethRemotion di package.json boleh menambahkan "webglRenderer": "swangle". Bot akan memilih backend WebGL yang aman untuk server tanpa GPU; jangan menghapus konfigurasi ini.'
    )
  }

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
  if (!normalized || segments.length > 16 ||
      segments.some(segment => !segment || segment === '.' || segment === '..' || segment.length > 180)) {
    throw new Error('Path file proyek tidak boleh keluar dari folder proyek atau terlalu dalam: ' + raw.slice(0, 100))
  }

  const lowerSegments = segments.map(segment => segment.toLowerCase())
  if (lowerSegments.some(segment => BLOCKED_DIRECTORIES.has(segment))) {
    throw new Error('Folder terlarang tidak boleh disertakan: ' + raw.slice(0, 100))
  }
  if (lowerSegments.some(segment =>
    BLOCKED_NAMES.has(segment) || segment.startsWith('.env.')
  )) {
    throw new Error('File atau folder konfigurasi privat/lockfile tidak boleh disertakan: ' + raw.slice(0, 100))
  }

  const extension = path.posix.extname(normalized).toLowerCase()
  const isEmptyFolderPlaceholder = ['.gitkeep', '.keep'].includes(path.posix.basename(normalized).toLowerCase())
  if (!ALLOWED_EXTENSIONS.has(extension) && !isEmptyFolderPlaceholder) {
    throw new Error('File harus berupa kode atau teks. Aset/binary tidak didukung: ' + raw.slice(0, 100))
  }

  return normalized
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
  if (segments.some(segment => BLOCKED_NAMES.has(segment.toLowerCase()) || segment.toLowerCase().startsWith('.env.'))) {
    throw new Error('ZIP tidak boleh menyertakan folder konfigurasi privat atau lockfile: ' + raw.slice(0, 100))
  }
  return segments.join('/')
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function calculateCrc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function findZipEndRecord(buffer) {
  if (buffer.length < 22) return -1
  const minimum = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) return offset
  }
  return -1
}

function decodeZipName(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new Error('Nama file ZIP harus menggunakan encoding UTF-8.')
  }
}

function parseZipCentralDirectory(buffer, limits) {
  const endOffset = findZipEndRecord(buffer)
  if (endOffset < 0) throw new Error('Struktur akhir arsip ZIP tidak ditemukan.')

  const diskNumber = buffer.readUInt16LE(endOffset + 4)
  const centralDisk = buffer.readUInt16LE(endOffset + 6)
  const diskEntries = buffer.readUInt16LE(endOffset + 8)
  const totalEntries = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error('ZIP multi-disk atau terpecah menjadi beberapa bagian tidak didukung.')
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('Arsip ZIP64 belum didukung. Buat ZIP standar tanpa ZIP64.')
  }
  if (totalEntries > limits.maxEntries) {
    throw new Error('ZIP memiliki terlalu banyak entri. Maksimal ' + limits.maxEntries + ' entri.')
  }
  if (centralOffset + centralSize !== endOffset || centralOffset > buffer.length) {
    throw new Error('Indeks pusat ZIP tidak valid atau berada di luar arsip.')
  }

  const entries = []
  let cursor = centralOffset
  for (let index = 0; index < totalEntries; index++) {
    if (cursor + 46 > endOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Entri indeks pusat ZIP rusak atau tidak lengkap.')
    }

    const versionMadeBy = buffer.readUInt16LE(cursor + 4)
    const flags = buffer.readUInt16LE(cursor + 8)
    const compression = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const startDisk = buffer.readUInt16LE(cursor + 34)
    const externalAttributes = buffer.readUInt32LE(cursor + 38)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const recordLength = 46 + nameLength + extraLength + commentLength

    if (cursor + recordLength > endOffset) throw new Error('Metadata entri ZIP terpotong.')
    if (startDisk !== 0) throw new Error('ZIP multi-disk tidak didukung.')
    if (flags & 0x0001 || flags & 0x0040 || flags & 0x2000) throw new Error('ZIP terenkripsi tidak didukung.')
    if (![0, 8].includes(compression)) throw new Error('Metode kompresi ZIP tidak didukung.')
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('Arsip ZIP64 belum didukung. Buat ZIP standar tanpa ZIP64.')
    }

    const nameBuffer = buffer.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = decodeZipName(nameBuffer)
    const operatingSystem = versionMadeBy >>> 8
    const mode = operatingSystem === 3 ? externalAttributes >>> 16 : 0
    const fileType = mode & 0o170000
    if (fileType === 0o120000) throw new Error('ZIP tidak boleh berisi symbolic link: ' + name)
    if (fileType && ![0o040000, 0o100000].includes(fileType)) {
      throw new Error('ZIP berisi file khusus yang tidak didukung: ' + name)
    }

    const isDirectory = name.endsWith('/') || fileType === 0o040000 ||
      (operatingSystem !== 3 && Boolean(externalAttributes & 0x10))
    if (fileType === 0o100000 && isDirectory) {
      throw new Error('Metadata folder ZIP tidak konsisten: ' + name)
    }
    if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) {
      throw new Error('Entri folder ZIP tidak boleh berisi data: ' + name)
    }
    if (uncompressedSize > limits.maxFileBytes && !isDirectory) {
      throw new Error('File ' + name + ' melebihi batas ' + limits.maxFileBytes + ' byte.')
    }

    entries.push({
      name,
      nameBuffer,
      flags,
      compression,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      isDirectory
    })
    cursor += recordLength
  }

  if (cursor !== endOffset) throw new Error('Ada data tambahan yang tidak dikenal di indeks pusat ZIP.')
  return { entries, centralOffset }
}

function extractZipEntry(buffer, entry, centralOffset, maxFileBytes) {
  const offset = entry.localOffset
  if (offset + 30 > centralOffset || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('Header lokal ZIP tidak valid: ' + entry.name)
  }

  const flags = buffer.readUInt16LE(offset + 6)
  const compression = buffer.readUInt16LE(offset + 8)
  const localCrc = buffer.readUInt32LE(offset + 14)
  const localCompressedSize = buffer.readUInt32LE(offset + 18)
  const localUncompressedSize = buffer.readUInt32LE(offset + 22)
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const localNameEnd = offset + 30 + nameLength
  const dataStart = localNameEnd + extraLength
  const dataEnd = dataStart + entry.compressedSize

  if (dataStart > centralOffset || dataEnd > centralOffset || dataEnd < dataStart) {
    throw new Error('Data file ZIP berada di luar batas arsip: ' + entry.name)
  }
  if (flags !== entry.flags || compression !== entry.compression) {
    throw new Error('Header lokal dan indeks pusat ZIP tidak cocok: ' + entry.name)
  }
  if (!buffer.subarray(offset + 30, localNameEnd).equals(entry.nameBuffer)) {
    throw new Error('Nama file pada header ZIP tidak cocok: ' + entry.name)
  }
  if (!(flags & 0x0008) &&
      (localCrc !== entry.crc || localCompressedSize !== entry.compressedSize ||
       localUncompressedSize !== entry.uncompressedSize)) {
    throw new Error('Ukuran atau checksum header ZIP tidak cocok: ' + entry.name)
  }

  const compressed = buffer.subarray(dataStart, dataEnd)
  let result
  try {
    if (entry.compression === 0) {
      result = Buffer.from(compressed)
    } else {
      result = inflateRawSync(compressed, { maxOutputLength: maxFileBytes })
    }
  } catch (error) {
    throw new Error('Gagal mendekompresi ' + entry.name + ': ' + String(error?.message || error).slice(0, 160))
  }

  if (result.length !== entry.uncompressedSize) {
    throw new Error('Ukuran hasil ekstraksi tidak cocok untuk file ' + entry.name + '.')
  }
  if (calculateCrc32(result) !== entry.crc) {
    throw new Error('Checksum CRC ZIP tidak cocok untuk file ' + entry.name + '.')
  }
  return result
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

  const parsedArchive = parseZipCentralDirectory(buffer, {
    maxEntries,
    maxFileBytes
  })
  const files = []
  const seen = new Set()
  const localRanges = []
  let totalFileBytes = 0

  for (const entry of parsedArchive.entries) {
    const isDirectory = entry.isDirectory
    const rawPath = isDirectory ? entry.name.replace(/\/+$/, '') : entry.name
    if (!rawPath) continue

    const filePath = isDirectory
      ? safeZipDirectoryPath(rawPath)
      : safeProjectPath(rawPath)

    const normalizedKey = filePath.toLowerCase()
    if (seen.has(normalizedKey)) throw new Error('ZIP berisi path file duplikat: ' + filePath)
    seen.add(normalizedKey)
    if (isDirectory) continue

    if (files.length >= maxFiles) {
      throw new Error('ZIP memiliki terlalu banyak file. Maksimal ' + maxFiles + ' file source.')
    }

    totalFileBytes += entry.uncompressedSize
    if (totalFileBytes > maxTotalBytes) {
      throw new Error('Total isi ZIP melebihi batas ' + maxTotalBytes + ' byte.')
    }

    const fileBuffer = extractZipEntry(buffer, entry, parsedArchive.centralOffset, maxFileBytes)
    const rangeStart = entry.localOffset
    const rangeEnd = rangeStart + 30 + buffer.readUInt16LE(rangeStart + 26) +
      buffer.readUInt16LE(rangeStart + 28) + entry.compressedSize
    if (localRanges.some(range => rangeStart < range.end && rangeEnd > range.start)) {
      throw new Error('Data file ZIP saling tumpang tindih: ' + filePath)
    }
    localRanges.push({ start: rangeStart, end: rangeEnd })

    if (fileBuffer.includes(0)) {
      throw new Error('File ' + filePath + ' bukan file teks/source yang didukung.')
    }

    let fileContent
    try {
      fileContent = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer)
    } catch {
      throw new Error('File ' + filePath + ' harus menggunakan encoding UTF-8.')
    }
    if (!fileContent.trim()) {
      if (['.gitkeep', '.keep'].includes(path.posix.basename(filePath).toLowerCase())) continue
      throw new Error('File proyek ' + filePath + ' kosong.')
    }
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
