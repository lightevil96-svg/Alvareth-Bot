import path from 'node:path'
import { constants as bufferConstants } from 'node:buffer'
import v8 from 'node:v8'
import { inflateRawSync } from 'node:zlib'
import { TTS_VOICE_PROFILES } from './tts-config.js'
import { getStyleDNAContract } from './motion-engine/style-dna.js'

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
    id: 'storybook-3d',
    name: 'Stylized 3D Story Animation',
    description: 'Animasi cerita 3D kartun sinematik dengan karakter ekspresif, dunia detail, warna hangat, dan subtitle kata kunci.',
    direction: `REFERENCE-MATCHED TRUE 3D STORY ANIMATION. Combine the rounded volumetric character appeal of 390381.mp4 with the hand-inked cel-shaded story world, earthy matte materials, bold contours, and cinematic story direction of 390306.mp4. Both references contribute different layers of one coherent style: every main character is a real articulated Three.js mesh rig, never a 2D card, sprite, or billboard. Characters have organic rounded silhouettes, attached 3D facial features, expressive brows and mouths, compact bodies, tapered limbs, matte three-tone toon shading, and stable dark warm outlines. Build richly layered 3D environments with real architecture, props, foreground/midground/background, perspective, contact shadows, warm key light, restrained fill/rim light, selective world ink, and motivated cinematic camera movement. Use white Indonesian subtitles with a dark outline and a yellow highlighted keyword. Adapt the cast, costume, props, location, and lighting mood to each new story without changing the reusable visual DNA.`
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

export function getMotionStyle(styleId) {
  return STYLE_BY_ID.get(String(styleId || '').trim()) || null
}

export function resolveMotionProjectRoot(projectDirectory, projectRoot = '') {
  const baseInput = String(projectDirectory || '').trim()
  if (!baseInput) throw new Error('Direktori proyek .motion tidak boleh kosong.')
  const base = path.resolve(baseInput)
  const rawInput = String(projectRoot || '').trim()
  const relativeRoot = rawInput === '.' ? '' : rawInput.replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (relativeRoot.includes('\0') || relativeRoot.includes('\\') ||
      path.posix.isAbsolute(relativeRoot) || /^[a-zA-Z]:/.test(relativeRoot)) {
    throw new Error('Root proyek .motion tidak aman.')
  }
  const segments = relativeRoot ? relativeRoot.split('/') : []
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Root proyek .motion tidak boleh keluar dari folder ZIP.')
  }
  const resolved = path.resolve(base, ...segments)
  const relative = path.relative(base, resolved)
  if (relative && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) {
    throw new Error('Root proyek .motion berada di luar folder ZIP.')
  }
  return resolved
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
    '7. Durasi video WAJIB mengikuti durasi audio voiceover, bukan angka durasi yang ditentukan manual. Gunakan calculateMetadata pada Composition dan getAudioDuration dari @remotion/media-utils untuk menghitung durationInFrames berdasarkan public/voiceover.mp3. WAJIB tangani metadata yang gagal dibaca: bungkus getAudioDuration dengan try/catch, periksa Number.isFinite(audioDurationInSeconds) dan nilainya harus lebih dari nol, lalu gunakan estimasi konservatif berdasarkan jumlah kata naskah voiceover sebagai fallback. Jangan pernah mengalikan NaN/undefined dengan fps.',
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
    'Composition wajib memiliki calculateMetadata yang membaca durasi public/voiceover.mp3 melalui getAudioDuration(staticFile("voiceover.mp3")). Jika hasilnya bukan angka finite positif atau pemanggilan gagal, gunakan fallback estimasi konservatif dari teks voiceover; pastikan fps finite positif, durationInFrames dihitung dengan Math.ceil, dan validasi Number.isSafeInteger(durationInFrames) sebelum dikembalikan. Jangan menetapkan batas maksimal durasi dan jangan memakai angka durasi tetap.',
    'Pastikan komponen utama merender <Audio src={staticFile("voiceover.mp3")} />.',
    '',
    'Jika ide video belum saya berikan, balas hanya dengan satu pertanyaan singkat untuk meminta tema/cerita video. Setelah saya menjawab, langsung buat proyek lengkap, kemas sebagai ZIP yang dapat diunduh, dan jangan menampilkan kode sumber di chat.'
  ]

  if (['real-3d', 'storybook-3d'].includes(style.id)) {
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

    if (style.id === 'storybook-3d') {
      lines.splice(
        lines.indexOf('ATURAN PRODUKSI'),
        0,
        'CANONICAL ALVARETH STYLE DNA — SOURCE OF TRUTH',
        getStyleDNAContract(),
        'REFERENCE RESOLUTION — TWO SOURCE CLIPS',
        '390381.mp4 supplies the rounded, volumetric 3D character appeal, readable silhouettes, soft matte surfaces, and friendly character proportions.',
        '390306.mp4 supplies the hand-inked contour language, earthy cel-shaded storybook world, dimensional set dressing, dramatic warm/cool lighting, story coverage, and subtitle treatment.',
        'Synthesize both references into one coherent TRUE 3D style: the characters and the world are both volumetric Three.js geometry. Do not copy the exact plot, cast, costumes, or props from either reference.',
        'TRUE 3D CHARACTER CONTRACT',
        'Every main character MUST be built from actual THREE.Mesh objects and 3D geometry with an articulated rig. Use organic custom or carefully shaped meshes for head, torso, hair, clothing, hands, shoes, eyes, brows, and mouth. The face features must be attached to the head in 3D space and move with its pivots.',
        'Never represent a main character as a 2D drawing, SVG card, CanvasTexture card, THREE.Sprite, PlaneGeometry billboard, camera-facing plane, or flat cutout. Do not use a 2D character to fake a 3D character. Small 2D particles or graphic accents may be used only as secondary effects, never as the cast.',
        'Avoid primitive-demo or robot assembly. Shapes must read as coherent organic characters with stable proportions, distinct silhouettes, clean joints, tapered limbs, feet that contact the ground, and facial expressions readable at phone size. Reuse the same character identity, colors, outfit, hair, and accessories across all scenes.',
        'Apply matte MeshToonMaterial/cel shading with three readable tonal bands, dark warm-plum outlines around character silhouettes, restrained highlights, soft contact shadows, and expressive but controlled face animation. Do not use glossy vinyl/plastic skin or generic shiny toy materials.',
        'CANONICAL ALVARETH ENGINE — AUTOMATICALLY INJECTED BY THE BOT',
        'After the ZIP is uploaded, Alvareth Bot injects its tested reusable engine into src/alvareth-engine/. Do not include this folder in the ZIP and do not reimplement or overwrite its canonical modules.',
        'Import the engine API from the correct relative path to src/alvareth-engine/index.js. Required APIs: createCharacter, applyCharacterPose, setCharacterExpression, getCharacterAnchor, attachCharacterProp, createStoryWorld, createWorldLighting, createBuilding, createTree, createWoodenProp, createMotionEngine, createWalkPose, sampleKeyframes, applyCinematicCamera, fitCameraToSubjects, and assertVisualContract.',
        'Character Engine: call createCharacter(characterSpec) once per character, add the returned THREE.Group to the Three.js scene, and update it with applyCharacterPose(character, pose) and setCharacterExpression(character, expression). Choose outfitStyle (tunic/robe/shirt/coat/dress), headShape, headScale, bodyScale and hairStyle to fit each role while preserving the Style DNA. Use getCharacterAnchor and attachCharacterProp for hand-held story props. Never rebuild the character every frame.',
        'World Engine: create the world through createStoryWorld(scene, moodOptions), then add story-specific buildings, trees, furniture, tools, vehicles, terrain, and props as real 3D meshes. Build a complete set with foreground, midground, background, plausible scale, occlusion, and contact points.',
        'Motion Engine: all movement must be deterministic and seekable from useCurrentFrame(). Use createMotionEngine, sampleKeyframes, createWalkPose, and frame-based pose curves for anticipation, action, reaction, and settle. Avoid continuous generic bobbing and avoid useFrame, requestAnimationFrame, timers, Date.now, or simulation that depends on previous frames.',
        'Camera Engine: use a PerspectiveCamera and applyCinematicCamera(camera, frame, shotKeyframes) for motivated establishing, medium, close-up, insert, tracking, dolly, pan, or orbit shots. Use fitCameraToSubjects for framing; preserve prop/character scale and screen direction across cuts.',
        'Visual QA: after scene construction, call assertVisualContract({scene, camera, characters}) and keep the report in the project render log. The main cast must pass the volumetric mesh check; the scene must contain real world meshes, multiple lights, and cast/receive shadows.',
        'Use ThreeCanvas from @remotion/three and React Three Fiber. Read the current Remotion frame with useCurrentFrame(); update all object transforms directly from that frame. Do not use useFrame or real-time animation loops.',
        'Use real 3D geometry for all important locations and props. Use selective world outlines thinner than character outlines, painterly matte materials, warm directional key light, restrained cool/warm fill, subtle rim light, soft shadows, and atmospheric depth.',
        'SUBTITLES AND COMPOSITION',
        'Use bold white Indonesian subtitles with a dark warm outline/shadow and highlight one important spoken keyword in #FFD93D. Position captions in a flexible safe region based on the shot; never cover faces, hands, or story-critical props. A dark rounded panel is optional only for explanatory/promo beats, not a permanent overlay.',
        'FLEXIBLE STORY ADAPTATION',
        'Change characters, costumes, locations, props, architecture, weather, lighting mood, and color accents to fit each new brief. Keep the Style DNA and technical engine stable, but never force a forge, blacksmith, medieval village, hammer, or other reference-specific object into an unrelated story.'
      )
    }
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
  if (!normalized ||
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
  if (!normalized ||
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

function parseZipCentralDirectory(buffer, { maxFileBytes }) {
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
    if (uncompressedSize > maxFileBytes && !isDirectory) {
      throw new Error('File ' + name + ' melebihi batas ' + maxFileBytes + ' byte.')
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

function getAvailableZipMemoryBudget() {
  const heapLimit = Number(v8.getHeapStatistics().heap_size_limit) || 0
  const constrainedMemory = typeof process.constrainedMemory === 'function'
    ? Number(process.constrainedMemory()) || 0
    : 0
  const effectiveLimit = constrainedMemory > 0
    ? Math.min(heapLimit || constrainedMemory, constrainedMemory)
    : heapLimit
  const residentBytes = Number(process.memoryUsage().rss) || 0
  const availableBytes = Math.max(0, effectiveLimit - residentBytes)

  // Keep room for the original ZIP buffer, decoded JS strings, rendering,
  // and the rest of the bot. This scales with the actual runtime memory
  // instead of imposing a fixed project-size ceiling.
  return Math.floor(availableBytes * 0.2)
}

export async function parseMotionZip(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
  const maxArchiveBytes = Number.isSafeInteger(options.maxArchiveBytes) && options.maxArchiveBytes > 0
    ? options.maxArchiveBytes
    : buffer.length
  const maxFileBytes = Number.isSafeInteger(options.maxFileBytes) && options.maxFileBytes > 0
    ? options.maxFileBytes
    : bufferConstants.MAX_LENGTH
  const maxTotalBytes = Number.isSafeInteger(options.maxTotalBytes) && options.maxTotalBytes > 0
    ? options.maxTotalBytes
    : getAvailableZipMemoryBudget()
  if (!buffer.length) throw new Error('File ZIP kosong.')
  if (buffer.length > maxArchiveBytes) {
    throw new Error('Ukuran ZIP ' + buffer.length + ' byte melebihi batas ' + maxArchiveBytes + ' byte.')
  }

  const hasZipSignature = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
     (buffer[2] === 0x05 && buffer[3] === 0x06) ||
     (buffer[2] === 0x07 && buffer[3] === 0x08))
  if (!hasZipSignature) throw new Error('File yang dikirim bukan arsip ZIP yang valid.')

  const parsedArchive = parseZipCentralDirectory(buffer, { maxFileBytes })
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


    totalFileBytes += entry.uncompressedSize
    if (totalFileBytes > maxTotalBytes) {
      throw new Error('Total isi ZIP melebihi anggaran memori aman yang tersedia (' + maxTotalBytes + ' byte).')
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
    [/Number\.isFinite\s*\(\s*audioDurationInSeconds\s*\)/, 'pemeriksaan Number.isFinite untuk durasi audio'],
    [/estimateVoiceoverDurationInSeconds\s*\(/, 'fallback estimasi durasi dari naskah voiceover'],
    [/Number\.isFinite\s*\(\s*fps\s*\)/, 'pemeriksaan Number.isFinite untuk fps'],
    [/Number\.isSafeInteger\s*\(\s*durationInFrames\s*\)/, 'validasi bilangan bulat durationInFrames'],
    [/<Audio\b/, 'komponen Audio untuk memutar voiceover']
  ]

  const missing = checks.filter(([pattern]) => !pattern.test(source)).map(([, label]) => label)
  if (missing.length) {
    throw new Error('Kode belum menyinkronkan video dengan voiceover. Lengkapi: ' + missing.join(', ') + '.')
  }
}


export function validateStorybookEngineImplementation(files, packageJson = {}) {
  const allFiles = Array.isArray(files) ? files : [];
  const dependencies = {
    ...(packageJson.dependencies && typeof packageJson.dependencies === 'object' ? packageJson.dependencies : {}),
    ...(packageJson.devDependencies && typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies : {}),
    ...(packageJson.optionalDependencies && typeof packageJson.optionalDependencies === 'object' ? packageJson.optionalDependencies : {})
  };
  const requiredPackages = ['@remotion/three', '@react-three/fiber', 'three'];
  const missingPackages = requiredPackages.filter(name => !dependencies[name]);
  if (missingPackages.length) {
    throw new Error('Proyek Stylized 3D Story belum mencantumkan dependency: ' + missingPackages.join(', ') + '.');
  }

  const requiredEngineFiles = [
    'src/alvareth-engine/style-dna.js',
    'src/alvareth-engine/character-engine.js',
    'src/alvareth-engine/world-engine.js',
    'src/alvareth-engine/motion-engine.js',
    'src/alvareth-engine/camera-engine.js',
    'src/alvareth-engine/visual-qa.js',
    'src/alvareth-engine/index.js'
  ];
  const fileByPath = new Map(allFiles.map(file => [String(file.path || '').replace(/\\/g, '/'), file]));
  const missingEngineFiles = requiredEngineFiles.filter(file => !fileByPath.has(file));
  if (missingEngineFiles.length) {
    throw new Error('Alvareth 3D engine belum terpasang lengkap: ' + missingEngineFiles.join(', ') + '.');
  }

  const projectSource = allFiles
    .filter(file => /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(file.path))
    .filter(file => !String(file.path).replace(/\\/g, '/').includes('/alvareth-engine/'))
    .map(file => file.content)
    .join('\n');
  const engineSource = requiredEngineFiles
    .map(file => fileByPath.get(file).content)
    .join('\n');
  const characterSource = fileByPath.get('src/alvareth-engine/character-engine.js').content;

  const projectChecks = [
    [/from\s+['"][^'"]*alvareth-engine\/index\.js['"]/, 'import engine resmi dari src/alvareth-engine/index.js'],
    [/\bcreateCharacter\s*\(/, 'createCharacter() untuk membangun karakter 3D'],
    [/\bapplyCharacterPose\s*\(/, 'applyCharacterPose() untuk animasi rig karakter'],
    [/\bsetCharacterExpression\s*\(/, 'setCharacterExpression() untuk ekspresi wajah'],
    [/\bcreateStoryWorld\s*\(/, 'createStoryWorld() untuk dunia 3D'],
    [/\bcreateMotionEngine\s*\(/, 'createMotionEngine() untuk timeline deterministik'],
    [/\bapplyCinematicCamera\s*\(/, 'applyCinematicCamera() untuk kamera sinematik'],
    [/\bassertVisualContract\s*\(/, 'assertVisualContract() untuk QA scene'],
    [/\bThreeCanvas\b/, 'ThreeCanvas dari @remotion/three'],
    [/\buseCurrentFrame\s*\(/, 'useCurrentFrame() untuk animasi seekable']
  ];
  const missingProject = projectChecks.filter(([pattern]) => !pattern.test(projectSource)).map(([, label]) => label);
  if (missingProject.length) {
    throw new Error('Integrasi Stylized 3D Story belum lengkap. Lengkapi: ' + missingProject.join(', ') + '.');
  }

  const engineChecks = [
    [/export function createCharacter\s*\(/, 'Character Engine'],
    [/export function createOrganicHeadGeometry\s*\(/, 'organic head geometry'],
    [/export function createTunicGeometry\s*\(/, 'costume-specific body geometry'],
    [/export function getCharacterAnchor\s*\(/, 'character hand/prop anchors'],
    [/export function attachCharacterProp\s*\(/, 'hand-held story prop attachment'],
    [/new THREE\.Mesh\s*\(/, 'mesh geometry 3D'],
    [/MeshToonMaterial/, 'toon shading'],
    [/export function createStoryWorld\s*\(/, 'World Engine'],
    [/export function createWalkPose\s*\(/, 'Motion Engine'],
    [/export function applyCinematicCamera\s*\(/, 'Camera Engine'],
    [/export function assertVisualContract\s*\(/, 'Visual QA']
  ];
  const missingEngine = engineChecks.filter(([pattern]) => !pattern.test(engineSource)).map(([, label]) => label);
  if (missingEngine.length) {
    throw new Error('Modul Alvareth 3D engine tidak memenuhi kontrak: ' + missingEngine.join(', ') + '.');
  }
  if (/THREE\.Sprite|new\s+THREE\.PlaneGeometry|PlaneBufferGeometry/.test(characterSource)) {
    throw new Error('Character Engine tidak boleh mengganti karakter utama dengan sprite atau billboard 2D.');
  }

  return { engineVersion: '1.1.0', engineFiles: requiredEngineFiles.length, requiredPackages };
}
