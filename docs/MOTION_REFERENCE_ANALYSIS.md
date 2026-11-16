# .motion Reference Analysis — 390381.mp4 and 390306.mp4

This profile records the visual grammar extracted from the two supplied vertical reference clips. It separates observed facts from implementation targets: approximate ratios and outline widths are design starting points, not frame-perfect measurements.

## Source media

| Reference | Duration | Frame rate | Frame size | Primary contribution |
|---|---:|---:|---:|---|
| `390381.mp4` | 59.243 s | 30 fps | 1080×1920 | Rounded volumetric character appeal, matte surfaces, friendly proportions and themed diorama staging |
| `390306.mp4` | 45.024 s | 60 fps | 1080×1920 | Inked character contours, earthy cel-shaded story world, set dressing, dramatic staging and highlighted subtitles |

Both clips use a vertical 9:16 composition. The bot's delivery target remains 1080×1920 at 30 fps; the 60 fps source is not a reason to change the output frame rate.

## Visual findings

### Character design

**390381.mp4**
- Rounded cream-colored head with a compact body and very simple facial marks.
- Friendly, readable silhouette; the head is the dominant shape.
- Teal clothing/body block, warm ochre/orange lower limbs and dark rounded shoes in the sampled mascot.
- Matte, softly shaded surfaces rather than mirror-like plastic.

**390306.mp4**
- Humanlike story characters with oversized rounded heads, small eyes, restrained brows and simple mouths.
- Dark warm-plum/brown contours make the character silhouette and facial features readable at phone size.
- Hair silhouettes and clothing blocks distinguish roles; the same character design is reused across shots.
- Acting is communicated through expression, pose, gaze and shot scale rather than complex facial realism.

**Reusable target:** build the cast from actual volumetric Three.js meshes with attached 3D facial features and articulated pivots. A starting proportion is head/body width ≈1.2 and head/total standing height ≈0.43. These are approximate design targets, not measured ground truth. Do not use sprites, planes, camera-facing billboards or a single flat character image.

### Material, shading and outlines

- Use matte three-tone cel shading on characters and story-critical props.
- Character ink is the strongest graphic feature: dark plum/brown, stable in screen space and readable at 1080×1920. A nominal 4.5 px outline is a starting target only.
- World ink is thinner and selective: architectural silhouettes, prop edges and a few hard creases. Do not outline every polygon, leaf, brick or texture mark.
- Avoid glossy vinyl/plastic highlights, metallic skin, neon palettes and primitive-demo character assemblies.

### Palette and lighting

- Core palette: warm cream, plaster beige, sand, ochre, wood brown, terracotta, muted olive, burgundy and dusty blue.
- Use warm directional key light, soft fill, subtle rim light and grounded cast/contact shadows.
- Lighting mood may shift for night, underwater, storm or interior scenes, but material response and outline hierarchy remain consistent.
- Environment materials should read as wood, plaster, stone, fabric, soil, foliage, water or story-specific surfaces—not generic colored cubes.

### World, props and depth

- The second clip uses a dimensional workshop/story environment with visible beams, furniture, tools and foreground obstructions.
- Use real geometry for architecture, furniture, terrain, vehicles and story props. Give sets plausible scale, contact points, foreground/midground/background separation, perspective and occlusion.
- Keep story locations flexible. Do not carry over the reference workshop, blacksmith, hammer or exact plot unless the new brief calls for them.

### Camera, acting and composition

- Use motivated establishing-wide, medium-action/two-shot, close-up-reaction and prop-insert coverage.
- Push, track, pan or orbit only when the story beat benefits; avoid random drift and repetitive zoom.
- Stage readable anticipation → action → consequence/reaction → settle beats.
- Maintain prop and character continuity across cuts. Feet should feel grounded; hands should meet the correct prop anchor.
- Keep faces, hands and critical action inside the 9:16 safe crop.

### Subtitles

- Bold white Indonesian text with a dark outline/shadow.
- Highlight one important spoken keyword in warm yellow `#FFD93D`.
- The first clip uses lower explanatory captions; the second often places captions in the upper region. Choose upper or lower safe placement per shot instead of fixing every caption to one band.
- Avoid a permanent rounded lower-third panel, logo, watermark or decorative strip unless the brief explicitly requests promo graphics.

## Reference Analyzer

Run the reusable frame-metric analyzer on local reference files:

```bash
npm run motion:analyze-reference -- /path/to/390381.mp4 /path/to/390306.mp4
```

The analyzer uses FFprobe/FFmpeg to sample representative frames and reports metadata, dominant color candidates, luminance/contrast, warmth/saturation, dark-pixel and edge-density candidates, frame-to-frame change, and likely upper/lower caption bands. These are measurable visual clues only. It does **not** identify characters, understand prop meaning, measure exact outline thickness or infer camera intent. Those semantic findings remain part of this reviewed profile and must be checked visually.

## Reference repository and license review

- `4mJ0k3r/3d-animation`: no root LICENSE file or SPDX license metadata was present in the inspected repository. Its technical organization and 3D staging ideas were studied; source code was not copied.
- `4mJ0k3r/remotionshorts`: no root LICENSE file or SPDX license metadata was present in the inspected repository. Its visual-contract, acting, camera and QA practices were studied; source code was not copied.
- `mromidev/claude-animated-shorts`: the repository includes an MIT license. Its skill is based on 2D character cards/billboards and has unrelated output constraints, so no code was copied and that character representation was not adopted.

The Alvareth engine is independently authored for the repository's Remotion 4.0.534, React 18.3.1 and Three.js 0.170.0 stack.

## Acceptance limits

Passing code tests or automated frame metrics does not prove reference fidelity. Final acceptance requires real renders of different story genres, visual inspection of representative frames and motion, and comparison against these two source clips. Exact 100% pixel identity across arbitrary new stories is not a realistic guarantee; the goal is stable, measurable visual grammar with story-specific content.
