import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReferenceFrameRate,
  summarizeReferenceFrames,
  analyzeReferenceVideo
} from '../lib/motion-engine/reference-analyzer.js';

function makeFrames(values, width = 16, height = 16) {
  const frameBytes = width * height * 3;
  const output = Buffer.alloc(frameBytes * values.length);
  values.forEach((base, frameIndex) => {
    const offset = frameIndex * frameBytes;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = offset + (y * width + x) * 3;
        const variation = (x * 7 + y * 3) % 48;
        const darkSide = x >= Math.floor(width / 2);
        output[index] = darkSide ? 8 : Math.min(255, base + variation);
        output[index + 1] = darkSide ? 8 : Math.min(255, Math.round(base * 0.78 + variation * 0.6));
        output[index + 2] = darkSide ? 8 : Math.min(255, Math.round(base * 0.55 + variation * 0.3));
      }
    }
  });
  return output;
}

test('parseReferenceFrameRate supports rational FPS values and rejects invalid values', () => {
  assert.equal(parseReferenceFrameRate('30/1'), 30);
  assert.equal(parseReferenceFrameRate('60000/1001'), 60000 / 1001);
  assert.equal(parseReferenceFrameRate('0/0'), 0);
  assert.equal(parseReferenceFrameRate(''), 0);
});

test('summarizeReferenceFrames reports palette, ink candidates, edge density and frame motion', () => {
  const report = summarizeReferenceFrames(makeFrames([40, 90, 140, 190]), { width: 16, height: 16 });
  assert.equal(report.sampleCount, 4);
  assert.ok(report.averageLuma > 0);
  assert.ok(report.averageSaturation > 0);
  assert.ok(report.darkInkCandidateRatio >= 0);
  assert.ok(report.edgeDensity > 0);
  assert.ok(report.frameDifference > 0);
  assert.ok(report.dominantPalette.length > 0);
  assert.match(report.captionPlacementCandidate, /upper-biased|lower-biased|mixed-or-undetermined/);
  assert.ok(report.notes.some(note => /human\/vision review/i.test(note)));
});

test('analyzeReferenceVideo extracts sampled frames and returns source metadata', async () => {
  const frameBuffer = makeFrames([60, 120, 180]);
  const fakeProbe = {
    streams: [{
      width: 1080,
      height: 1920,
      avg_frame_rate: '30/1',
      r_frame_rate: '30/1',
      nb_frames: '30'
    }],
    format: { duration: '1.0' }
  };
  const execute = async command => command === 'ffprobe'
    ? { stdout: JSON.stringify(fakeProbe) }
    : { stdout: frameBuffer };
  const report = await analyzeReferenceVideo('/tmp/reference.mp4', {
    execFileImpl: execute,
    width: 16,
    height: 16,
    maxSamples: 3
  });
  assert.equal(report.metadata.width, 1080);
  assert.equal(report.metadata.height, 1920);
  assert.equal(report.metadata.fps, 30);
  assert.equal(report.metadata.durationSeconds, 1);
  assert.equal(report.visual.sampleCount, 3);
  assert.equal(report.sampledFrameIndexes.length, 3);
});

test('analyzeReferenceVideo fails clearly when FFprobe cannot identify a video stream', async () => {
  await assert.rejects(
    analyzeReferenceVideo('/tmp/missing.mp4', {
      execFileImpl: async () => ({ stdout: JSON.stringify({ streams: [] }) })
    }),
    /tidak menemukan stream video/i
  );
});
