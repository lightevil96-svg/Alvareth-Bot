import test from 'node:test'
import assert from 'node:assert/strict'
import { getVideoStudioLimits, validateVideoProject } from '../video-studio/validate.js'

test('normalizes a valid vertical video project', () => {
  const project = validateVideoProject({ title: 'Demo', mode: 'professional', ratio: '9:16', fps: 30, scenes: [{ text: 'Scene one', duration: 4, background: '#112233' }, { text: 'Scene two', duration: 3, background: '#445566' }] })
  assert.equal(project.width, 1080)
  assert.equal(project.height, 1920)
  assert.equal(project.durationSeconds, 7)
  assert.equal(project.durationInFrames, 210)
  assert.equal(project.mode, 'professional')
})
test('rejects an empty scene list and invalid duration', () => {
  assert.throws(() => validateVideoProject({ scenes: [] }), /1 sampai 30 scene/)
  assert.throws(() => validateVideoProject({ scenes: [{ text: 'x', duration: 20 }] }), /1–15 detik/)
})
test('rejects unsafe project size and unsupported fps', () => {
  assert.throws(() => validateVideoProject({ fps: 60, scenes: [{ text: 'x' }] }), /FPS/)
  assert.throws(() => validateVideoProject({ scenes: Array.from({ length: 31 }, () => ({ text: 'x' })) }), /1 sampai 30 scene/)
  assert.throws(() => validateVideoProject({ scenes: Array.from({ length: 7 }, () => ({ text: 'x', duration: 15 })) }), /maksimal 90 detik/)
})
test('publishes conservative limits for the first release', () => {
  assert.deepEqual(getVideoStudioLimits(), { ratios: ['9:16', '16:9', '1:1'], fps: [24, 25, 30], maxScenes: 30, maxSceneSeconds: 15, maxDurationSeconds: 90 })
})
