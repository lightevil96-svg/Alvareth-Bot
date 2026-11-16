export const ALVARETH_STYLE_DNA = Object.freeze({
  version: '1.0.0',
  references: Object.freeze({
    volumetricCharacter: '390381.mp4',
    inkedStoryWorld: '390306.mp4'
  }),
  referenceAnalysis: Object.freeze({
    volumetricCharacter: Object.freeze({
      durationSeconds: 59.243,
      fps: 30,
      resolution: '1080x1920',
      observedFeatures: [
        'rounded cream-colored head and compact body',
        'simple small facial features and a clear silhouette',
        'matte soft surfaces with warm directional light',
        'themed diorama environments with restrained props'
      ]
    }),
    inkedStoryWorld: Object.freeze({
      durationSeconds: 45.024,
      fps: 60,
      resolution: '1080x1920',
      observedFeatures: [
        'oversized rounded heads, simple brows/eyes/mouth and dark plum-brown contours',
        'earthy wood, plaster, stone and fabric materials',
        'selective cel shading, grounded shadows and layered set dressing',
        'motivated wide, medium, close-up and prop-insert coverage',
        'bold white subtitles with yellow keyword emphasis and dark outline'
      ]
    }),
    synthesis: 'Use true volumetric mesh characters with the rounded proportions of the first clip and the restrained ink/cel-shaded story direction of the second; do not copy either clip\'s plot, exact cast or props.',
    semanticProfile: Object.freeze({
      character: Object.freeze({
        silhouette: 'Friendly humanlike cast with oversized rounded heads, compact torsos and readable hand/foot shapes.',
        proportions: Object.freeze({ headToBodyWidthRatio: 1.2, headToTotalHeightRatio: 0.43 }),
        face: 'Small dark eyes, restrained curved brows and simple expressive mouth meshes; expression changes must be visible at phone scale.'
      }),
      materialsAndShading: Object.freeze({
        character: 'Matte clay-like skin and fabric response; no mirror gloss.',
        world: 'Readable wood, plaster, stone, soil, foliage and story-specific surfaces.',
        shading: 'Three-tone cel shading with a soft warm key and controlled fill.'
      }),
      outline: Object.freeze({
        character: 'Strong dark plum/brown silhouette and facial contours.',
        world: 'Thinner selective contours on important props and architecture only.',
        approximateWidthAt1080: 4.5
      }),
      palette: Object.freeze(['warm cream', 'plaster beige', 'sand', 'ochre', 'wood brown', 'terracotta', 'muted olive', 'burgundy', 'dusty blue']),
      lightingAndShadows: 'Warm directional key, soft fill, subtle rim, contact shadows and grounded cast shadows; adapt color temperature to scene mood.',
      environmentAndProps: 'Layered 3D sets with foreground, midground and background, plausible scale, occlusion, furniture, architecture and story-critical props.',
      camera: 'Vertical 9:16 coverage with motivated establishing wides, medium action, close-up reactions and prop inserts; controlled push, track, pan or orbit.',
      actingAndMotion: 'Readable anticipation, action, consequence and settle; expressive gaze, brows, mouth, head turns and articulated hand/foot poses.',
      subtitles: Object.freeze({
        typography: 'Bold white subtitle text with dark outline or shadow.',
        emphasisColor: '#FFD93D',
        placement: 'Adaptive upper/lower safe area, never covering faces or essential action.'
      }),
      composition: 'Phone-first vertical framing, clean silhouette separation, controlled depth layers and no unnecessary title cards, watermark or permanent lower-third panel.'
    })
  }),
  composition: Object.freeze({ width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' }),
  palette: Object.freeze({
    ink: '#2A1C2A',
    cream: '#F3DDAF',
    plaster: '#CDBB9C',
    sand: '#D9C49F',
    ochre: '#B98745',
    wood: '#70472F',
    terracotta: '#A95F45',
    olive: '#77805A',
    burgundy: '#71384A',
    dustyBlue: '#668B9A',
    gold: '#E7B84D',
    subtitleWhite: '#FFFFFF',
    subtitleYellow: '#FFD93D'
  }),
  character: Object.freeze({
    representation: 'volumetric-three-js-meshes',
    silhouette: 'rounded expressive head, compact organic torso, tapered articulated limbs',
    shading: 'matte three-tone cel shading',
    headToBodyWidthRatio: 1.2,
    headToTotalHeightRatio: 0.43,
    outlineColor: '#2A1C2A',
    outlineWidthAt1080: 4.5,
    face: 'small readable eyes, brows and mouth built from attached 3D meshes',
    identity: 'stable character sheet, proportions, colors, outfit and accessories across every scene'
  }),
  world: Object.freeze({
    representation: 'true-three-dimensional-geometry',
    materials: 'matte painterly toon materials with restrained surface detail',
    depth: 'foreground, midground, background, perspective, occlusion and contact shadows',
    outlines: 'thin subordinate ink on selected architectural and prop silhouettes'
  }),
  lighting: Object.freeze({
    key: 'warm directional key light',
    fill: 'soft ambient and cool/warm fill',
    rim: 'subtle motivated rim light',
    shadows: 'soft grounded cast and contact shadows'
  }),
  camera: Object.freeze({
    coverage: ['establishing-wide', 'medium-action', 'close-up-reaction', 'prop-insert'],
    movement: ['motivated-dolly', 'tracking', 'pan', 'orbit', 'gentle-push'],
    rule: 'camera changes follow story beats; no random drift or repetitive zoom'
  }),
  subtitles: Object.freeze({
    fill: '#FFFFFF',
    outline: '#211923',
    highlight: '#FFD93D',
    placement: 'flexible upper or lower safe area, chosen per shot and never over faces or key action',
    panel: 'optional for explanatory/promo beats; story captions default to clean outlined text'
  })
});

export function cloneStyleDNA() {
  return JSON.parse(JSON.stringify(ALVARETH_STYLE_DNA));
}

export function getStyleDNAContract() {
  const dna = ALVARETH_STYLE_DNA;
  return [
    'ALVARETH STYLE DNA ' + dna.version,
    'Characters are volumetric Three.js mesh rigs, never 2D cards, sprites or billboards.',
    'Reference character proportions: head/body width ratio about ' + dna.character.headToBodyWidthRatio + '; head/total-height ratio about ' + dna.character.headToTotalHeightRatio + '.',
    'Reference synthesis: ' + dna.referenceAnalysis.synthesis,
    'Combine the rounded 3D character appeal of ' + dna.references.volumetricCharacter +
      ' with the hand-inked cel-shaded world, earthy materials and story direction of ' + dna.references.inkedStoryWorld + '.',
    'Character ink: ' + dna.character.outlineColor + ', approximately ' + dna.character.outlineWidthAt1080 + ' px at 1080x1920.',
    'World: ' + dna.world.representation + '; ' + dna.world.depth + '.',
    'Subtitles: white with dark outline; highlight only the important keyword in ' + dna.subtitles.highlight + '.',
    'Keep this visual grammar fixed while story, cast, costumes, props, locations and mood remain adaptable.'
  ].join('\n');
}
