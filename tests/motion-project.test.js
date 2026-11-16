import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MOTION_STYLES,
  buildMotionPrompt,
  getMotionStyle,
  parseMotionCode,
  parseMotionConfig,
  validateMotionVoiceoverImplementation
} from '../lib/motion-project.js'

const fence = String.fromCharCode(96).repeat(3)
const sample = [
  '===FILE: package.json===',
  fence + 'json',
  '{"name":"motion-test","dependencies":{"remotion":"4.0.534"}}',
  fence,
  '',
  '===FILE: motion.config.json===',
  fence + 'json',
  '{"title":"Test","voiceoverText":"Halo dunia","voiceProfile":"female"}',
  fence,
  '',
  '===FILE: src/index.tsx===',
  fence + 'tsx',
  'registerRoot(Root);',
  fence,
  '',
  '===FILE: src/Root.tsx===',
  fence + 'tsx',
  'const Root = () => <Composition calculateMetadata={async () => { const duration = await getAudioDuration(staticFile("voiceover.mp3")); return { durationInFrames: Math.ceil(duration * 30) }; }} />;',
  fence,
  '',
  '===FILE: src/Video.tsx===',
  fence + 'tsx',
  '<Audio src={staticFile("voiceover.mp3")} />',
  fence
].join('\n')

test('motion style catalogue contains unique selectable styles', () => {
  assert.ok(MOTION_STYLES.length >= 10)
  assert.equal(new Set(MOTION_STYLES.map(style => style.id)).size, MOTION_STYLES.length)
  assert.equal(getMotionStyle('crayon-book').name, 'Crayon Picture Book')
  assert.equal(getMotionStyle('missing-style'), null)
})

test('buildMotionPrompt includes selected style and code-only project requirements', () => {
  const prompt = buildMotionPrompt('watercolor')
  assert.match(prompt, /Watercolor Brush/)
  assert.match(prompt, /===FILE: package\.json===/)
  assert.match(prompt, /voiceoverText/)
  assert.match(prompt, /getAudioDuration/)
  assert.match(prompt, /semua visual wajib dibuat dari kode/i)
  assert.throws(() => buildMotionPrompt('not-a-style'), /tidak dikenal/)
})

test('parseMotionCode reads multiple fenced code files', () => {
  const result = parseMotionCode(sample)
  assert.equal(result.files.length, 5)
  assert.equal(result.files[0].path, 'package.json')
  assert.match(result.files[1].content, /voiceoverText/)
  assert.match(result.files[3].content, /getAudioDuration/)
})

test('parseMotionCode accepts simple FILE markers without equals separators', () => {
  const input = [
    'FILE: package.json',
    fence + 'json',
    '{}',
    fence,
    'FILE: motion.config.json',
    fence + 'json',
    '{"voiceoverText":"Narasi"}',
    fence,
    'FILE: src/index.tsx',
    fence + 'tsx',
    'registerRoot(Root);',
    fence
  ].join('\n')
  assert.equal(parseMotionCode(input).files.length, 3)
})

test('parseMotionCode rejects missing markers, traversal, duplicate paths, and binary assets', () => {
  assert.throws(() => parseMotionCode('const x = 1'), /Marker file tidak ditemukan/)
  assert.throws(() => parseMotionCode(sample.replace('src/index.tsx', '../index.tsx')), /tidak boleh keluar/)
  assert.throws(() => parseMotionCode(sample + '\n===FILE: src/index.tsx===\n' + fence + 'tsx\nagain\n' + fence), /duplikat/)
  assert.throws(() => parseMotionCode(sample + '\n===FILE: public/photo.png===\n' + fence + 'text\nimage\n' + fence), /Aset\/binary/)
})

test('parseMotionCode requires package, motion config, and a source file', () => {
  assert.throws(() => parseMotionCode('===FILE: src/index.tsx===\n' + fence + 'tsx\nregisterRoot(Root)\n' + fence), /package\.json wajib/)
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
