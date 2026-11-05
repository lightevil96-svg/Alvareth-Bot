# Remotion WhatsApp — Linux Deployment

## What changes

The legacy FreeTheAI text/image-to-video command is removed. The owner-only WhatsApp command is now `.remotion`, which calls the existing Alvareth Video Studio prompt planner, safe storyboard compiler, media pipeline, Remotion renderer, and disk-backed WhatsApp uploader.

The Android/Termux steps in the reference tutorial are intentionally not used. This deployment runs natively on Linux.

## WhatsApp commands

- `.remotion` — open the interactive menu.
- `.remotion generate` — start a prompt session; send the creative brief as the next plain-text message.
- `.remotion <prompt>` — start generation immediately.
- `.remotion status` — inspect active jobs and reattach delivery monitoring.
- `.remotion history` — list recent jobs and their IDs.
- `.remotion send` — resend the newest completed MP4.
- `.remotion send <job-id>` — resend a specific completed MP4.
- `.remotion guide` — show a prompt example.
- `.remotion services` — inspect local provider configuration.
- `.remotion cancel` — cancel only a pending prompt-input session; it does not stop an active render.

Access is restricted with the configured root-owner identity (`OWNER_NUMBER`). Menu action IDs are routed through the normal command handler and pass the same owner permission check.

## Linux requirements

- Node.js 22+ and npm, matching the Alvareth Bot runtime.
- Linux with glibc 2.35 or newer. Alpine Linux and NixOS are not supported by Remotion.
- FFmpeg and FFprobe available on `PATH`.
- Remotion's Chromium runtime libraries and fonts.
- Enough CPU, RAM, and writable disk for Chromium rendering, generated assets, and WhatsApp upload temp files.

For Debian/Ubuntu, install the common runtime dependencies:

    sudo apt-get update
    sudo apt-get install -y ffmpeg libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 fonts-liberation libpango-1.0-0 libcairo2 libglib2.0-0 libxss1 libxtst6 xdg-utils

On distributions that package ALSA as `libasound2t64`, install that package instead of `libasound2`.

From the repository directory:

    node --version
    ffmpeg -version
    ffprobe -version
    npm install
    npm run test:video-studio
    npm start

Do not run two bot instances with the same WhatsApp session. The normal Alvareth startup updater remains responsible for fetching the selected Git branch.

## Provider configuration

The prompt-only experience chooses creative and technical settings automatically. These are server-side providers, not extra WhatsApp controls.

| Capability | Environment variables | Behavior when unavailable |
| --- | --- | --- |
| Prompt planning | `VIDEO_STUDIO_AI_API_KEY`, `VIDEO_STUDIO_AI_BASE_URL`, `VIDEO_STUDIO_AI_MODEL` | Uses the configured fallback endpoint if available; planning errors are reported. |
| Voice-over and aligned captions | `VIDEO_STUDIO_ELEVENLABS_API_KEY`, `VIDEO_STUDIO_ELEVENLABS_VOICE_ID` | Video can render without generated narration; a warning is recorded. |
| Licensed stock footage | `VIDEO_STUDIO_PEXELS_API_KEY` | Motion graphics remain available. |
| Character reference image | `VIDEO_STUDIO_COMFYUI_URL`, `VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE` | Text-only character prompts are used. |
| AI video footage | `VIDEO_STUDIO_COMFYUI_URL`, `VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE` | AI footage is skipped; stock footage or motion graphics are used. |
| AI background music | `VIDEO_STUDIO_COMFYUI_URL`, `VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE` | Built-in procedural soundtrack is used. |
| WhatsApp upload | `ALVARETH_WA_UPLOAD_TIMEOUT_MS`, `ALVARETH_WA_TMPDIR` | Existing disk-streaming upload validation reports storage, permission, timeout, or connection failures. |

Keep ComfyUI on localhost or a private network/VPN. Do not expose its API directly to the public internet. Workflow files must be ComfyUI API-format JSON and use the supported placeholders: `{{PROMPT}}`, `{{NEGATIVE_PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{DURATION}}`, `{{FPS}}`, `{{SEED}}`, `{{SCENE_ID}}`, and (for image-to-video) `{{REFERENCE_IMAGE}}`. Image workflows must save PNG/JPG/WebP; video workflows must save MP4/WebM/MOV; music workflows must save WAV/MP3/FLAC/OGG.

The current ComfyUI adapter can create a reusable character reference image, selected short AI footage clips, and AI music when those workflows are configured. If both image and video workflows are configured, the adapter generates one reference image from the character bible, uploads it to ComfyUI, and passes the returned image name into the video workflow. The video workflow must be an image-to-video workflow whose LoadImage node uses `{{REFERENCE_IMAGE}}`. This improves visual continuity, but does not guarantee pixel-identical character identity across separate clips; verify the chosen model/workflow with real renders.

## Production skills

The repository includes the official Remotion Agent Skills and the custom `remotion-professional-editor` skill. The new `alvareth-ai-video-production` skill defines the complete prompt-led production workflow. Use this sequence when developing the video engine:

1. `remotion-best-practices` — routing and overall Remotion rules.
2. `alvareth-ai-video-production` and `remotion-professional-editor` — creative brief, visual bible, character bible, story beats, editorial pacing, and audio direction.
3. `remotion-markup` — composition JSX, animation, typography, transitions, and sound.
4. `remotion-captions` and `remotion-multimedia` — speech timing, captions, and media metadata.
5. `remotion-render` and `remotion-studio` — rendering and preview verification.
6. `remotion-saas` and `remotion-docs` — integration and current API references.
7. `remotion-license` — licensing checks before commercial distribution.

Remotion Agent Skills are coding-agent instructions, not runtime video models. Actual AI footage, narration, and music still require their configured providers and model workflows.

## Output and runtime data

- MP4 output: `~/.alvareth-bot-data/video-studio/renders/` by default.
- Queue history: `~/.alvareth-bot-data/video-studio/jobs.json`.
- Override the base directory with `ALVARETH_DATA_DIR`.
- Completed renders are retained so `.remotion send <job-id>` can resend them.
- A failed WhatsApp upload does not delete the MP4.
