---
name: voxel-3d-reference
description: Build reference-faithful Voxel 3D Story Animation for Alvareth Bot: blocky Minecraft-style voxel characters in a real pastel 3D world, with consistent character identity, motivated directing, and visual QA.
---

# Voxel 3D Reference Style — Alvareth Bot

## Purpose and visual target

This skill adapts the reference video supplied by the owner (57 detik, vertikal 9:16, 360x640, 30fps): a comedic first-person Indonesian story about a dream-recording device, a giant chicken chase, and a dream going viral. Its visual language is a **blocky voxel world in the spirit of Minecraft**: every character, animal, prop and building is assembled from crisp boxes with flat matte colors, staged in a soft pastel 3D world with dreamy gradient skies.

This is intentional, not a compromise. The characters must not be converted into smooth volumetric toy people, glossy Pixar-like figures, realistic humans, or flat 2D cutouts. The characters are true 3D voxel models built from BoxGeometry, with real volume, perspective, shadows and camera parallax.

Do not promise pixel-identical or 100% reproduction. Match the measurable visual grammar and verify the rendered output against the supplied reference.

## 1. Reference breakdown before coding

Inspect representative frames from the reference and write a short style bible containing:
- Character head/body ratio (cube head is roughly one third of the height), pixel-face layout (two dark rectangular eyes, small straight/open rectangular mouth, optional flat blush blocks), hair-slab shape, torso/limb block sizes, and outfit color blocks.
- Character palette, background palette, floor/wall tile pattern, material flatness, lighting direction, shadow softness, and contrast.
- Camera height, focal length/FOV, shot scale, perspective, depth layers, and cut rhythm (fast comedic cuts on narration beats).
- Subtitle font weight, outline thickness, keyword color (#FFD93D), line count, vertical position (bottom-center safe area), and safe margins.
- Social-proof overlays: view-count pill at top center, floating hearts and like/comment counts at the right edge, rounded white device-UI cards.
- Typical acting beats: anticipation, readable action, reaction, settle, held pose, mouth movement, eye-line, and gesture size.

Do not infer the plot or force the reference's exact props/locations into a new story. Extract its visual language only.

## 2. Character construction — boxes only

Use bespoke voxel models built from BoxGeometry:
- Large cube head with a flat pixel face: two simple dark rectangular eyes, a small straight or open rectangular mouth, optional flat blush blocks. The face must stay readable at phone size.
- Hair as a box slab or a small stack of boxes sitting on the head.
- Boxy rectangular torso, straight rectangular arms and legs, chunky box hands and feet.
- Flat matte colors, one solid color per clothing piece (for example yellow shirt, blue pants, white shorts with small red dots).
- Distinct hair slabs, outfit color blocks, accessories, and expressions per character, preserving the same voxel grammar.
- Animals and creatures follow the same grammar: a giant chicken is a big white box body, a smaller white box head, an orange box beak, red comb/wattle boxes, and two thin orange box legs.

Rig from a single character-sheet module: one Group per character with named BoxGeometry meshes (head, hair, face, torso, left/right arm, left/right leg, feet, held props). Reuse shared geometry instances and materials across characters. Lock proportions in the sheet and reuse the exact same measurements in every scene; never rescale a character per shot. Pin stance feet to the floor plane and solve hands to actual prop grip anchors. Offset overlapping boxes by a tiny epsilon so faces never z-fight. Keep every transform finite and deterministic from the current frame.

**Forbidden look:** sphereGeometry heads, cylinderGeometry limbs, glossy plastic, metallic skin, realistic skin texture, oversized robot eyes, mechanical joints, generic mascot/robot bodies, smooth-shaded faces, and continuous whole-body bobbing.

## 3. Environment — actual voxel 3D

Build story-specific sets from actual Three.js geometry:
- Blocky tiled floors (mint/pastel checker tiles), cube walls, blocky beds, tables, devices and furniture, floating voxel clouds, and blob trees made of pastel box clusters on thin trunks.
- Distinct near/mid/far planes with real perspective, foreground occlusion, parallax, and contact shadows.
- Story-critical props with plausible dimensions, named grip/contact anchors, and consistent identity across cuts.
- Flat matte materials: tile, wood, fabric, plaster, foliage, metal, water, and other materials demanded by the story.
- Bright soft daylight with a warm key light, gentle fill, soft shadows, and a light dreamy bloom.

Keep texture detail subordinate to the action. Give the scene depth and world occlusion while protecting the pixel faces from unwanted depth-of-field blur.

## 4. Palette and graphic treatment

Default palette: lavender-purple gradient sky, mint tiled floors, light-blue walls, pink/purple trees, warm wood brown, sunny yellow accents, white and cream. Adapt accents and lighting mood to the story while preserving the same visual DNA. Avoid dark moody grading and neon/teal tech palettes unless the story calls for them.

Pixel faces are the strongest graphic feature. Keep flat matte fills. No glossy specular skin or photorealistic materials.

Subtitles follow the reference: bold white text with thick dark outline/shadow; highlight only the key spoken word in #FFD93D. Use one or two short lines in the bottom-center safe area. No rounded dark UI panel, permanent lower third, logo, watermark, or decorative brand strip unless explicitly requested. Never cover faces, hands, or story-critical props.

When the story is about something going viral, add the reference's social-proof overlays: a view-count pill at the top center ("👁 2 RB ditonton") that climbs across beats, floating hearts and like/comment counts drifting up the right edge, and rounded white device-UI cards (green check "BERHASIL DIUNGGAH ✓", big green UPLOAD / red HAPUS buttons) when the scene calls for them.

## 5. Acting, timing, camera, and voiceover

Create a beat table before implementation:
`frame/time | narration cue | visible action | pose/gaze | camera/focus | contact/prop/FX`.

For each beat, direct:
1. anticipation,
2. readable action,
3. consequence/reaction,
4. settle into a stable hold.

Use deterministic frame-addressable animation from Remotion's current frame. Mouth movement follows the actual voice envelope and only the active speaker talks. Listeners hold a deliberate expression/eye-line. Use firm blocky limb motion (not rubbery), voxel steps and jumps, and solve hands against actual prop/fixture anchors. Never fake contact by moving the fixture to the hand.

Use motivated coverage: establishing wide, medium/two-shot, close-up reaction, and insert for small story-critical actions (for example a finger pressing a big red button). Cut fast on the comedy beats. Camera moves (push, track, pan, crane, orbit) must support a beat. Avoid repeated eye-level framing, random drift, constant zoom, and universal cut intervals. Check projected crop bounds in the final 9:16 frame.

Voiceover is the engine of the comedy: Bahasa Indonesia, energetic male first-person storyteller (`voiceProfile: "male"`, id-ID-ArdiNeural), short punchy sentences, fast rhythm, a surprising hook inside the first 3 seconds, a pause right before each punchline, and a question to the audience at the end. The audio pipeline produces the TTS voiceover only; do not ask for a background-music file or any audio asset in the project.

Follow the reference's beat shape, adapted to each new brief: (1) absurd hook in the first 3 seconds, (2) setup of the device/discovery that makes the premise possible, (3) fun montage of the best moments, (4) twist/problem when someone misuses it, (5) viral escalation with climbing counters, (6) stakes: privacy or reputation on the line, (7) closing dilemma with two big choices and a question to the audience.

## 6. Flexible adaptation

Keep fixed:
- voxel box-only character language,
- cube-head proportions and simplified pixel-face grammar,
- flat matte fills and pastel palette logic,
- real 3D voxel world construction,
- grounded contact, depth, and camera grammar,
- subtitle treatment and social-proof overlay style.

Change for every new story:
- cast identity, age impression, hair, clothes, accessories,
- location, architecture, culture-specific objects and props,
- weather, time of day, mood, lighting accents,
- actions, shot order, pacing, and story-specific effects.

Do not reuse a giant chicken, dream recorder, or any reference-specific object unless the new story requires it. Create a character sheet for each recurring character and reuse it across every scene.

## 7. Visual QA gates

Render calibration stills for each shot and inspect native crops at phone size. Also inspect short motion previews for speaking, contact, and reaction beats; stills alone cannot validate motion.

Check:
- character silhouette, cube-head proportions, pixel-face readability, and outfit color blocks;
- stable identity/outfit across cuts and no unwanted sphere/cylinder toy anatomy;
- connected neck/shoulders/hips/limbs and supported feet, no detached or floating parts;
- correct prop grip/contact and continuity across the full contact interval;
- clear near/mid/far depth, correct occlusion, and grounded shadows;
- no z-fighting on overlapping boxes, no missing face, no swallowed prop;
- face readability, subtitle safe area, camera crop, and motivated shot changes;
- mouth sync, stable holds, no jitter, no perpetual bobbing, no pose pop;
- the final rendered movie, not only code or one preview frame.

Report observed facts separately from inferred causes. A clean render or passing numeric check does not by itself prove visual fidelity.
