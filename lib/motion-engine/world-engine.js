import * as THREE from 'three';
import { createToonMaterial } from './character-engine.js';
import { ALVARETH_STYLE_DNA } from './style-dna.js';

function addWorldMesh(parent, geometry, color, name, options = {}) {
  const mesh = new THREE.Mesh(geometry, options.material || createToonMaterial(color));
  mesh.name = name;
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  if (options.outline) addWorldOutline(mesh, options.outlineColor, options.outlineScale);
  return mesh;
}

export function addWorldOutline(mesh, color = ALVARETH_STYLE_DNA.palette.ink, scale = 1.012) {
  const geometry = mesh.geometry.clone();
  geometry.scale(scale, scale, scale);
  const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false
  }));
  outline.name = mesh.name + '-world-ink';
  outline.renderOrder = 0;
  mesh.renderOrder = 1;
  mesh.add(outline);
  return outline;
}

export function createWorldMaterial(color, options = {}) {
  const material = createToonMaterial(color);
  material.transparent = Boolean(options.transparent);
  material.opacity = Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : 1;
  return material;
}

export function createWorldLighting(scene, options = {}) {
  const mood = String(options.mood || 'warm-day').toLowerCase();
  const cool = /night|cool|moon|blue/.test(mood);
  const hemi = new THREE.HemisphereLight(cool ? 0x9bb7e2 : 0xffe3c3, cool ? 0x26334a : 0x6c513e, 1.15);
  const ambient = new THREE.AmbientLight(cool ? 0x9cb4db : 0xffe2c2, 0.34);
  const key = new THREE.DirectionalLight(cool ? 0xc8dcff : 0xffd4a2, 2.35);
  const fill = new THREE.DirectionalLight(cool ? 0x738dbb : 0xffedcf, 0.58);
  const rim = new THREE.DirectionalLight(cool ? 0x8fa9d6 : 0xffbd82, 0.72);
  key.name = 'Alvareth-Key-Light';
  fill.name = 'Alvareth-Fill-Light';
  rim.name = 'Alvareth-Rim-Light';
  key.position.set(-5, 9, 7);
  fill.position.set(6, 4, -5);
  rim.position.set(0, 6, -8);
  key.castShadow = options.shadows !== false;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.025;
  scene.add(hemi, ambient, key, fill, rim);
  return { hemi, ambient, key, fill, rim };
}

export function createStoryWorld(scene, options = {}) {
  const group = new THREE.Group();
  group.name = 'Alvareth-Story-World';
  const floorColor = options.floorColor || ALVARETH_STYLE_DNA.palette.plaster;
  const backgroundColor = options.backgroundColor || '#BFAE91';
  const fogColor = options.fogColor || backgroundColor;
  const width = Math.max(10, Number(options.width) || 48);
  const depth = Math.max(10, Number(options.depth) || 72);
  const ground = addWorldMesh(
    group,
    new THREE.PlaneGeometry(width, depth),
    floorColor,
    'world-ground'
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = Number(options.groundY) || 0;
  ground.receiveShadow = true;
  scene.background = new THREE.Color(backgroundColor);
  if (options.fog !== false) {
    scene.fog = new THREE.Fog(fogColor, Number(options.fogNear) || 18, Number(options.fogFar) || 100);
  }
  scene.add(group);
  const lights = createWorldLighting(scene, options);
  return { group, ground, lights };
}

export function createBuilding(parent, options = {}) {
  const width = Number(options.width) || 3.2;
  const height = Number(options.height) || 2.8;
  const depth = Number(options.depth) || 2.4;
  const roofHeight = Number(options.roofHeight) || 1.05;
  const group = new THREE.Group();
  group.name = options.name || 'story-building';
  const walls = addWorldMesh(group, new THREE.BoxGeometry(width, height, depth),
    options.wallColor || ALVARETH_STYLE_DNA.palette.plaster, 'building-walls', { outline: true });
  walls.position.y = height / 2;
  const roof = addWorldMesh(group, new THREE.ConeGeometry(Math.max(width, depth) * 0.78, roofHeight, 4),
    options.roofColor || ALVARETH_STYLE_DNA.palette.terracotta, 'building-roof', { outline: true });
  roof.rotation.y = Math.PI / 4;
  roof.position.y = height + roofHeight / 2 - 0.05;
  const door = addWorldMesh(group, new THREE.BoxGeometry(width * 0.2, height * 0.48, 0.09),
    options.doorColor || ALVARETH_STYLE_DNA.palette.wood, 'building-door');
  door.position.set(0, height * 0.24, depth / 2 + 0.05);
  if (options.position) group.position.set(...options.position);
  parent.add(group);
  return group;
}

export function createTree(parent, options = {}) {
  const group = new THREE.Group();
  group.name = options.name || 'story-tree';
  const height = Number(options.height) || 3.2;
  const trunk = addWorldMesh(group, new THREE.CylinderGeometry(0.13, 0.2, height * 0.46, 12),
    options.trunkColor || ALVARETH_STYLE_DNA.palette.wood, 'tree-trunk');
  trunk.position.y = height * 0.23;
  const foliageColor = options.foliageColor || ALVARETH_STYLE_DNA.palette.olive;
  const crown = addWorldMesh(group, new THREE.SphereGeometry(height * 0.31, 20, 16),
    foliageColor, 'tree-crown', { outline: true, outlineScale: 1.018 });
  crown.position.y = height * 0.67;
  const side = addWorldMesh(group, new THREE.SphereGeometry(height * 0.2, 18, 14),
    foliageColor, 'tree-crown-side', { outline: true, outlineScale: 1.018 });
  side.position.set(height * 0.18, height * 0.58, 0.04);
  if (options.position) group.position.set(...options.position);
  parent.add(group);
  return group;
}

export function createWoodenProp(parent, options = {}) {
  const group = new THREE.Group();
  group.name = options.name || 'wooden-prop';
  const width = Number(options.width) || 1.4;
  const height = Number(options.height) || 0.75;
  const depth = Number(options.depth) || 0.8;
  const wood = options.color || ALVARETH_STYLE_DNA.palette.wood;
  const base = addWorldMesh(group, new THREE.BoxGeometry(width, height, depth), wood, 'wooden-prop-body', { outline: true });
  base.position.y = height / 2;
  for (let index = 0; index < 3; index++) {
    const plank = addWorldMesh(group, new THREE.BoxGeometry(width * 0.94, 0.045, depth * 1.02),
      options.plankColor || ALVARETH_STYLE_DNA.palette.ochre, 'wooden-prop-plank-' + index);
    plank.position.set(0, height * (0.28 + index * 0.22), depth * 0.01);
  }
  if (options.position) group.position.set(...options.position);
  parent.add(group);
  return group;
}

export class WorldEngine {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.world = createStoryWorld(scene, options);
  }

  building(options) { return createBuilding(this.world.group, options); }
  tree(options) { return createTree(this.world.group, options); }
  woodenProp(options) { return createWoodenProp(this.world.group, options); }
}
