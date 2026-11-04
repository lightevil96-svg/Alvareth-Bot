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

## Project-specific editing principles

- Keep LightJurnal's creative UI prompt-only. Never add manual scene-duration, background-color, palette, music, FPS, aspect-ratio, or transition controls.
- Let the planner choose scene pacing from narration length, reading time, visual action, and story beats.
- Keep the composition deterministic: all movement must derive from useCurrentFrame() and useVideoConfig(), not CSS animation timers.
- Use Sequence boundaries for scene timing. Keep each scene's video layers and audio cues synchronized inside the same timing boundary.
- Avoid repetitive motion, overused transitions, constant zooms, excessive SFX, and dense on-screen paragraphs.
- Do not claim voice-over, stock footage, AI-generated footage, or 3D assets until those paths are implemented and render-tested.
- Preserve Remotion version alignment. Current core packages are pinned to 4.0.540.
