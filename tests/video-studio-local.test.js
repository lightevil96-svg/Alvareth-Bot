import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { localJson, localServiceUrl } from '../video-studio/local-service.js';
import { resolveRenderTimeout } from '../video-studio/engine/performance.js';
import { buildLocalServiceEnvironment, getLocalVideoServiceConfig, isVoxCPMReady, startLocalVideoServices } from '../video-studio/local-services.js';
import { parseStoryboardInput } from '../video-studio/prompt/storyboard.js';
import { prepareVoiceover } from '../video-studio/media/voiceover.js';
import { prepareVideoMedia } from '../video-studio/media/pipeline.js';
import { buildTimelineTracks } from '../video-studio/engine/timeline.js';
import { validateReviewedWorkflow } from '../video-studio/media/comfyui.js';
import { validateVideoProject } from '../video-studio/validate.js';
import { effect } from '../video-studio/audio-assets.js';
import { SFX_SECONDS } from '../video-studio/engine/sound-design.js';

async function server(t, callback) {
  const service = createServer(callback);
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => service.close(resolve)));
  return 'http://127.0.0.1:' + service.address().port;
}
function env(t, key, value) {
  const old = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => old === undefined ? delete process.env[key] : process.env[key] = old);
}
test('local services expose only VoxCPM2 defaults and validate model health payloads', () => {
  const config = getLocalVideoServiceConfig({});
  assert.equal(config.voxUrl, 'http://127.0.0.1:7861');
  assert.match(config.modelPath, /alvareth-models[\\/]VoxCPM2$/);
  assert.equal(config.autoStart, true);
  assert.equal(config.ollamaUrl, undefined);
  assert.equal(config.ollamaModel, undefined);
  assert.equal(config.ollamaBin, undefined);
  assert.equal(isVoxCPMReady({ provider: 'VoxCPM2', ready: true }), true);
  assert.equal(isVoxCPMReady({ provider: 'VoxCPM2', ready: false }), false);
});

test('VoxCPM health waits for a model that has bound its port but is still loading', async t => {
  let calls = 0;
  const base = await server(t, (_req, res) => {
    calls++;
    res.setHeader('content-type', 'application/json');
    if (calls < 3) {
      res.writeHead(503);
      res.end(JSON.stringify({ provider: 'VoxCPM2', ready: false }));
    } else {
      res.end(JSON.stringify({ provider: 'VoxCPM2', ready: true }));
    }
  });
  const result = await startLocalVideoServices({
    env: { VIDEO_STUDIO_VOXCPM_URL: base },
    services: ['voxcpm'],
    waitMs: 3000,
    start: true
  });
  assert.equal(result.voxcpm.ready, true);
  assert.ok(calls >= 3);
});

test('status-only VoxCPM diagnostics include the previous process exit and private log path', async t => {
  const root = await mkdtemp(join(tmpdir(), 'voxcpm-status-'));
  const modelPath = join(root, 'VoxCPM2');
  const managed = global.__alvarethVideoLocalServices;
  const previous = managed.get('VoxCPM2');
  await mkdir(modelPath, { recursive: true });
  await writeFile(join(modelPath, 'config.json'), JSON.stringify({ architecture: 'voxcpm2' }));
  managed.set('VoxCPM2', { pid: 1234, exitCode: 1, error: null, logPath: join(root, 'voxcpm2.log') });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (previous === undefined) managed.delete('VoxCPM2'); else managed.set('VoxCPM2', previous);
  });
  const result = await startLocalVideoServices({
    env: {
      HOME: root,
      VOXCPM_MODEL_PATH: modelPath,
      VIDEO_STUDIO_VOXCPM_PYTHON: process.execPath,
      VIDEO_STUDIO_VOXCPM_URL: 'http://127.0.0.1:0'
    },
    services: ['voxcpm'],
    waitMs: 0,
    start: false
  });
  assert.match(result.voxcpm.detail, /exit code 1/);
  assert.match(result.voxcpm.detail, /voxcpm2\.log/);
});

test('local service children receive only an allowlisted environment, never bot credentials', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/home/alvareth',
    CUDA_VISIBLE_DEVICES: '0',
    OWNER_NUMBER: '628000000000',
    VIDEO_STUDIO_API_KEY: 'must-not-leak',
    BOT_TOKEN: 'must-not-leak'
  };
  const vox = buildLocalServiceEnvironment('voxcpm', source, { VOXCPM_PORT: '7861' });
  assert.equal(vox.HOME, '/home/alvareth');
  assert.equal(vox.CUDA_VISIBLE_DEVICES, '0');
  assert.equal(vox.VOXCPM_PORT, '7861');
  assert.equal(vox.VIDEO_STUDIO_API_KEY, undefined);
  assert.equal(vox.OWNER_NUMBER, undefined);
  assert.equal(vox.BOT_TOKEN, undefined);
});
test('local policy rejects hosted endpoints, credentials and redirect destinations', () => {
  for (const url of ['https://api.openai.com', 'http://localhost', 'http://127.0.0.1.evil.test', 'http://user:pass@127.0.0.1', 'file:///tmp/x']) assert.throws(() => localServiceUrl(url));
  assert.equal(localServiceUrl('http://127.0.0.1:7861', '/health'), 'http://127.0.0.1:7861/health');
});

test('local inference HTTP requests can wait for a slow response without a deadline', async t => {
  let completed = false;
  let received = null;
  const base = await server(t, (req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      received = { contentLength: req.headers['content-length'], body: JSON.parse(raw) };
      setTimeout(() => {
        completed = true;
        res.end(JSON.stringify({ ready: true }));
      }, 250);
    });
  });
  const startedAt = Date.now();
  const result = await localJson(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Tes tanpa batas waktu' })
  }, null);
  assert.deepEqual(result, { ready: true });
  assert.deepEqual(received.body, { text: 'Tes tanpa batas waktu' });
  assert.equal(Number(received.contentLength), Buffer.byteLength(JSON.stringify({ text: 'Tes tanpa batas waktu' })));
  assert.equal(completed, true);
  assert.ok(Date.now() - startedAt >= 200);
});

test('Remotion frame readiness uses a practically unbounded delayRender timeout', () => {
  assert.equal(resolveRenderTimeout(), 2147000000);
});
test('storyboard parser accepts JSON authored by any external AI without a local inference service', () => {
  const plan = parseStoryboardInput(JSON.stringify({
    schemaVersion: 1,
    sourcePrompt: 'Buat video promosi kopi lokal tanpa musik.',
    title: 'Kopi Lokal',
    category: 'product',
    ratio: '9:16',
    fps: 30,
    targetDurationSeconds: 6,
    musicStyle: 'none',
    captionStyle: 'subtitle',
    scenes: [{
      id: 'scene-01',
      text: 'Kopi lokal pilihan',
      narration: 'Nikmati cita rasa kopi lokal yang diracik dengan sepenuh hati.',
      durationSeconds: 6
    }]
  }));
  assert.equal(plan.title, 'Kopi Lokal');
  assert.equal(plan.sourcePrompt, 'Buat video promosi kopi lokal tanpa musik.');
  assert.equal(plan.musicStyle, 'none');
  assert.equal(plan.scenes.length, 1);
});

test('the published external-AI fox storyboard example matches the runtime schema', () => {
  const guide = readFileSync(new URL('../prompt-remotion.md', import.meta.url), 'utf8');
  const fence = String.fromCharCode(96).repeat(3);
  const blocks = [...guide.matchAll(new RegExp(fence + 'json\\s*([\\s\\S]*?)' + fence, 'gi'))];
  assert.ok(blocks.length >= 2, 'guide should include schema and full example JSON');
  const plan = parseStoryboardInput(blocks.at(-1)[1]);
  assert.equal(plan.title, 'Rumi dan Cahaya Hutan');
  assert.equal(plan.scenes.length, 5);
  assert.equal(plan.targetDurationSeconds, 30);
});

test('storyboard parser rejects plain-language briefs and directs owners to the external-AI JSON guide', () => {
  assert.throws(
    () => parseStoryboardInput('Buat video promosi kopi lokal, tanpa musik.'),
    /JSON storyboard dari model AI/
  );
});

test('voice adapter probes and decodes actual WAV fixture; aligns scenes to integer frames', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voxcpm-contract-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(new URL('../video-studio/remotion/public/generated/contract-test', import.meta.url), { recursive: true, force: true }));
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','48000',join(dir,'fixture.wav')]);
  const bytes = await readFile(join(dir,'fixture.wav'));
  const base = await server(t, (_req, res) => res.end(JSON.stringify({ provider: 'VoxCPM2', audio_base64: bytes.toString('base64'), words: [{ text: 'Halo', start: .1, end: .8 }] })));
  env(t, 'VIDEO_STUDIO_VOXCPM_URL', base);
  const project = validateVideoProject({ fps: 24, voiceSettings: { provider: 'voxcpm2' }, scenes: [{ text: 'Halo', narration: 'Halo', duration: 2.4 }, { text: 'Dua', narration: 'Halo', duration: 2.4 }] });
  const result = await prepareVoiceover(project, 'contract-test');
  assert.equal(result.voiceoverTracks.length, 2);
  assert.equal(result.scenes[1].startSeconds, 58 / 24);
  assert.equal(result.captions[1].words[0].startSeconds, 58 / 24 + .1);
  assert.equal(result.voiceoverTracks[0].durationSeconds, 1);
});
test('required narration fails clearly when VoxCPM2 is missing; explicit silent mode works', async t => {
  env(t, 'VIDEO_STUDIO_VOXCPM_URL', 'http://127.0.0.1:9'); env(t, 'VIDEO_STUDIO_VOICE_REQUIRED', 'true');
  const project = validateVideoProject({ voiceSettings: { provider: 'voxcpm2' }, scenes: [{ text: 'Halo', narration: 'Halo dunia', duration: 3 }] });
  await assert.rejects(prepareVideoMedia(project, 'missing-test'), /VoxCPM2/);
  env(t, 'VIDEO_STUDIO_VOICE_REQUIRED', 'false');
  const silent = await prepareVideoMedia(project, 'missing-test');
  assert.equal(silent.voiceoverTracks.length, 0); assert.match(silent.mediaWarnings.join(' '), /VoxCPM2/);
});
test('audio metadata and all 60 scene tracks survive validation', () => {
  const tracks = Array.from({length:60}, (_, i) => ({src:`generated/job/voice-${i}.wav`,startSeconds:i*2,durationSeconds:1}));
  const project = validateVideoProject({scenes:[{text:'Demo',duration:3}],voiceoverTracks:tracks,musicTrackSrc:'generated/job/music.wav',musicVolume:.12,captionStyle:'subtitle'});
  assert.equal(project.voiceoverTracks.length,60); assert.equal(project.musicVolume,.12); assert.equal(project.captionStyle,'subtitle'); assert.equal(project.musicTrackSrc,'generated/job/music.wav');
});
test('SFX follow actual transition and overlay frame origins with headroom and no cut tails', () => {
  for (const fps of [24,25,30]) {
    const timeline = buildTimelineTracks({ fps, scenes: [{id:'one',duration:3,soundCue:'none'}, {id:'two',duration:3,transition:'wipe',soundCue:'whoosh',notifications:[{delaySeconds:1,durationSeconds:1}],callouts:[{delaySeconds:2.9}]}],voiceoverTracks:[{src:'x.wav',startSeconds:3,durationSeconds:2}] });
    const clip=timeline.videoClips[1];
    assert.equal(timeline.sfxClips[0].startFrame,clip.startFrame);
    assert.equal(timeline.sfxClips[1].startFrame,clip.startFrame+fps);
    assert.equal(timeline.sfxClips.length,2);
    assert.ok(timeline.sfxClips.every(c=>c.volume<=.175 && c.startFrame+c.durationInFrames<=clip.endFrame));
    assert.equal(timeline.musicClips.length,0);
  }
});
test('procedural effects are finite, bounded and fade to zero', () => {
  for (const [cue, seconds] of Object.entries(SFX_SECONDS)) {
    const samples=effect(cue,seconds,11);
    assert.equal(samples.length,Math.floor(seconds*22050));
    assert.ok(samples.every(v=>Number.isFinite(v)&&Math.abs(v)<=.701));
    assert.ok(samples[0] === 0); assert.ok(Math.abs(samples.at(-1))<.01);
  }
});
test('ComfyUI requires reviewed exact bytes and rejects banned model graphs', () => {
  const graph=JSON.stringify({1:{class_type:'WanVideoModelLoader',inputs:{model:'wan2.2.safetensors'}}});
  const hash=createHash('sha256').update(graph).digest('hex');
  assert.throws(()=>validateReviewedWorkflow(graph,''),/diaudit/);
  assert.throws(()=>validateReviewedWorkflow(graph,hash),/dilarang/);
});


test('production output gate rejects mismatched dimensions and corrupt output', async t => {
  const {verifyVideoOutput}=await import('../video-studio/media/verify-output.js');
  const dir=await mkdtemp(join(tmpdir(),'output-gate-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'video.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=1','-c:v','libx264','-pix_fmt','yuv420p',path]);
  const project={width:64,height:64,fps:24,durationInFrames:24,voiceoverTracks:[]};
  assert.equal((await verifyVideoOutput(path,project)).videoCodec,'h264');
  await assert.rejects(verifyVideoOutput(path,{...project,width:1080}),/resolusi/);
  await assert.rejects(verifyVideoOutput(path,{...project,voiceoverTracks:[{}]}),/narasi/);
});