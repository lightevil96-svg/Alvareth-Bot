import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installMotionEngine, MOTION_ENGINE_VERSION } from '../lib/motion-engine/install.js';
import { ALVARETH_STYLE_DNA, cloneStyleDNA, getStyleDNAContract } from '../lib/motion-engine/style-dna.js';
import { inspectCharacter3D, createVisualQaReport, assertVisualContract } from '../lib/motion-engine/visual-qa.js';

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


function fakeMesh(name, { flat = false, toon = true } = {}) {
  const zMin = flat ? 0 : -0.5;
  const zMax = flat ? 0 : 0.5;
  return {
    isMesh: true,
    name,
    geometry: {
      type: flat ? 'PlaneGeometry' : 'BufferGeometry',
      boundingBox: {
        min: { x: -0.5, y: -0.5, z: zMin },
        max: { x: 0.5, y: 0.5, z: zMax }
      }
    },
    material: { isMeshToonMaterial: toon },
    castShadow: true,
    receiveShadow: true
  };
}

function fakeCharacter({ flat = false } = {}) {
  const objects = [];
  for (let index = 0; index < 4; index++) {
    objects.push(fakeMesh('character-part-' + index, { flat, toon: true }));
    objects.push(fakeMesh('character-part-' + index + '-ink-outline', { flat, toon: false }));
  }
  return {
    traverse(callback) {
      callback(this);
      objects.forEach(callback);
    }
  };
}

test('Visual QA rejects flat character cards and accepts volumetric toon meshes with outlines', () => {
  const character = fakeCharacter();
  const report = inspectCharacter3D(character);
  assert.equal(report.valid, true);
  assert.equal(report.volumetricMeshCount, 8);
  assert.equal(report.toonMaterialCount, 4);
  assert.equal(report.outlineCount, 4);

  const flat = inspectCharacter3D(fakeCharacter({ flat: true }));
  assert.equal(flat.valid, false);
  assert.equal(flat.planeCount, 8);
  assert.ok(flat.reason);
});

test('Visual QA requires a dimensional cel-shaded world, motivated lights, shadows and 3D cast', () => {
  const character = fakeCharacter();
  const worldObjects = [
    ...Array.from({ length: 8 }, (_, index) => fakeMesh('world-mesh-' + index, { toon: index < 4 })),
    fakeMesh('wall-world-ink', { toon: false }),
    { isLight: true },
    { isLight: true },
    { isLight: true }
  ];
  const scene = {
    traverse(callback) {
      callback(this);
      worldObjects.forEach(callback);
      character.traverse(object => {
        if (object !== character) callback(object);
      });
    }
  };
  const report = createVisualQaReport({
    scene,
    camera: { isPerspectiveCamera: true },
    characters: [character]
  });
  assert.equal(report.status, 'passed');
  assert.equal(assertVisualContract({
    scene,
    camera: { isPerspectiveCamera: true },
    characters: [character]
  }).status, 'passed');
})
