export const ALVARETH_STYLE_DNA = Object.freeze({
  version: '1.0.0',
  references: Object.freeze({
    volumetricCharacter: '390381.mp4',
    inkedStoryWorld: '390306.mp4'
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
    placement: 'flexible lower-middle or upper-safe area, never over faces or key action',
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
    'Combine the rounded 3D character appeal of ' + dna.references.volumetricCharacter +
      ' with the hand-inked cel-shaded world, earthy materials and story direction of ' + dna.references.inkedStoryWorld + '.',
    'Character ink: ' + dna.character.outlineColor + ', approximately ' + dna.character.outlineWidthAt1080 + ' px at 1080x1920.',
    'World: ' + dna.world.representation + '; ' + dna.world.depth + '.',
    'Subtitles: white with dark outline; highlight only the important keyword in ' + dna.subtitles.highlight + '.',
    'Keep this visual grammar fixed while story, cast, costumes, props, locations and mood remain adaptable.'
  ].join('\n');
}
