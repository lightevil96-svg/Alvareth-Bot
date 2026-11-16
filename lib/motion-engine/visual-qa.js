function getGeometryDimensions(geometry) {
  if (!geometry) return null;
  try {
    if (!geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') {
      geometry.computeBoundingBox();
    }
    const box = geometry.boundingBox;
    if (!box?.min || !box?.max) return null;
    return {
      x: Math.abs(Number(box.max.x) - Number(box.min.x)),
      y: Math.abs(Number(box.max.y) - Number(box.min.y)),
      z: Math.abs(Number(box.max.z) - Number(box.min.z))
    };
  } catch {
    return null;
  }
}

function isVolumetricGeometry(geometry) {
  const size = getGeometryDimensions(geometry);
  return Boolean(size && size.x > 1e-4 && size.y > 1e-4 && size.z > 1e-4);
}

function countToonMaterials(material) {
  const materials = Array.isArray(material) ? material : [material];
  return materials.filter(item => item?.isMeshToonMaterial === true).length;
}

export function inspectCharacter3D(character) {
  const report = {
    meshCount: 0,
    volumetricMeshCount: 0,
    flatMeshCount: 0,
    spriteCount: 0,
    planeCount: 0,
    toonMaterialCount: 0,
    outlineCount: 0
  };
  if (!character || typeof character.traverse !== 'function') {
    return { ...report, valid: false, reason: 'Character root is not a Three.js Object3D.' };
  }
  character.traverse(object => {
    if (object.isSprite) report.spriteCount++;
    if (!object.isMesh) return;
    report.meshCount++;
    const geometryType = String(object.geometry?.type || '');
    if (geometryType === 'PlaneGeometry' || geometryType === 'PlaneBufferGeometry') {
      report.planeCount++;
    }
    if (isVolumetricGeometry(object.geometry)) report.volumetricMeshCount++;
    else report.flatMeshCount++;
    report.toonMaterialCount += countToonMaterials(object.material);
    if (String(object.name || '').endsWith('-ink-outline')) report.outlineCount++;
  });
  report.valid =
    report.meshCount >= 8 &&
    report.volumetricMeshCount >= 6 &&
    report.spriteCount === 0 &&
    report.planeCount === 0 &&
    report.toonMaterialCount >= 2 &&
    report.outlineCount >= 1;
  if (!report.valid) {
    report.reason = 'Main character needs volumetric 3D meshes, toon materials and ink outlines; sprites, billboards and flat planes are not accepted.';
  }
  return report;
}

export function createVisualQaReport(options = {}) {
  const scene = options.scene;
  const camera = options.camera;
  const characters = Array.isArray(options.characters) ? options.characters : [];
  const sceneStats = {
    meshCount: 0,
    volumetricMeshCount: 0,
    flatMeshCount: 0,
    lightCount: 0,
    shadowCasters: 0,
    shadowReceivers: 0,
    toonMaterialCount: 0,
    outlineCount: 0
  };
  if (scene?.traverse) {
    scene.traverse(object => {
      if (object.isMesh) {
        sceneStats.meshCount++;
        if (isVolumetricGeometry(object.geometry)) sceneStats.volumetricMeshCount++;
        else sceneStats.flatMeshCount++;
        sceneStats.toonMaterialCount += countToonMaterials(object.material);
        if (String(object.name || '').endsWith('-world-ink')) sceneStats.outlineCount++;
        if (object.castShadow) sceneStats.shadowCasters++;
        if (object.receiveShadow) sceneStats.shadowReceivers++;
      }
      if (object.isLight) sceneStats.lightCount++;
    });
  }
  const characterReports = characters.map(character => inspectCharacter3D(character));
  const checks = [
    {
      id: 'perspective-camera',
      pass: Boolean(camera?.isPerspectiveCamera),
      detail: 'A PerspectiveCamera is required for story depth and cinematic framing.'
    },
    {
      id: 'dimensional-world',
      pass: sceneStats.meshCount >= 8 && sceneStats.volumetricMeshCount >= 6,
      detail: 'The world needs multiple real volumetric meshes, not only a flat backdrop.'
    },
    {
      id: 'world-toon-materials',
      pass: sceneStats.toonMaterialCount >= 2,
      detail: 'Use matte toon/cel materials across the story world.'
    },
    {
      id: 'world-ink-hierarchy',
      pass: sceneStats.outlineCount >= 1,
      detail: 'Add restrained world ink to selected architecture or prop silhouettes.'
    },
    {
      id: 'scene-lighting',
      pass: sceneStats.lightCount >= 2,
      detail: 'Use multiple motivated lights.'
    },
    {
      id: 'grounded-shadows',
      pass: sceneStats.shadowCasters > 0 && sceneStats.shadowReceivers > 0,
      detail: 'Enable cast and receive shadows.'
    },
    {
      id: 'volumetric-characters',
      pass: characterReports.length > 0 && characterReports.every(item => item.valid),
      detail: 'Every main character must use volumetric 3D meshes, toon materials and ink outlines.'
    }
  ];
  const failures = checks.filter(check => !check.pass);
  return {
    status: failures.length ? 'failed' : 'passed',
    scene: sceneStats,
    characters: characterReports,
    checks,
    failures
  };
}

export function assertVisualContract(options = {}) {
  const report = createVisualQaReport(options);
  if (report.status === 'failed') {
    throw new Error('Alvareth Visual QA failed: ' + report.failures.map(item => item.id).join(', '));
  }
  return report;
}
