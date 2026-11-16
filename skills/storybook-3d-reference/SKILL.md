---
name: storybook-3d-reference
description: Build reference-faithful Stylized 3D Story Animation for Alvareth Bot: hand-inked 2.5D character cutouts inside real 3D story environments, with consistent character identity, motivated directing, and visual QA.
---

# Storybook 3D Reference Style — Alvareth Bot

## Purpose and visual target

This skill adapts the production methods in:
- https://github.com/4mJ0k3r/remotionshorts/tree/main/animated-3d-story-video
- https://github.com/4mJ0k3r/remotionshorts/blob/main/ANIMATION_STYLE_HANDOFF.md
- https://github.com/4mJ0k3r/remotionshorts/blob/main/animated-3d-story-video/references/cel-studio-contract.md
- https://github.com/4mJ0k3r/remotionshorts/blob/main/src/engine/README.md

The target reference is a **hybrid 2.5D visual language**: flat, hand-inked illustrated characters staged in a genuine 3D environment. This is intentional, not a compromise. The characters should not be converted into smooth volumetric toy people. The environment, architecture, props, lights, shadows, camera, depth, parallax, and occlusion must be real 3D.

Do not promise pixel-identical or 100% reproduction. Match the measurable visual grammar and verify the rendered output against the supplied reference.

## 1. Reference breakdown before coding

Inspect representative frames from the reference and write a short style bible containing:
- Character head/body ratio, head silhouette, face layout, hair silhouette, outfit shapes, limb thickness, hand/foot shape, and outline color/weight.
- Character palette, background palette, material texture, lighting direction, shadow softness, and contrast.
- Camera height, focal length/FOV, shot scale, perspective, depth layers, and cut rhythm.
- Subtitle font weight, outline thickness, keyword color, line count, vertical position, and safe margins.
- Typical acting beats: anticipation, action, reaction, settle, held pose, mouth movement, eye-line, and gesture size.

Do not infer the plot or force the reference's exact props/locations into a new story. Extract its visual language only.

## 2. Character construction — 2D artwork in 3D space

Use bespoke vector/Canvas/SVG artwork or alpha-cutout layers for the character:
- Large warm cream head with a slightly organic hand-drawn contour.
- Thick dark warm-plum/brown outline, stable and readable at phone size.
- Minimal face: simple dark eyes/pupils, restrained brows, small mouth; expression changes are intentional.
- Compact bean/rounded torso with flat clothing-color blocks.
- Thin tapered curved arms and legs; small dark rounded hands and shoes.
- Distinct hair silhouettes, clothing, accessories, and body proportions per character.

Rig semantic layers where needed: head, hair, face features, torso, upper/lower arms, hands, legs, and held props. Place them as transparent planes/cards in the 3D world. Use a camera-facing head pivot independent of torso rotation. Preserve alpha edges; no white halo. Avoid full-screen flat sprites or a single unarticulated character card.

**Forbidden look:** sphereGeometry heads, boxGeometry torsos, cylinderGeometry limbs, glossy plastic, metallic skin, oversized robot eyes, mechanical joints, generic mascot/robot bodies, random per-frame outline wobble, and continuous whole-body bobbing.

## 3. Environment — actual 3D

Build story-specific sets from actual Three.js geometry:
- Architecture with believable wall thickness, openings, frames, floor/wall intersections, furniture, supports, and set dressing.
- Distinct near/mid/far planes with real perspective, foreground occlusion, parallax, and contact shadows.
- Story-critical props with plausible dimensions, named grip/contact anchors, and consistent identity across cuts.
- Matte/painterly materials: plaster, wood, stone, fabric, dirt, foliage, metal, water, and other materials demanded by the story.
- Motivated key/fill/rim lighting, warm/cool contrast, soft atmosphere, and shadows that ground both characters and props.

Use a restrained world-ink pass on selected architecture/prop silhouettes and hard creases. Do not outline every polygon, texture feature, brick, or leaf. Keep world ink thinner/subordinate to character ink.

## 4. Palette and graphic treatment

Default palette: warm cream, plaster beige, sand, ochre, wood brown, terracotta, muted olive, burgundy/maroon, and dusty blue. Adapt accents and lighting mood to the story while preserving the same visual DNA. Avoid neon/teal tech palettes unless the story calls for them.

Character outlines are the strongest graphic feature. Keep flat cel fills and restrained shadow/crescent accents. No glossy specular skin or photorealistic materials.

Subtitles follow the reference: bold white text with thick dark outline/shadow; highlight only the key spoken word in #FFD93D. Use one or two short lines in a flexible upper/central safe area. No rounded dark UI panel, permanent lower third, logo, watermark, or decorative brand strip unless explicitly requested. Never cover faces, hands, or story-critical props.

## 5. Acting, timing, and camera

Create a beat table before implementation:
`frame/time | narration cue | visible action | pose/gaze | camera/focus | contact/prop/FX`.

For each beat, direct:
1. anticipation,
2. readable action,
3. consequence/reaction,
4. settle into a stable hold.

Use deterministic frame-addressable animation from Remotion's current frame. Mouth movement follows the actual voice envelope and only the active speaker talks. Listeners hold a deliberate expression/eye-line. Use outward-bending two-bone IK, pin stance feet, and solve hands against actual prop/fixture anchors. Never fake contact by moving the fixture to the hand.

Use motivated coverage: establishing wide, medium/two-shot, close-up reaction, and insert for small story-critical actions. Camera moves (push, track, pan, crane, orbit) must support a beat. Avoid repeated eye-level framing, random drift, constant zoom, and universal cut intervals. Check projected crop bounds in the final 9:16 frame.

## 6. Flexible adaptation

Keep fixed:
- hand-inked flat character language,
- head/body proportions and simplified facial grammar,
- dark organic outlines,
- matte cel fills and warm palette logic,
- real 3D world construction,
- grounded contact, depth, and camera grammar,
- subtitle treatment.

Change for every new story:
- cast identity, age impression, hair, clothes, accessories,
- location, architecture, culture-specific objects and props,
- weather, time of day, mood, lighting accents,
- actions, shot order, pacing, and story-specific effects.

Do not reuse a forge, blacksmith, hammer, medieval village, or any reference-specific object unless the new story requires it. Create a character sheet for each recurring character and reuse it across every scene.

## 7. Visual QA gates

Render calibration stills for each shot and inspect native crops at phone size. Also inspect short motion previews for speaking, contact, and reaction beats; stills alone cannot validate motion.

Check:
- character silhouette, head proportions, facial readability, and outline weight;
- stable identity/outfit across cuts and no unwanted sphere/box/cylinder toy anatomy;
- connected neck/shoulders/hips/limbs and supported feet;
- correct prop grip/contact and continuity across the full contact interval;
- clear near/mid/far depth, correct occlusion, and grounded shadows;
- world ink subordinate to character ink, no texture wireframe;
- face readability, subtitle safe area, camera crop, and motivated shot changes;
- mouth sync, stable holds, no jitter, no perpetual bobbing, no pose pop;
- the final rendered movie, not only code or one preview frame.

Report observed facts separately from inferred causes. A clean render or passing numeric check does not by itself prove visual fidelity.
