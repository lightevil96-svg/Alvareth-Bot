import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import {
  MOTION_STYLES,
  buildMotionPrompt,
  getMotionStyle,
  parseMotionZip,
  parseMotionConfig,
  validateMotionVoiceoverImplementation,
  validateStorybookEngineImplementation,
  resolveMotionProjectRoot
} from '../lib/motion-project.js'

const projectFiles = {
  'package.json': JSON.stringify({
    name: 'motion-test',
    dependencies: {
      remotion: '4.0.534',
      '@remotion/cli': '4.0.534',
      '@remotion/media-utils': '4.0.534',
      react: '18.3.1',
      'react-dom': '18.3.1'
    },
    alvarethRemotion: {
      entryPoint: 'src/index.tsx',
      compositionId: 'MotionVideo'
    }
  }),
  'motion.config.json': JSON.stringify({
    title: 'Test',
    voiceoverText: 'Halo dunia',
    voiceProfile: 'female'
  }),
  'src/index.tsx': 'registerRoot(Root);',
  'src/Root.tsx': 'const estimateVoiceoverDurationInSeconds = () => 2; const calculateMetadata = async () => { let audioDurationInSeconds = Number.NaN; try { audioDurationInSeconds = await getAudioDuration(staticFile("voiceover.mp3")); } catch {} const safeDuration = Number.isFinite(audioDurationInSeconds) && audioDurationInSeconds > 0 ? audioDurationInSeconds : estimateVoiceoverDurationInSeconds(); const durationInFrames = Math.ceil(safeDuration * 30); if (!Number.isSafeInteger(durationInFrames)) throw new Error("invalid duration"); return { durationInFrames }; };',
  'src/Video.tsx': '<Audio src={staticFile("voiceover.mp3")} />'
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function makeZip(files = projectFiles) {
  const localParts = []
  const centralParts = []
  let localOffset = 0

  for (const [name, value] of Object.entries(files)) {
    const content = Buffer.from(typeof value === 'object' && value !== null ? value.content : value, 'utf8')
    const unixMode = typeof value === 'object' && value !== null ? value.unixMode ?? 0o100644 : 0o100644
    const nameBuffer = Buffer.from(name, 'utf8')
    const compressed = deflateRawSync(content)
    const checksum = crc32(content)

    const localHeader = Buffer.alloc(30 + nameBuffer.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)
    nameBuffer.copy(localHeader, 30)
    localParts.push(Buffer.concat([localHeader, compressed]))

    const centralHeader = Buffer.alloc(46 + nameBuffer.length)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE((3 << 8) | 20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE((unixMode << 16) >>> 0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    nameBuffer.copy(centralHeader, 46)
    centralParts.push(centralHeader)

    localOffset += localHeader.length + compressed.length
  }

  const localData = Buffer.concat(localParts)
  const centralData = Buffer.concat(centralParts)
  const entryCount = centralParts.length
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4)
  endRecord.writeUInt16LE(0, 6)
  endRecord.writeUInt16LE(entryCount, 8)
  endRecord.writeUInt16LE(entryCount, 10)
  endRecord.writeUInt32LE(centralData.length, 12)
  endRecord.writeUInt32LE(localData.length, 16)
  endRecord.writeUInt16LE(0, 20)
  return Buffer.concat([localData, centralData, endRecord])
}

test('motion style catalogue contains every repository visual preset and unique selectable styles', () => {
  assert.equal(MOTION_STYLES.length, 16)
  assert.equal(new Set(MOTION_STYLES.map(style => style.id)).size, MOTION_STYLES.length)
  assert.equal(getMotionStyle('crayon-book').name, 'Crayon Picture Book')
  assert.equal(getMotionStyle('cinematic-illustrated').name, 'Cinematic 2.5D Explainer')
  assert.equal(getMotionStyle('3d-glass').name, 'Premium 3D Glass')
  assert.equal(getMotionStyle('kinetic-bold').name, 'Bold Kinetic Typography')
  assert.equal(getMotionStyle('clean-editorial').name, 'Clean Editorial')
  assert.equal(getMotionStyle('real-3d').name, 'Real 3D Animation (Three.js)')
  assert.equal(getMotionStyle('storybook-3d').name, 'Stylized 3D Story Animation')
  assert.equal(getMotionStyle('missing-style'), null)
})

test('real 3D prompt requires real Three.js meshes and Remotion-synchronized ThreeCanvas', () => {
  const prompt = buildMotionPrompt('real-3d')
  assert.match(prompt, /Real 3D Animation \(Three\.js\)/)
  assert.match(prompt, /@remotion\/three/)
  assert.match(prompt, /@react-three\/fiber/)
  assert.match(prompt, /ThreeCanvas/)
  assert.match(prompt, /useCurrentFrame/)
  assert.match(prompt, /mesh dan geometri 3D nyata/)
  assert.match(prompt, /jangan memakai useFrame/i)
  assert.match(prompt, /webglRenderer/)
  assert.match(prompt, /swangle/)
})

test('storybook 3D prompt synthesizes both references with true volumetric characters', () => {
  const prompt = buildMotionPrompt('storybook-3d')
  assert.match(prompt, /Stylized 3D Story Animation/)
  assert.match(prompt, /390381\.mp4/)
  assert.match(prompt, /390306\.mp4/)
  assert.match(prompt, /ALVARETH STYLE DNA/)
  assert.match(prompt, /head\/body width ratio about 1\.2/)
  assert.match(prompt, /TRUE 3D CHARACTER CONTRACT/)
  assert.match(prompt, /actual THREE\.Mesh objects/i)
  assert.match(prompt, /never a 2D card, sprite, or billboard/i)
  assert.match(prompt, /src\/alvareth-engine/i)
  assert.match(prompt, /createCharacter/)
  assert.match(prompt, /attachCharacterProp/)
  assert.match(prompt, /applyCharacterPose/)
  assert.match(prompt, /createStoryWorld/)
  assert.match(prompt, /applyCinematicCamera/)
  assert.match(prompt, /assertVisualContract/)
  assert.match(prompt, /ThreeCanvas/)
  assert.match(prompt, /useCurrentFrame/)
  assert.match(prompt, /Do not use useFrame/i)
  assert.match(prompt, /#FFD93D/)
  assert.match(prompt, /never force a forge/i)
})

test('storybook 3D project validator requires the injected engine and actual API integration', () => {
  const packageJson = { dependencies: {
    '@remotion/three': '4.0.534',
    '@react-three/fiber': '8.17.10',
    three: '0.170.0'
  } }
  const files = [
    { path: 'src/Scene.tsx', content: [
      "import { createCharacter, applyCharacterPose, setCharacterExpression, createStoryWorld, createMotionEngine, applyCinematicCamera, assertVisualContract } from './alvareth-engine/index.js';",
      "import { ThreeCanvas } from '@remotion/three';",
      "import { useCurrentFrame } from 'remotion';",
      "const character = createCharacter({ id: 'hero' });",
      "applyCharacterPose(character, {}); setCharacterExpression(character, 'happy');",
      "createStoryWorld(scene, {}); createMotionEngine({ fps: 30 });",
      "applyCinematicCamera(camera, frame, []); assertVisualContract({ scene, camera, characters: [character] });",
      "<ThreeCanvas />; useCurrentFrame();"
    ].join('\n') },
    { path: 'src/alvareth-engine/style-dna.js', content: 'export const ALVARETH_STYLE_DNA = {};'},
    { path: 'src/alvareth-engine/character-engine.js', content: 'export function createCharacter() {} new THREE.Mesh(); new THREE.MeshToonMaterial();'},
    { path: 'src/alvareth-engine/world-engine.js', content: 'export function createStoryWorld() {}'},
    { path: 'src/alvareth-engine/motion-engine.js', content: 'export function createWalkPose() {}'},
    { path: 'src/alvareth-engine/camera-engine.js', content: 'export function applyCinematicCamera() {}'},
    { path: 'src/alvareth-engine/visual-qa.js', content: 'export function assertVisualContract() {}'},
    { path: 'src/alvareth-engine/index.js', content: 'export * from "./character-engine.js";'}
  ]
  assert.doesNotThrow(() => validateStorybookEngineImplementation(files, packageJson))
  assert.throws(
    () => validateStorybookEngineImplementation(files.filter(file => file.path !== 'src/alvareth-engine/character-engine.js'), packageJson),
    /engine belum terpasang lengkap/i
  )
})

test('buildMotionPrompt requires a downloadable ZIP and forbids source code in chat', () => {
  const prompt = buildMotionPrompt('watercolor')
  assert.match(prompt, /Watercolor Brush/)
  assert.match(prompt, /alvareth-motion-project\.zip/)
  assert.match(prompt, /Jangan menampilkan source code/i)
  assert.match(prompt, /lampiran/)
  assert.match(prompt, /motion\.config\.json/)
  assert.match(prompt, /getAudioDuration/)
  assert.match(prompt, /Number\.isFinite\(audioDurationInSeconds\)/)
  assert.match(prompt, /fallback estimasi konservatif dari teks voiceover/)
  assert.match(prompt, /Number\.isSafeInteger\(durationInFrames\)/)
  assert.match(prompt, /Jangan menetapkan batas maksimal durasi/)
  assert.doesNotMatch(prompt, /===FILE:/)
  assert.throws(() => buildMotionPrompt('not-a-style'), /tidak dikenal/)
})

test('parseMotionZip extracts a complete Remotion project', async () => {
  const result = await parseMotionZip(await makeZip())
  assert.equal(result.fileCount, 5)
  assert.equal(result.projectRoot, '')
  assert.equal(result.totalFileBytes, Object.values(projectFiles).reduce((sum, value) => sum + Buffer.byteLength(value), 0))
  assert.equal(result.files.find(file => file.path === 'motion.config.json').content.includes('voiceoverText'), true)
  assert.match(result.files.find(file => file.path === 'src/Root.tsx').content, /getAudioDuration/)
})

test('parseMotionZip accepts more than 500 source files without a file-count cap', async () => {
  const manyFiles = {
    ...projectFiles,
    ...Object.fromEntries(Array.from({ length: 501 }, (_, index) => [
      'src/generated/file-' + index + '.txt',
      'generated source metadata ' + index
    ]))
  }
  const result = await parseMotionZip(await makeZip(manyFiles))
  assert.equal(result.fileCount, 506)
  assert.equal(result.files.some(file => file.path === 'src/generated/file-500.txt'), true)
})

test('parseMotionZip has no fixed 1 MB per-file or 10 MB total source-size cap', async () => {
  const largeText = 'Large generated source content. '.repeat(40_000)
  const largeFiles = {
    ...projectFiles,
    ...Object.fromEntries(Array.from({ length: 11 }, (_, index) => [
      'src/generated/large-' + index + '.txt',
      largeText
    ]))
  }
  const result = await parseMotionZip(await makeZip(largeFiles))
  assert.equal(result.fileCount, 16)
  assert.ok(result.totalFileBytes > 10 * 1024 * 1024)
  assert.ok(Buffer.byteLength(result.files.find(file => file.path === 'src/generated/large-0.txt').content) > 1024 * 1024)
})

test('parseMotionZip silently skips empty .gitkeep and .keep placeholders', async () => {
  const withPlaceholders = {
    ...projectFiles,
    'public/.gitkeep': '',
    'public/.keep': ''
  }
  const result = await parseMotionZip(await makeZip(withPlaceholders))
  assert.equal(result.fileCount, 5)
  assert.equal(result.files.some(file => file.path.endsWith('.gitkeep') || file.path.endsWith('.keep')), false)
  assert.equal(result.files.some(file => file.path === 'motion.config.json'), true)
})

test('parseMotionZip supports one enclosing project folder', async () => {
  const nested = Object.fromEntries(
    Object.entries(projectFiles).map(([name, content]) => ['my-motion-project/' + name, content])
  )
  const result = await parseMotionZip(await makeZip(nested))
  assert.equal(result.projectRoot, 'my-motion-project')
  assert.ok(result.files.some(file => file.path === 'my-motion-project/src/index.tsx'))
})

test('parseMotionZip rejects invalid archives and archive size overflow', async () => {
  await assert.rejects(parseMotionZip(Buffer.from('not a zip')), /bukan arsip ZIP/)
  const zip = await makeZip()
  await assert.rejects(parseMotionZip(zip, { maxArchiveBytes: 10 }), /melebihi batas/)
  await assert.rejects(parseMotionZip(Buffer.alloc(0)), /kosong/)
})

test('parseMotionZip rejects path traversal, duplicate case-insensitive names, and unsupported binary assets', async () => {
  await assert.rejects(parseMotionZip(await makeZip({ '../escape.js': 'bad' })), /Path file proyek|path/i)

  const duplicate = {
    ...projectFiles,
    'src/INDEX.tsx': 'registerRoot(OtherRoot);'
  }
  await assert.rejects(parseMotionZip(await makeZip(duplicate)), /duplikat/i)

  const binary = { ...projectFiles, 'public/image.png': 'fake-image-data' }
  await assert.rejects(parseMotionZip(await makeZip(binary)), /Aset\/binary/)

  const symlink = { ...projectFiles, 'src/link.tsx': { content: 'target', unixMode: 0o120777 } }
  await assert.rejects(parseMotionZip(await makeZip(symlink)), /symbolic link/)
})

test('parseMotionZip rejects dependency folders and oversized uncompressed content', async () => {
  const dependencies = { ...projectFiles, 'node_modules/react/index.js': 'module.exports = {}' }
  await assert.rejects(parseMotionZip(await makeZip(dependencies)), /folder.*tidak boleh|folder.*dependency/i)

  const large = { ...projectFiles, 'src/large.tsx': 'x'.repeat(2048) }
  await assert.rejects(parseMotionZip(await makeZip(large), { maxFileBytes: 1024 }), /melebihi batas/)
  await assert.rejects(parseMotionZip(await makeZip(large), { maxTotalBytes: 1024 }), /Total isi ZIP/)
})

test('parseMotionZip requires a Remotion package, matching motion config, and source entry', async () => {
  const noPackage = { 'README.md': 'hello' }
  await assert.rejects(parseMotionZip(await makeZip(noPackage)), /package\.json proyek Remotion/)

  const noConfig = { ...projectFiles }
  delete noConfig['motion.config.json']
  await assert.rejects(parseMotionZip(await makeZip(noConfig)), /motion\.config\.json wajib/)

  const noSource = {
    'package.json': projectFiles['package.json'],
    'motion.config.json': projectFiles['motion.config.json'],
    'README.md': 'no source'
  }
  await assert.rejects(parseMotionZip(await makeZip(noSource)), /folder src/)
})

test('parseMotionConfig validates narration and supported TTS voice profiles', () => {
  assert.deepEqual(parseMotionConfig({
    title: '  Film  ',
    voiceoverText: '  Halo dunia.  ',
    voiceProfile: 'male'
  }), {
    title: 'Film',
    voiceoverText: 'Halo dunia.',
    voiceProfile: 'male'
  })
  assert.throws(() => parseMotionConfig({ voiceoverText: '' }), /voiceoverText/)
  assert.throws(() => parseMotionConfig({ voiceoverText: 'Halo', voiceProfile: 'unknown' }), /voiceProfile tidak dikenal/)
  const longNarration = 'Narasi panjang untuk video. '.repeat(400)
  assert.equal(parseMotionConfig({ voiceoverText: longNarration }).voiceoverText, longNarration.trim())
})

test('validateMotionVoiceoverImplementation requires finite duration, safe fallback, and audio playback', () => {
  const files = [
    {
      path: 'src/Root.tsx',
      content: [
        'import { getAudioDuration } from "@remotion/media-utils";',
        'const estimateVoiceoverDurationInSeconds = () => 12;',
        'const calculateMetadata = async () => {',
        'let audioDurationInSeconds = Number.NaN;',
        'try { audioDurationInSeconds = await getAudioDuration(staticFile("voiceover.mp3")); } catch {}',
        'const safeDuration = Number.isFinite(audioDurationInSeconds) && audioDurationInSeconds > 0 ? audioDurationInSeconds : estimateVoiceoverDurationInSeconds();',
        'const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;',
        'const durationInFrames = Math.ceil(safeDuration * safeFps);',
        'if (!Number.isSafeInteger(durationInFrames)) throw new Error("invalid duration");',
        'return { durationInFrames };',
        '};'
      ].join(' ')
    },
    { path: 'src/Video.tsx', content: '<Audio src={staticFile("voiceover.mp3")} />' }
  ]
  assert.doesNotThrow(() => validateMotionVoiceoverImplementation(files))
  assert.throws(() => validateMotionVoiceoverImplementation(files.slice(1)), /belum menyinkronkan/)

  const unsafeFiles = [
    { path: 'src/Root.tsx', content: 'import { getAudioDuration } from "@remotion/media-utils"; const calculateMetadata = async () => { const audioDurationInSeconds = await getAudioDuration(staticFile("voiceover.mp3")); return { durationInFrames: Math.ceil(audioDurationInSeconds * 30) }; };' },
    files[1]
  ]
  assert.throws(() => validateMotionVoiceoverImplementation(unsafeFiles), /pemeriksaan Number\.isFinite/)
})


test('resolveMotionProjectRoot accepts root-level ZIP projects and safe nested project folders', () => {
  const base = path.resolve('/tmp/alvareth-motion-root')
  assert.equal(resolveMotionProjectRoot(base, ''), base)
  assert.equal(resolveMotionProjectRoot(base, '.'), base)
  assert.equal(resolveMotionProjectRoot(base, 'package'), path.join(base, 'package'))
  assert.throws(() => resolveMotionProjectRoot(base, '../outside'), /tidak aman|tidak boleh keluar|di luar/i)
  assert.throws(() => resolveMotionProjectRoot(base, '/tmp/outside'), /tidak aman/i)
})
