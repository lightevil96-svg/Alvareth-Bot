---
name: storybook-3d-reference
description: Produce reference-matched Stylized 3D Story Animation for Alvareth Bot using volumetric Three.js characters, articulated rigs, matte cel shading, selective ink outlines, dimensional story worlds and frame-synchronized cinematic direction.
---

# Alvareth Reference-Matched True 3D Story Animation

## Purpose

Create vertical story animation that preserves the visual grammar of the two supplied references while allowing the cast, plot, costume, props, location and mood to change for every new story.

- `390381.mp4` contributes rounded volumetric character appeal, friendly proportions, matte surfaces and clean silhouette design.
- `390306.mp4` contributes the hand-inked storybook look, earthy cel-shaded world, layered environments, motivated camera coverage, acting beats and white/yellow subtitles.

The synthesis is **true volumetric 3D characters inside a true 3D world**. Do not turn the characters into SVG cards, image planes, sprites, cutouts or camera-facing billboards. Do not silently fall back to a 2D character when rigging becomes difficult.

Read `docs/MOTION_REFERENCE_ANALYSIS.md` for the reviewed reference profile. The canonical Style DNA is injected into the production prompt and is also available in the engine at `src/alvareth-engine/index.js`.

## 1. Non-negotiable visual contract

- Portrait composition: respect the project config; default target is 9:16 at 1080×1920 and 30 fps.
- Characters: real Three.js meshes with volume, attached 3D face features, articulated pivots, stable silhouette and consistent identity across shots.
- World: actual 3D architecture, terrain, furniture, props, foliage and foreground/midground/background depth.
- Shading: matte three-tone cel shading with warm, controlled lighting.
- Ink: dark warm-plum/brown character contours; thinner, selective world outlines.
- Acting: readable anticipation → action → consequence/reaction → settle.
- Camera: motivated establishing wide, medium action, close-up reaction and prop-insert shots.
- Subtitles: bold white text with dark outline/shadow and a yellow keyword highlight; use an upper or lower safe area per shot.
- Adapt story content freely without changing the visual DNA.

## 2. Reference analysis before building

Use the supplied visual profile as the baseline. When a new reference clip is explicitly supplied, inspect representative frames and record:

1. Character head/body proportions, head silhouette, face layout, hair, clothing, limb thickness, hands and feet.
2. Material response, cel-shading bands, character/world outline hierarchy and approximate outline thickness.
3. Dominant palette, lighting direction, shadow softness, contrast and atmosphere.
4. Architecture, furniture, set dressing, prop scale, contact points and depth layers.
5. Camera height, FOV, shot scale, camera motion and cut rhythm.
6. Acting beats, gaze, facial expression, gesture size and held poses.
7. Subtitle font weight, outline, keyword color, line count, safe margin and vertical placement.

Do not copy the reference plot, exact character identity, brand marks or unique props unless the new story asks for them. Distinguish observed facts from estimates.

## 3. Character Engine — volumetric meshes only

The bot injects the canonical engine into `src/alvareth-engine/`. Import and use it; do not replace it or create a competing character system.

Required APIs:
- `createCharacter(spec)`
- `applyCharacterPose(character, pose)`
- `setCharacterExpression(character, expression)`
- `getCharacterAnchor(character, anchorName)`
- `attachCharacterProp(character, side, object, offset)`

Create each character once and keep the same object, identity and material choices across every scene. Do not rebuild the character on every frame.

### Character specification

Choose story-appropriate values for:
- `id`, `name`
- `skinColor`, `outfitColor`, `accentColor`, `hairColor`, `shoeColor`, `limbColor`
- `headShape`: `rounded`, `round` or `oval`
- `headScale`: approximately 0.82–1.22
- `bodyScale`: approximately 0.75–1.35
- `outfitStyle`: `tunic`, `robe`, `shirt`, `coat` or `dress`
- `hairStyle`: `short`, `tuft`, `spiky`, `side-swept`, `bun` or `long`
- `accessories` and initial `expression`

Use the engine's organic deformed head mesh, LatheGeometry outfit profiles and tapered limb geometry as the base. Add story-specific geometry where needed: hats, armor, coats, jewelry, tools, bags, uniforms or other costume details. Keep each character recognizably distinct without breaking the shared silhouette language.

### Face and expression

Use small readable eyes, expressive brows and attached 3D mouth geometry. At minimum, vary neutral, happy, sad, worried, angry, surprised and speaking expressions when the script calls for them. Expressions must be synchronized to the narration and shot timing, not randomized.

### Rigging and held props

Animate the head, shoulders, elbows, hips and knees through `applyCharacterPose`. Use `getCharacterAnchor` and `attachCharacterProp` so a hand-held object follows the correct hand. Props must meet the hand at the grip point and remain consistent across cuts. Feet must remain grounded during planted poses.

## 4. World Engine — story-specific 3D environments

Required APIs:
- `createStoryWorld(scene, options)`
- `createWorldLighting(scene, options)`
- `createBuilding(parent, options)`
- `createTree(parent, options)`
- `createWoodenProp(parent, options)`

Use these helpers as foundations, then add custom geometry for the specific story. A world is not complete when it contains only a floor, sky color and a few generic cubes.

Build:
- believable architecture with thickness, openings, frames, roof shapes and floor/wall intersections;
- furniture and set dressing with plausible scale and contact points;
- story-critical props with stable shape, material and grip/contact anchors;
- foreground occluders, midground action and distant background layers;
- ground contact, perspective, occlusion and parallax.

Use material choices that read as wood, plaster, stone, fabric, soil, foliage, water or other story-specific surfaces. Avoid generic colored primitives as finished assets. Primitive geometry may be used as a construction base only when it is shaped, combined and detailed into a deliberate form.

## 5. Motion Engine — deterministic acting

Required APIs:
- `createMotionEngine(options)`
- `createWalkPose(frame, options)`
- `sampleKeyframes(frame, keyframes)`

All animation must be deterministic from the current Remotion frame. Do not use timers, random values, browser animation loops or wall-clock time.

Stage each important beat:
1. anticipation and gaze/weight shift;
2. action with clear body mechanics;
3. consequence or reaction;
4. settle or held pose.

Use varied gestures, walk cycles, head turns, arm poses and facial expressions. Avoid continuous whole-body bobbing, repeated generic waving and random per-frame outline wobble.

## 6. Camera Engine — motivated cinematic coverage

Required APIs:
- `applyCinematicCamera(camera, frame, keyframes)`
- `fitCameraToSubjects(camera, subjects, options)`

Use a perspective camera and frame-based camera keyframes. Plan coverage around story beats:
- establishing wide to establish location and spatial relationships;
- medium/two-shot for interaction;
- close-up for emotional reaction;
- prop insert when an object drives the story.

Use dolly, tracking, pan, orbit or gentle push only when motivated. Keep camera movement smooth and purposeful. Do not hide weak staging with constant zooming. Keep faces, hands, subtitles and critical props inside the portrait safe area.

## 7. ThreeCanvas and Remotion synchronization

Render the main visual scene through `ThreeCanvas` from `@remotion/three` with React Three Fiber. Use `useCurrentFrame()` and `useVideoConfig()` to derive all character, object and camera transforms from the current frame. Enable WebGL shadows and antialiasing as supported by the project renderer.

Create static geometry and character rigs once (for example with `useMemo`); update their transforms and expressions from the current frame. Do not recreate geometry every frame. Keep DOM subtitle overlays outside the ThreeCanvas, but never use DOM/image planes as substitutes for the main characters or story world.

## 8. Lighting, material and outline hierarchy

- Use `MeshToonMaterial` or the engine's toon material helper for character and story-critical world meshes.
- Use three readable tonal bands; avoid glossy plastic, mirror highlights, metallic skin and neon saturation.
- Use a warm directional key, soft fill and restrained rim light; adapt temperature for night, underwater, storm or interior scenes.
- Enable cast and receive shadows; keep contact shadows beneath feet and props.
- Character ink is the strongest contour. World ink is thinner and selective.
- Keep outline color dark warm plum/brown. Do not outline every leaf, brick, polygon or texture mark.

## 9. Subtitles and composition

- Use bold, highly legible Indonesian subtitles.
- Main text is white with a dark outline or shadow.
- Highlight one important keyword in `#FFD93D`.
- Use an adaptive upper/lower safe area according to the shot; never cover a face, hand interaction or critical prop.
- Avoid permanent lower-third panels, logo plates, watermarks and decorative title cards unless the brief explicitly asks for promo graphics.
- Preserve readable negative space and clear silhouette separation on a phone screen.

## 10. Visual Quality Assurance — must pass

Call `assertVisualContract({ scene, camera, characters })` after scene assembly and before final rendering. Fix failures; never disable or bypass the checks.

The contract verifies:
- volumetric character meshes, not sprites, planes or billboards;
- toon materials and ink outlines on the cast;
- dimensional world geometry and selective world ink;
- a perspective camera;
- multiple motivated lights;
- shadow casters and receivers.

After rendering, run the bot's media/frame QA and inspect actual rendered frames. Automated metrics are sanity checks, not proof of visual similarity. Compare character proportions, silhouette, palette, outline, lighting, set dressing, acting, camera and subtitle placement against the references.

## 11. ZIP and delivery contract

- Deliver the complete Remotion project as one ZIP with `package.json` at the ZIP root (or one enclosing project folder).
- Include the required entry point, composition, `motion.config.json`, source code and render script required by the current bot contract.
- Do not include `node_modules`, `.git`, `.env`, `.npmrc` or a hand-made `src/alvareth-engine/`; the bot injects its canonical engine.
- Keep the composition duration driven by the generated voiceover and project configuration. Do not add a fixed story-duration cap.
- Do not add an arbitrary file-count cap or automatic render timeout.
- Render progress is terminal-only. Do not send progress percentages or progress spam to WhatsApp. The finished MP4 is delivered through WhatsApp.

## 12. Final self-review

Before packaging the ZIP, verify:
- every main character is a true 3D articulated mesh;
- the same character identity is used across all scenes;
- costumes, props and environment match the story, not the source clip's plot;
- hands meet props and feet meet the ground;
- expressions and body acting match narration;
- camera coverage has wide, medium, close and insert shots where useful;
- lighting, cel shading, outlines and subtitle hierarchy remain consistent;
- `assertVisualContract` passes;
- the project builds and renders without relying on external assets.

Do not claim the result is reference-matched until rendered frames and motion have been visually inspected.
