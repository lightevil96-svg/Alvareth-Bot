---
name: alvareth-ai-video-production
description: End-to-end prompt-led AI video production for Alvareth Video Studio using Remotion, ComfyUI, ElevenLabs, captions, licensed footage, and professional editorial direction.
---

# Alvareth AI Video Production

Use this skill when creating or changing a prompt-only video workflow for Alvareth Bot. The goal is a finished, coherent video—not a slideshow assembled from paragraphs.

## Load the right skills

Always load `remotion-best-practices` and `remotion-professional-editor`. Then load only the relevant specialist skills:

- `remotion-markup` for composition, typography, animation, effects, transitions, and audio.
- `remotion-captions` for timed narration captions and SRT handling.
- `remotion-multimedia` for video/audio metadata.
- `remotion-render` and `remotion-studio` for rendering and preview verification.
- `remotion-saas` for the bot/server integration.
- `remotion-docs` for current API details.
- `remotion-license` before commercial distribution.
- `remotion-maps` only for map-based explainers.

## Prompt-only creative pipeline

1. Extract the subject, audience, message, tone, platform, language, and explicit constraints from the complete user brief.
2. Create a concise creative brief: hook, narrative arc, emotional progression, payoff, and ending.
3. Create a visual bible: art style, palette, lighting, lens/camera language, texture, typography, and recurring visual motifs.
4. If the story needs a recurring character, create a character bible describing name, type/species, silhouette, face, hair/fur, clothing, proportions, signature colors, accessories, personality, and prohibited variations. Keep immutable traits separate from each scene's action.
5. Create a storyboard with one clear purpose per scene. Derive timing from narration, reading time, action, and emotional beats; avoid uniform scene durations.
6. Write scene prompts with the same character and visual-bible details repeated consistently. Specify action, framing, camera motion, lighting, environment, and continuity from the previous shot.
7. Direct audio separately: narration, music mood, sound effects, ambience, fades, and mix levels. Keep narration intelligible; duck music under speech and use SFX only when they support a visible beat.
8. Compile only allowlisted data into the Remotion project. Never let model output become executable JSX, JavaScript, shell commands, arbitrary URLs, or file paths.
9. Render deterministically with Remotion and verify the final MP4's dimensions, duration, video stream, audio stream, and non-zero file size.

## Visual-generation guidance

- Use ComfyUI API-format workflows for local open-source image/video generation.
- Wan 2.2 TI2V 5B is a practical hybrid text/image-to-video option; 14B T2V/I2V workflows offer a higher-capacity path when GPU memory and offloading permit.
- Wan 2.2 I2V is preferable when a real starting-frame image is available.
- Wan 2.2 Animate/reference-conditioning workflows are more appropriate when character identity and motion transfer are central.
- A workflow must expose the inputs expected by the Alvareth ComfyUI adapter. Do not claim that a model is active merely because its workflow file exists.
- The current Alvareth adapter does not yet upload a per-job character-reference image. Character continuity across separate clips must therefore be described as best-effort until that adapter is extended and tested.
- If AI footage is unavailable, use Pexels footage with attribution or the supported motion-graphics fallback. Never label motion graphics or stock clips as AI-generated footage.

## Audio guidance

- Use ElevenLabs voice-over with timestamp alignment when the API key and voice ID are configured.
- Use an AI music workflow such as ACE-Step through ComfyUI only when configured and verified.
- The built-in procedural soundtrack and SFX are fallbacks, not equivalent to a custom soundtrack composed for every prompt.
- Never use unlicensed commercial songs or reproduce copyrighted lyrics. Prefer original, licensed, user-provided, or public-domain audio.

## Quality gate

Before calling a video professional or complete, verify:

- The hook is clear and not misleading.
- The story has a beginning, development, payoff, and intentional ending.
- The same character retains recognizable visual attributes across scenes, or the limitation is disclosed.
- Shot sizes, camera motion, composition, and transitions have purposeful variation.
- On-screen text is concise and mobile-readable.
- Voice-over timing and captions match.
- Music sits below speech; SFX do not mask dialogue.
- The rendered MP4 is playable and has the requested aspect ratio and expected audio/video streams.

## Upstream references

- [Official Remotion Agent Skills](https://github.com/remotion-dev/skills) — the installed Remotion skill collection and project guidance.
- [ComfyUI Wan 2.2 documentation](https://docs.comfy.org/tutorials/video/wan/wan2_2) — text-to-video, image-to-video, and hybrid workflow setup.
- [ComfyUI Wan 2.2 Animate workflow](https://comfy.org/hub/workflows/wan2-2-animate-character-animation-and-replacement-c2c4b45b7df5/) — character animation/replacement, pose guidance, segmentation, and optional reference conditioning.
- [ComfyUI Wan image-to-video workflow](https://comfy.org/hub/workflows/image-to-video-new-598da2637dc8/) — a starting-image workflow for motion generation.
