---
name: alvareth-3d-animation
description: Build polished deterministic 3D motion graphics and AI-assisted 3D character footage for Alvareth Bot using Remotion, Three.js, React Three Fiber, and reviewed local ComfyUI workflows.
---

# Alvareth 3D Animation

Use this skill whenever a video brief requests 3D animation, 3D product visuals, 3D typography-adjacent motion design, stylized objects, isometric scenes, or recurring animated characters.

## Load the relevant references

- `.agents/skills/remotion-best-practices/remotion-markup/3d.md` — official Remotion Three.js / React Three Fiber integration.
- `.agents/skills/remotion-best-practices/remotion-markup/measuring-text.md` — reliable text measurement and overflow.
- `.agents/skills/remotion-best-practices/remotion-captions/REFERENCE.md` — caption data and whitespace handling.
- `.agents/skills/remotion-professional-editor/SKILL.md` — story, pace, composition, motion and sound.
- `.agents/skills/alvareth-editorial-quality/SKILL.md` — render inspection, timeline, compositing and delivery QA.
- `video-studio/SKILLS.md` and `prompt-remotion.md` — project-specific runtime contract.

## Choose the correct 3D route

### Procedural 3D motion graphics (available in Remotion)

Use `visualType: "3d"` for:
- 3D product hero shots and object reveals;
- chrome, glass, clay, neon and soft-matte objects;
- orbiting rings, crystals, abstract forms and particle accents;
- isometric-style explainers and spatial diagrams.

This route uses Three.js and React Three Fiber through `@remotion/three`. It does not need ComfyUI and is deterministic at every frame.

### AI-generated 3D character footage (optional)

Use ComfyUI only when the brief needs a character performing complex organic actions, cinematic environments, or generated footage that procedural geometry cannot represent.

- Verify that the local ComfyUI server, video workflow, and required model are actually available.
- For a recurring character, use a reviewed image workflow and a video workflow with `{{REFERENCE_IMAGE}}`.
- Keep immutable character traits in `characterBible`.
- Never claim that reference conditioning guarantees identical identity across clips.
- If the workflow is missing, say so and use the procedural 3D route or a supported motion-graphics fallback.

## Art direction presets

Pick one visual language per video:
- `glass`: translucent, clean, premium, soft reflections.
- `chrome`: reflective metal, controlled highlights, high contrast.
- `clay`: tactile matte surfaces, rounded silhouettes, playful tone.
- `neon`: emissive accents, dark environments, restrained glow.
- `soft`: matte premium materials, gentle lighting and calm motion.

Choose one primary object per scene: `orb`, `cube`, `torus`, `rings`, `crystal`, or `cluster`. Add supporting particles or rings only when they improve depth or communicate an idea.

## Remotion implementation rules

- Wrap every 3D scene in `<ThreeCanvas width={width} height={height}>`.
- Animate only from `useCurrentFrame()` and `useVideoConfig()`; never use `useFrame()`, wall-clock time, CSS animation, timers, or unseeded randomness.
- Set the Chromium renderer to ANGLE for server-side WebGL rendering using `chromiumOptions: { gl: "angle" }`.
- Keep the 3D canvas behind typography. Do not render headings, captions, logos, or brand credits inside the Three.js scene.
- Keep the object in a clear visual area and preserve mobile-safe text margins.
- Use intentional three-point lighting, appropriate roughness/metalness, restrained camera orbit, depth, and one dominant subject.
- Keep geometry and particle counts modest so the 1080x1920 CPU/GPU render remains practical.
- Use the allowlisted `threeDStyle` and `threeDObject` values. Never let storyboard JSON supply arbitrary JSX, shader source, URLs, model paths, or executable code.

## Typography and brand-credit regression

- Brand credit must be the root field `brandCredit: true`, not text baked into AI footage or copied into a scene headline.
- The renderer owns the exact phrase `Dibuat oleh ALVARETHBOT` as three separately spaced text spans.
- If text appears joined, first identify whether it is a Remotion overlay or pixels embedded in `footageSrc`. CSS and text normalization can fix only the overlay; regenerate or mask the source footage if the words are baked into the video.
- Never use negative letter spacing for normal Indonesian captions.
- Preserve actual word boundaries and spaces. Do not join caption tokens by concatenating their text without a separator.

## Quality gate

Before calling the video complete:
1. Render representative stills from the opening, middle, and final seconds of each 3D scene.
2. Inspect the 3D subject's silhouette, material, clipping, depth, lighting and composition at phone size.
3. Verify that scene text, captions and brand credit remain separate, correctly spaced overlays.
4. Check that no AI footage contains unwanted writing, pseudo-text, logos, signatures or watermarks.
5. Confirm all scene durations follow the actual voice-over timeline, not equal placeholder durations.
6. Fully decode the MP4 and verify dimensions, frame rate, duration, video stream and audio stream.
7. Inspect representative frames and listen to the mix. Do not equate a passing syntax test with a visually verified render.

Do not describe a procedural 3D object scene as a fully animated character film. State the actual visual route used.
