import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {
  MOTION_STYLES,
  buildMotionPrompt,
  getMotionStyle,
  parseMotionZip,
  parseMotionConfig,
  validateMotionVoiceoverImplementation
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
  'src/Root.tsx': 'const Root = () => <Composition calculateMetadata={async () => { const duration = await getAudioDuration(staticFile("voiceover.mp3")); return { durationInFrames: Math.ceil(duration * 30) }; }} />;',
  'src/Video.tsx': '<Audio src={staticFile("voiceover.mp3")} />'
}

async function makeZip(files = projectFiles) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

test('motion style catalogue contains unique selectable styles', () => {
  assert.ok(MOTION_STYLES.length >= 10)
  assert.equal(new Set(MOTION_STYLES.map(style => style.id)).size, MOTION_STYLES.length)
  assert.equal(getMotionStyle('crayon-book').name, 'Crayon Picture Book')
  assert.equal(getMotionStyle('missing-style'), null)
})

test('buildMotionPrompt requires a downloadable ZIP and forbids source code in chat', () => {
  const prompt = buildMotionPrompt('watercolor')
  assert.match(prompt, /Watercolor Brush/)
  assert.match(prompt, /alvareth-motion-project\.zip/)
  assert.match(prompt, /Jangan menampilkan source code/i)
  assert.match(prompt, /lampiran/)
  assert.match(prompt, /motion\.config\.json/)
  assert.match(prompt, /getAudioDuration/)
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
  const traversal = new JSZip()
  traversal.file('../escape.js', 'bad')
  await assert.rejects(parseMotionZip(await traversal.generateAsync({ type: 'nodebuffer' })), /path|package\.json/i)

  const duplicate = {
    ...projectFiles,
    'src/INDEX.tsx': 'registerRoot(OtherRoot);'
  }
  await assert.rejects(parseMotionZip(await makeZip(duplicate)), /duplikat/i)

  const binary = { ...projectFiles, 'public/image.png': 'fake-image-data' }
  await assert.rejects(parseMotionZip(await makeZip(binary)), /Aset\/binary/)
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
})

test('validateMotionVoiceoverImplementation requires audio-based dynamic duration and playback', () => {
  const files = [
    { path: 'src/Root.tsx', content: 'import { getAudioDuration } from "@remotion/media-utils"; const calculateMetadata = async () => getAudioDuration(staticFile("voiceover.mp3"));' },
    { path: 'src/Video.tsx', content: '<Audio src={staticFile("voiceover.mp3")} />' }
  ]
  assert.doesNotThrow(() => validateMotionVoiceoverImplementation(files))
  assert.throws(() => validateMotionVoiceoverImplementation(files.slice(1)), /belum menyinkronkan/)
})
