import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installMotionEngine, MOTION_ENGINE_VERSION } from '../lib/motion-engine/install.js';
import { ALVARETH_STYLE_DNA, cloneStyleDNA, getStyleDNAContract } from '../lib/motion-engine/style-dna.js';

test('Style DNA combines volumetric characters with inked 3D story worlds', () => {
  assert.equal(ALVARETH_STYLE_DNA.character.representation, 'volumetric-three-js-meshes');
  assert.equal(ALVARETH_STYLE_DNA.world.representation, 'true-three-dimensional-geometry');
  assert.match(getStyleDNAContract(), /390381\.mp4/);
  assert.match(getStyleDNAContract(), /390306\.mp4/);
  assert.notEqual(cloneStyleDNA(), ALVARETH_STYLE_DNA);
});

test('installMotionEngine injects the canonical runtime into a Remotion project', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'alvareth-engine-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  const result = await installMotionEngine(root);
  assert.equal(result.version, MOTION_ENGINE_VERSION);
  assert.equal(result.directory, 'src/alvareth-engine');
  const names = await readdir(path.join(root, result.directory));
  assert.ok(names.includes('character-engine.js'));
  assert.ok(names.includes('world-engine.js'));
  assert.ok(names.includes('motion-engine.js'));
  assert.ok(names.includes('camera-engine.js'));
  assert.ok(names.includes('visual-qa.js'));
  const entry = await readFile(path.join(root, result.directory, 'index.js'), 'utf8');
  assert.match(entry, /character-engine\.js/);
  assert.match(entry, /visual-qa\.js/);
});

test('installMotionEngine refuses to overwrite a project-provided engine directory', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'alvareth-engine-conflict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'src', 'alvareth-engine');
  await mkdir(target, { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(target, 'untrusted.js'), 'export const bad = true;');
  await assert.rejects(installMotionEngine(root), /tidak boleh menyertakan|memasang engine resmi/i);
});
