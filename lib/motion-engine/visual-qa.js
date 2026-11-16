export function inspectCharacter3D(character) {
  const report = { meshCount: 0, spriteCount: 0, planeCount: 0, toonMaterialCount: 0 };
  if (!character || typeof character.traverse !== 'function') {
    return { ...report, valid: false, reason: 'Character root is not a Three.js Object3D.' };
  }
  character.traverse(object => {
    if (object.isSprite) report.spriteCount++;
    if (!object.isMesh) return;
    report.meshCount++;
    if (object.geometry?.type === 'PlaneGeometry' || object.geometry?.type === 'PlaneBufferGeometry') {
      report.planeCount++;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    report.toonMaterialCount += materials.filter(material =>
      material?.isMeshToonMaterial
    ).length;
  });
  report.valid = report.meshCount >= 8 && report.spriteCount === 0 && report.planeCount === 0;
  if (!report.valid) report.reason = 'Main character must be a volumetric mesh rig, not a sprite, billboard or plane.';
  return report;
}

export function createVisualQaReport(options = {}) {
  const scene = options.scene;
  const camera = options.camera;
  const characters = Array.isArray(options.characters) ? options.characters : [];
  const sceneStats = { meshCount: 0, lightCount: 0, shadowCasters: 0, shadowReceivers: 0 };
  if (scene?.traverse) {
    scene.traverse(object => {
      if (object.isMesh) {
        sceneStats.meshCount++;
        if (object.castShadow) sceneStats.shadowCasters++;
        if (object.receiveShadow) sceneStats.shadowReceivers++;
      }
      if (object.isLight) sceneStats.lightCount++;
    });
  }
  const characterReports = characters.map(character => inspectCharacter3D(character));
  const checks = [
    { id: 'perspective-camera', pass: Boolean(camera?.isPerspectiveCamera), detail: 'Perspective camera is required.' },
    { id: 'dimensional-world', pass: sceneStats.meshCount >= 8, detail: 'Expected at least eight real 3D world meshes.' },
    { id: 'scene-lighting', pass: sceneStats.lightCount >= 2, detail: 'Use multiple motivated lights.' },
    { id: 'grounded-shadows', pass: sceneStats.shadowCasters > 0 && sceneStats.shadowReceivers > 0, detail: 'Enable cast and receive shadows.' },
    { id: 'volumetric-characters', pass: characterReports.length > 0 && characterReports.every(item => item.valid), detail: 'Every main character must use real 3D meshes.' }
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
