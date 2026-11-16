import * as THREE from 'three';
import { ALVARETH_STYLE_DNA } from './style-dna.js';

let sharedGradientMap = null;

export function createToonGradientMap() {
  if (sharedGradientMap) return sharedGradientMap;
  const levels = new Uint8Array([62, 142, 224]);
  const texture = new THREE.DataTexture(levels, 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  sharedGradientMap = texture;
  return texture;
}

export function createToonMaterial(color = 0xffffff) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: createToonGradientMap()
  });
}

function addOutline(mesh, color = ALVARETH_STYLE_DNA.palette.ink, scale = 1.035) {
  const geometry = mesh.geometry.clone();
  geometry.scale(scale, scale, scale);
  const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false
  }));
  outline.name = mesh.name + '-ink-outline';
  outline.renderOrder = 0;
  mesh.renderOrder = 1;
  mesh.add(outline);
  return outline;
}

function addMesh(parent, geometry, color, name, options = {}) {
  const mesh = new THREE.Mesh(geometry, options.basic
    ? new THREE.MeshBasicMaterial({ color })
    : createToonMaterial(color));
  mesh.name = name;
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  if (options.outline !== false) addOutline(mesh, options.outlineColor, options.outlineScale);
  return mesh;
}

function addFaceLine(parent, points, name, radius = 0.012) {
  const curve = new THREE.CatmullRomCurve3(points.map(point =>
    new THREE.Vector3(point[0], point[1], point[2])
  ));
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 12, radius, 6, false),
    new THREE.MeshBasicMaterial({ color: ALVARETH_STYLE_DNA.palette.ink })
  );
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function addLimbSegment(parent, name, length, topRadius, bottomRadius, color) {
  const pivot = new THREE.Group();
  pivot.name = name + '-pivot';
  parent.add(pivot);
  const mesh = addMesh(
    pivot,
    new THREE.CylinderGeometry(topRadius, bottomRadius, length, 14, 1, false),
    color,
    name
  );
  mesh.position.y = -length / 2;
  return { pivot, mesh, length };
}

function addJoint(parent, name, radius, color, position) {
  const joint = addMesh(parent, new THREE.SphereGeometry(radius, 16, 12), color, name);
  joint.position.set(position[0], position[1], position[2]);
  return joint;
}

function createMouthVariants(faceGroup) {
  const ink = ALVARETH_STYLE_DNA.palette.ink;
  const variants = {};
  variants.neutral = addFaceLine(faceGroup, [[-0.07, -0.12, 0.46], [0, -0.13, 0.47], [0.07, -0.12, 0.46]], 'mouth-neutral', 0.012);
  variants.smile = addFaceLine(faceGroup, [[-0.08, -0.10, 0.46], [0, -0.16, 0.47], [0.08, -0.10, 0.46]], 'mouth-smile', 0.014);
  variants.frown = addFaceLine(faceGroup, [[-0.08, -0.16, 0.46], [0, -0.10, 0.47], [0.08, -0.16, 0.46]], 'mouth-frown', 0.014);
  variants.open = addMesh(faceGroup, new THREE.SphereGeometry(0.065, 16, 12), ink, 'mouth-open', {
    basic: true, outline: false, castShadow: false, receiveShadow: false
  });
  variants.open.scale.set(0.72, 1.12, 0.18);
  variants.open.position.set(0, -0.13, 0.46);
  for (const [key, mesh] of Object.entries(variants)) mesh.visible = key === 'neutral';
  return variants;
}

export function createCharacter(spec = {}) {
  const colors = {
    skin: spec.skinColor || spec.colors?.skin || ALVARETH_STYLE_DNA.palette.cream,
    outfit: spec.outfitColor || spec.colors?.outfit || '#087E83',
    accent: spec.accentColor || spec.colors?.accent || ALVARETH_STYLE_DNA.palette.gold,
    limb: spec.limbColor || spec.colors?.limb || ALVARETH_STYLE_DNA.palette.ink,
    shoe: spec.shoeColor || spec.colors?.shoe || '#3B302C',
    hair: spec.hairColor || spec.colors?.hair || '#4B2E2A',
    scarf: spec.scarfColor || spec.colors?.scarf || ALVARETH_STYLE_DNA.palette.terracotta
  };

  const root = new THREE.Group();
  root.name = 'AlvarethCharacter-' + String(spec.id || spec.name || 'character');
  root.userData.characterIdentity = {
    id: String(spec.id || spec.name || 'character'),
    name: String(spec.name || 'Character'),
    skinColor: colors.skin,
    outfitColor: colors.outfit,
    accentColor: colors.accent,
    hairColor: colors.hair,
    accessories: Array.isArray(spec.accessories) ? [...spec.accessories] : []
  };
  if (Number.isFinite(Number(spec.scale)) && Number(spec.scale) > 0) {
    root.scale.setScalar(Number(spec.scale));
  }

  const pelvis = new THREE.Group();
  pelvis.name = 'pelvis';
  pelvis.position.y = 0.94;
  root.add(pelvis);

  const torso = addMesh(
    pelvis,
    new THREE.CapsuleGeometry(0.29, 0.43, 6, 16),
    colors.outfit,
    'torso'
  );
  torso.scale.set(0.92, 0.9, 0.72);
  torso.position.y = 0.22;

  const collar = addMesh(
    pelvis,
    new THREE.TorusGeometry(0.19, 0.045, 8, 24),
    colors.accent,
    'collar'
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.57, 0.015);

  if (Array.isArray(spec.accessories) && spec.accessories.includes('scarf')) {
    const scarf = addMesh(pelvis, new THREE.TorusGeometry(0.25, 0.07, 10, 28), colors.scarf, 'scarf');
    scarf.rotation.x = Math.PI / 2;
    scarf.position.set(0, 0.53, 0.025);
  }

  const headPivot = new THREE.Group();
  headPivot.name = 'head-pivot';
  headPivot.position.set(0, 0.88, 0);
  pelvis.add(headPivot);

  const head = addMesh(headPivot, new THREE.SphereGeometry(0.49, 36, 28), colors.skin, 'head');
  head.scale.set(1.06, 1.1, 0.94);

  const hair = addMesh(
    headPivot,
    new THREE.SphereGeometry(0.505, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    colors.hair,
    'hair-cap'
  );
  hair.scale.set(1.04, 0.56, 0.98);
  hair.position.y = 0.27;

  if (spec.hairStyle === 'tuft' || spec.hairStyle === 'spiky') {
    const tuft = addMesh(headPivot, new THREE.ConeGeometry(0.085, 0.2, 10), colors.hair, 'hair-tuft');
    tuft.position.set(0.02, 0.55, 0.015);
    tuft.rotation.z = -0.12;
  }

  const faceGroup = new THREE.Group();
  faceGroup.name = 'face-features';
  headPivot.add(faceGroup);

  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = addMesh(faceGroup, new THREE.SphereGeometry(0.045, 14, 10), ALVARETH_STYLE_DNA.palette.ink,
      side < 0 ? 'eye-left' : 'eye-right', {
        basic: true, outline: false, castShadow: false, receiveShadow: false
      });
    eye.scale.set(0.82, 1.12, 0.42);
    eye.position.set(side * 0.155, 0.045, 0.455);
    eyes.push(eye);

    addFaceLine(faceGroup, [
      [side * 0.155 - 0.055, 0.13, 0.448],
      [side * 0.155, 0.15, 0.458],
      [side * 0.155 + 0.055, 0.13, 0.448]
    ], side < 0 ? 'brow-left' : 'brow-right', 0.014);
  }

  const mouthVariants = createMouthVariants(faceGroup);
  const rig = {
    pelvis,
    torso,
    headPivot,
    eyes,
    mouthVariants,
    leftShoulder: null,
    rightShoulder: null,
    leftElbow: null,
    rightElbow: null,
    leftHip: null,
    rightHip: null,
    leftKnee: null,
    rightKnee: null
  };

  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    const shoulder = new THREE.Group();
    shoulder.name = label + '-shoulder';
    shoulder.position.set(side * 0.3, 0.48, 0);
    pelvis.add(shoulder);
    addJoint(shoulder, label + '-shoulder-joint', 0.085, colors.outfit, [0, 0, 0]);
    const upper = addLimbSegment(shoulder, label + '-upper-arm', 0.34, 0.073, 0.06, colors.limb);
    const elbow = new THREE.Group();
    elbow.name = label + '-elbow';
    elbow.position.y = -0.34;
    shoulder.add(elbow);
    addJoint(elbow, label + '-elbow-joint', 0.055, colors.limb, [0, 0, 0]);
    addLimbSegment(elbow, label + '-forearm', 0.3, 0.06, 0.045, colors.limb);
    const hand = addMesh(elbow, new THREE.SphereGeometry(0.07, 16, 12), colors.skin, label + '-hand');
    hand.position.set(0, -0.34, 0.015);
    rig[label + 'Shoulder'] = shoulder;
    rig[label + 'Elbow'] = elbow;
  }

  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    const hip = new THREE.Group();
    hip.name = label + '-hip';
    hip.position.set(side * 0.15, -0.13, 0);
    pelvis.add(hip);
    addJoint(hip, label + '-hip-joint', 0.075, colors.outfit, [0, 0, 0]);
    addLimbSegment(hip, label + '-thigh', 0.4, 0.085, 0.07, colors.limb);
    const knee = new THREE.Group();
    knee.name = label + '-knee';
    knee.position.y = -0.4;
    hip.add(knee);
    addJoint(knee, label + '-knee-joint', 0.055, colors.limb, [0, 0, 0]);
    addLimbSegment(knee, label + '-shin', 0.37, 0.06, 0.047, colors.limb);
    const foot = addMesh(knee, new THREE.CapsuleGeometry(0.09, 0.18, 4, 10), colors.shoe, label + '-shoe');
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, -0.37, 0.075);
    rig[label + 'Hip'] = hip;
    rig[label + 'Knee'] = knee;
  }

  root.userData.alvarethRig = rig;
  root.userData.isVolumetricCharacter = true;
  setCharacterExpression(root, spec.expression || 'neutral');
  return root;
}

export function applyCharacterPose(character, pose = {}) {
  const rig = character?.userData?.alvarethRig;
  if (!rig) throw new Error('Objek bukan karakter Alvareth 3D yang valid.');
  const assign = (object, axis, value) => {
    if (object && Number.isFinite(Number(value))) object.rotation[axis] = Number(value);
  };
  assign(rig.headPivot, 'x', pose.headPitch);
  assign(rig.headPivot, 'y', pose.headYaw);
  assign(rig.headPivot, 'z', pose.headRoll);
  assign(rig.pelvis, 'x', pose.torsoPitch);
  assign(rig.pelvis, 'y', pose.torsoYaw);
  assign(rig.leftShoulder, 'x', pose.leftArmPitch);
  assign(rig.rightShoulder, 'x', pose.rightArmPitch);
  assign(rig.leftShoulder, 'z', pose.leftArmRoll);
  assign(rig.rightShoulder, 'z', pose.rightArmRoll);
  assign(rig.leftElbow, 'x', pose.leftElbowBend);
  assign(rig.rightElbow, 'x', pose.rightElbowBend);
  assign(rig.leftHip, 'x', pose.leftLegPitch);
  assign(rig.rightHip, 'x', pose.rightLegPitch);
  assign(rig.leftKnee, 'x', pose.leftKneeBend);
  assign(rig.rightKnee, 'x', pose.rightKneeBend);
  if (Number.isFinite(Number(pose.rootY))) character.position.y = Number(pose.rootY);
  if (Number.isFinite(Number(pose.rootX))) character.position.x = Number(pose.rootX);
  if (Number.isFinite(Number(pose.rootZ))) character.position.z = Number(pose.rootZ);
  if (Number.isFinite(Number(pose.rootYaw))) character.rotation.y = Number(pose.rootYaw);
  return character;
}

export function setCharacterExpression(character, expression = 'neutral', options = {}) {
  const rig = character?.userData?.alvarethRig;
  if (!rig) throw new Error('Objek bukan karakter Alvareth 3D yang valid.');
  const key = String(expression || 'neutral').toLowerCase();
  const mouthKey = key === 'happy' ? 'smile'
    : ['sad', 'worried', 'angry'].includes(key) ? 'frown'
      : ['surprised', 'speaking', 'talk'].includes(key) ? 'open' : 'neutral';
  for (const [name, mesh] of Object.entries(rig.mouthVariants)) mesh.visible = name === mouthKey;
  const blink = options.blink === true || key === 'blink';
  for (const eye of rig.eyes) eye.scale.y = blink ? 0.008 : (key === 'squint' ? 0.55 : 1.12);
  return character;
}

export class CharacterEngine {
  constructor() {
    this.characters = new Map();
  }

  create(spec = {}) {
    const character = createCharacter(spec);
    const id = String(spec.id || spec.name || 'character-' + (this.characters.size + 1));
    this.characters.set(id, character);
    return character;
  }

  get(id) {
    return this.characters.get(String(id)) || null;
  }

  pose(id, pose) {
    return applyCharacterPose(this.get(id), pose);
  }

  expression(id, expression, options) {
    return setCharacterExpression(this.get(id), expression, options);
  }

  dispose() {
    for (const character of this.characters.values()) {
      character.traverse(object => {
        if (!object.isMesh) return;
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
        else object.material?.dispose?.();
      });
    }
    this.characters.clear();
  }
}
