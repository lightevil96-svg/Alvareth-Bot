# Official Remotion Agent Skills

The Remotion engine in this repository uses version 4.0.540. Install the full official Agent Skills collection from remotion-dev/skills with npm run skills:remotion.

The 13 official skills are installed locally under .agents/skills for compatible coding agents. The repository also contains a project-specific remotion-professional-editor skill for senior-level storytelling, editorial pacing, and motion direction. Load the router first, then only the specialized skills needed for the task.

| Skill | When to load |
| --- | --- |
| remotion-best-practices | Always; routes the agent to the correct Remotion guidance. |
| remotion-markup | Composition JSX, animation, typography, timing, audio, effects, and transitions. |
| remotion-captions | Transcription, timed caption JSON, animated subtitles, and SRT import. |
| remotion-create | Scaffolding a new Remotion project; not needed for this existing project. |
| remotion-docs | Looking up current Remotion APIs and documentation. |
| remotion-interactivity | Editable Studio controls, timeline structure, and interactive composition work. |
| remotion-license | License, commercial usage, and terms questions. |
| remotion-maps | Geographic explainers, routes, map layers, and 3D flyovers. |
| remotion-multimedia | Reading audio/video duration, dimensions, and metadata. |
| remotion-render | MP4/still rendering and render options. |
| remotion-saas | Remotion Player, application integration, and server-side rendering architecture. |
| remotion-studio | Opening and verifying the Remotion Studio preview. |
| remotion-upgrade | Updating Remotion and keeping all @remotion/* packages aligned. |
| remotion-professional-editor | Project-specific creative direction: storytelling, pacing, visual contrast, typography, restrained motion, and sound design. |
| alvareth-ai-video-production | End-to-end prompt-led production: visual bible, recurring character bible, ComfyUI footage, ElevenLabs voice, music, captions, and quality gates. |

## Project-specific editing principles

- Keep LightJurnal's creative UI prompt-only. Never add manual scene-duration, background-color, palette, music, FPS, aspect-ratio, or transition controls.
- Let the planner choose scene pacing from narration length, reading time, visual action, and story beats.
- Keep the composition deterministic: all movement must derive from useCurrentFrame() and useVideoConfig(), not CSS animation timers.
- Use Sequence boundaries for scene timing. Keep voice-over tracks, word-timed caption phrases, footage layers, and scene boundaries synchronized.
- Voice-over is optional and uses ElevenLabs with timestamp alignment; stock footage is optional and uses Pexels. ComfyUI video/music workflows are optional. Missing provider keys must produce clear warnings and a clean motion-graphics fallback.
- Pexels footage must be downloaded to the Remotion public asset directory, validated as a local safe path, and credited on-screen with the photographer and Pexels.
- Music must be quieter when voice-over exists. Avoid repetitive motion, overused transitions, constant zooms, excessive SFX, and dense on-screen paragraphs.
- AI-generated footage and AI music are optional ComfyUI paths when API-format workflows are configured. A configured image workflow can generate one character reference per job and upload it to an image-to-video workflow through the {{REFERENCE_IMAGE}} placeholder. Uploaded-media editing is not implemented; identity consistency across independently generated clips remains best-effort and must be verified with real renders. A real MP4 render on the production VPS still needs verification.
- Preserve Remotion version alignment. Current core packages are pinned to 4.0.540.
