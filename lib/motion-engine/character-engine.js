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

export function createOrganicHeadGeometry(options = {}) {
  const source = new THREE.SphereGeometry(1, 40, 28);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', source.attributes.position.clone());
  geometry.setAttribute('uv', source.attributes.uv.clone());
  geometry.setIndex(source.index.clone());
  const positions = geometry.attributes.position;
  const jawTaper = Number.isFinite(Number(options.jawTaper))
    ? THREE.MathUtils.clamp(Number(options.jawTaper), 0, 0.32)
    : 0.18;
  const cheekBulge = Number.isFinite(Number(options.cheekBulge))
    ? THREE.MathUtils.clamp(Number(options.cheekBulge), 0, 0.09)
    : 0.035;

  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const lowerFace = Math.max(0, -y);
    const jaw = 1 - jawTaper * Math.pow(lowerFace, 1.25);
    const cheek = Math.exp(-(
      Math.pow(Math.abs(x) - 0.56, 2) * 18 +
      Math.pow(y + 0.18, 2) * 24
    )) * cheekBulge;
    const forehead = y > 0.25 ? 1 + (y - 0.25) * 0.025 : 1;
    positions.setXYZ(
      index,
      x * jaw * forehead + Math.sign(x) * cheek,
      y * (1 + 0.018 * (1 - Math.abs(y))),
      z * (1 + 0.025 * Math.max(0, y))
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  source.dispose();
  return geometry;
}

export function createTunicGeometry(style = 'tunic') {
  const profiles = {
    tunic: [[0, -0.34], [0.17, -0.34], [0.25, -0.30], [0.30, -0.16], [0.31, 0.03], [0.27, 0.21], [0.21, 0.33], [0.12, 0.38], [0, 0.38]],
    robe: [[0, -0.38], [0.18, -0.38], [0.29, -0.33], [0.35, -0.15], [0.32, 0.08], [0.27, 0.25], [0.22, 0.34], [0.12, 0.39], [0, 0.39]],
    shirt: [[0, -0.30], [0.16, -0.30], [0.23, -0.26], [0.26, -0.08], [0.27, 0.12], [0.25, 0.26], [0.19, 0.34], [0.11, 0.36], [0, 0.36]],
    coat: [[0, -0.36], [0.18, -0.36], [0.27, -0.31], [0.32, -0.12], [0.33, 0.12], [0.29, 0.29], [0.23, 0.37], [0.12, 0.40], [0, 0.40]],
    dress: [[0, -0.40], [0.18, -0.40], [0.31, -0.34], [0.37, -0.12], [0.31, 0.10], [0.26, 0.25], [0.21, 0.34], [0.12, 0.38], [0, 0.38]]
  };
  const profile = profiles[String(style || 'tunic').toLowerCase()] || profiles.tunic;
  return new THREE.LatheGeometry(profile.map(([radius, y]) => new THREE.Vector2(radius, y)), 32);
}

export function createTaperedLimbGeometry(length, topRadius, bottomRadius, options = {}) {
  const radialSegments = Math.max(8, Math.floor(Number(options.radialSegments) || 14));
  const tubularSegments = Math.max(6, Math.floor(Number(options.tubularSegments) || 12));
  const positions = [];
  const indices = [];
  const stride = radialSegments + 1;

  for (let ring = 0; ring <= tubularSegments; ring++) {
    const t = ring / tubularSegments;
    const radius = topRadius * (1 - t) + bottomRadius * t +
      Math.sin(Math.PI * t) * Math.min(topRadius, bottomRadius) * 0.12;
    const curveX = Math.sin(t * Math.PI) * Number(options.curveX || 0);
    const curveZ = Math.sin(t * Math.PI) * Number(options.curveZ || 0);
    for (let side = 0; side <= radialSegments; side++) {
      const angle = (side / radialSegments) * Math.PI * 2;
      positions.push(
        curveX + Math.cos(angle) * radius,
        -length * t,
        curveZ + Math.sin(angle) * radius
      );
    }
  }

  for (let ring = 0; ring < tubularSegments; ring++) {
    for (let side = 0; side < radialSegments; side++) {
      const a = ring * stride + side;
      const b = (ring + 1) * stride + side;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
    createTaperedLimbGeometry(length, topRadius, bottomRadius, {
      curveX: name.includes('arm') ? 0.012 : 0.004,
      curveZ: 0.008
    }),
    color,
    name
  );
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
    accessories: Array.isArray(spec.accessories) ? [...spec.accessories] : [],
    outfitStyle: String(spec.outfitStyle || 'tunic'),
    hairStyle: String(spec.hairStyle || 'short'),
    headShape: String(spec.headShape || 'rounded')
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
    createTunicGeometry(spec.outfitStyle || 'tunic'),
    colors.outfit,
    'torso'
  );
  const bodyScale = Number.isFinite(Number(spec.bodyScale)) && Number(spec.bodyScale) > 0
    ? THREE.MathUtils.clamp(Number(spec.bodyScale), 0.75, 1.35)
    : 1;
  torso.scale.set(0.92 * bodyScale, 0.9, 0.72 * bodyScale);
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

  const headShape = String(spec.headShape || 'rounded').toLowerCase();
  const head = addMesh(
    headPivot,
    createOrganicHeadGeometry({
      jawTaper: headShape === 'oval' ? 0.12 : headShape === 'round' ? 0.08 : 0.18,
      cheekBulge: headShape === 'round' ? 0.045 : 0.035
    }),
    colors.skin,
    'head'
  );
  head.scale.set(0.49 * 1.06, 0.49 * 1.1, 0.49 * 0.94);
  const headScale = Number.isFinite(Number(spec.headScale)) && Number(spec.headScale) > 0
    ? THREE.MathUtils.clamp(Number(spec.headScale), 0.82, 1.22)
    : 1;
  headPivot.scale.setScalar(headScale);

  const hair = addMesh(
    headPivot,
    new THREE.SphereGeometry(0.505, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    colors.hair,
    'hair-cap'
  );
  hair.scale.set(1.04, 0.56, 0.98);
  hair.position.y = 0.27;

  if (['tuft', 'spiky', 'side-swept'].includes(spec.hairStyle)) {
    const tuft = addMesh(headPivot, new THREE.ConeGeometry(0.085, 0.2, 10), colors.hair, 'hair-tuft');
    tuft.position.set(spec.hairStyle === 'side-swept' ? 0.14 : 0.02, 0.55, 0.015);
    tuft.rotation.z = spec.hairStyle === 'side-swept' ? -0.55 : -0.12;
  }
  if (spec.hairStyle === 'bun') {
    const bun = addMesh(headPivot, new THREE.SphereGeometry(0.17, 18, 14), colors.hair, 'hair-bun');
    bun.position.set(0, 0.43, -0.26);
  }
  if (spec.hairStyle === 'long') {
    for (const side of [-1, 1]) {
      const lock = addMesh(headPivot, new THREE.CapsuleGeometry(0.095, 0.42, 4, 10), colors.hair,
        side < 0 ? 'hair-lock-left' : 'hair-lock-right');
      lock.position.set(side * 0.36, -0.16, -0.02);
      lock.rotation.z = side * -0.08;
    }
  }

  const faceGroup = new THREE.Group();
  faceGroup.name = 'face-features';
  headPivot.add(faceGroup);

  const eyes = [];
  const brows = [];
  for (const side of [-1, 1]) {
    const eye = addMesh(faceGroup, new THREE.SphereGeometry(0.045, 14, 10), ALVARETH_STYLE_DNA.palette.ink,
      side < 0 ? 'eye-left' : 'eye-right', {
        basic: true, outline: false, castShadow: false, receiveShadow: false
      });
    eye.scale.set(0.82, 1.12, 0.42);
    eye.position.set(side * 0.155, 0.045, 0.455);
    eyes.push(eye);

    const brow = addFaceLine(faceGroup, [
      [side * 0.155 - 0.055, 0.13, 0.448],
      [side * 0.155, 0.15, 0.458],
      [side * 0.155 + 0.055, 0.13, 0.448]
    ], side < 0 ? 'brow-left' : 'brow-right', 0.014);
    brows.push(brow);
  }

  const mouthVariants = createMouthVariants(faceGroup);
  const rig = {
    pelvis,
    torso,
    headPivot,
    eyes,
    brows,
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
    rig[label + 'Hand'] = hand;
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
  const squint = ['squint', 'angry'].includes(key);
  const widen = key === 'surprised';
  for (const eye of rig.eyes) {
    eye.scale.y = blink ? 0.008 : squint ? 0.55 : widen ? 1.38 : 1.12;
  }
  const browTilt = key === 'angry' ? -0.22 : ['sad', 'worried'].includes(key) ? 0.18 : 0;
  for (let index = 0; index < (rig.brows || []).length; index++) {
    rig.brows[index].rotation.z = index === 0 ? browTilt : -browTilt;
  }
  return character;
}

export function getCharacterAnchor(character, anchorName) {
  const rig = character?.userData?.alvarethRig;
  const anchor = rig?.[String(anchorName || '')];
  return anchor?.isObject3D ? anchor : null;
}

export function attachCharacterProp(character, side, prop, offset = {}) {
  const key = String(side || '').toLowerCase();
  if (!['left', 'right'].includes(key)) throw new Error('Sisi tangan harus left atau right.');
  if (!prop?.isObject3D) throw new Error('Properti harus berupa Three.js Object3D.');
  const hand = getCharacterAnchor(character, key + 'Hand');
  if (!hand) throw new Error('Anchor tangan karakter tidak ditemukan.');
  hand.add(prop);
  prop.position.set(
    Number(offset.x) || 0,
    Number(offset.y) || 0,
    Number(offset.z) || 0
  );
  if (Array.isArray(offset.rotation) && offset.rotation.length === 3) {
    prop.rotation.set(Number(offset.rotation[0]) || 0, Number(offset.rotation[1]) || 0, Number(offset.rotation[2]) || 0);
  }
  return prop;
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

  attachProp(id, side, prop, offset) {
    return attachCharacterProp(this.get(id), side, prop, offset);
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
