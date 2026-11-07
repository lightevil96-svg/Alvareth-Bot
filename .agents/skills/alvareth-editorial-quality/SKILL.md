---
name: alvareth-editorial-quality
description: Review Alvareth Remotion timing, compositing, narrative pacing and final output quality. Use for local prompt-to-video pipeline edits and render acceptance checks.
---

Read references/workflow.md for editorial order, references/timeline-and-compositing.md for frame coordinates and dialogue-first mixing, and references/motion-graphics.md for deterministic Remotion design.

Apply these principles to the existing Alvareth renderer, not a second rendering pipeline. The references' external workbench commands are examples, not installed tools. Use scripts/remotion-smoke.js and the repository tests instead.

For vertical short-form layouts made from landscape gameplay or screen recordings, also load .agents/skills/alvareth-blur-background-fit/SKILL.md. Preserve the full foreground frame and use a blurred duplicate only as background; never center-crop away HUDs, avatars, or important on-screen information.

Require scene-local visual events and SFX to share frame origins. Measure final MP4 streams, full decode, dimensions, frame rate, audio peak, and representative frames. Keep fixture tests distinct from VoxCPM2/Ollama inference and live WhatsApp delivery. Never fabricate alignment by distributing words evenly.

Use only loopback Ollama, VoxCPM2, procedural effects and individually reviewed local ComfyUI models. Do not install hosted AI tools or use external sound packs with unverified licenses. Preserve official Remotion version pins. Default to no music if no reviewed local track exists.

The three reference documents are MIT-licensed excerpts from gitethanwoo/video-editing at commit 166eed9b1f391af5201a37057924593bf8f413d4. Preserve LICENSE. No upstream executable scripts, Gemini integration, source downloader, or extra Remotion project is installed.
