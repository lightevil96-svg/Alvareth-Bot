import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_QA_FRAME_WIDTH,
  MOTION_QA_FRAME_HEIGHT,
  parseFrameRate,
  summarizeMotionFrames,
  runMotionRenderQa
} from '../lib/motion-qa.js';

function makeFrames(values, width = MOTION_QA_FRAME_WIDTH, height = MOTION_QA_FRAME_HEIGHT) {
  const frameBytes = width * height * 3;
  const buffer = Buffer.alloc(frameBytes * values.length);
  values.forEach((value, index) => buffer.fill(value, index * frameBytes, (index + 1) * frameBytes));
  return buffer;
}

function makeVariedFrames(values, width = MOTION_QA_FRAME_WIDTH, height = MOTION_QA_FRAME_HEIGHT) {
  const frameBytes = width * height * 3;
  const buffer = Buffer.alloc(frameBytes * values.length);
  values.forEach((value, index) => {
    const offset = index * frameBytes;
    for (let pixel = 0; pixel < frameBytes; pixel += 3) {
      const variation = pixel % 64;
      buffer[offset + pixel] = Math.min(255, value + variation);
      buffer[offset + pixel + 1] = Math.min(255, value + Math.floor(variation * 0.72));
      buffer[offset + pixel + 2] = Math.min(255, value + Math.floor(variation * 0.48));
    }
  });
  return buffer;
}

test('parseFrameRate handles rational and invalid FPS values', () => {
  assert.equal(parseFrameRate('30/1'), 30);
  assert.equal(parseFrameRate('60000/1001'), 60000 / 1001);
  assert.equal(parseFrameRate('0/0'), 0);
  assert.equal(parseFrameRate(''), 0);
});

test('summarizeMotionFrames detects near-black and frozen samples', () => {
  const report = summarizeMotionFrames(makeFrames([0, 0, 0, 0]));
  assert.equal(report.sampleCount, 4);
  assert.equal(report.blackFrames, 4);
  assert.ok(report.warnings.some(warning => /hitam/i.test(warning)));
  assert.ok(report.warnings.some(warning => /beku/i.test(warning)));
});

test('runMotionRenderQa checks dimensions, FPS, audio and sampled frames', async () => {
  const fakeProbe = {
    streams: [
      { codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '30/1', nb_frames: '30', duration: '1' },
      { codec_type: 'audio', codec_name: 'aac' }
    ],
    format: { duration: '1.0' }
  };
  const fakeFrames = makeVariedFrames([50, 90, 130, 170, 210, 190, 150, 110]);
  const execute = async command => command === 'ffprobe'
    ? { stdout: JSON.stringify(fakeProbe) }
    : { stdout: fakeFrames };
  const report = await runMotionRenderQa('fake.mp4', { execFileImpl: execute });
  assert.equal(report.status, 'passed');
  assert.equal(report.hasAudio, true);
  assert.equal(report.resolution.width, 1080);
  assert.equal(report.fps, 30);
  assert.equal(report.visual.sampleCount, 8);
});

test('runMotionRenderQa returns a non-blocking diagnostic when media tools are unavailable', async () => {
  const report = await runMotionRenderQa('fake.mp4', {
    execFileImpl: async () => { throw new Error('ffprobe missing'); }
  });
  assert.equal(report.status, 'not-run');
  assert.match(report.warnings[0], /ffprobe missing/);
});
