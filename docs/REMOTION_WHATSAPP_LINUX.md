# Alvareth Remotion — local Linux setup

## Current architecture

`Brief pengguna → ChatGPT (di luar bot) → storyboard JSON → parser/normalizer → compiler → validator → single-worker queue → VoxCPM2 lokal (opsional/wajib sesuai konfigurasi) → ComfyUI lokal opsional → Remotion/FFmpeg → MP4 → WhatsApp`.

Bot tidak menjalankan Ollama, tidak memanggil ChatGPT API, dan tidak memerlukan API key LLM untuk menyusun storyboard. Pemilik membuat JSON di ChatGPT dengan mengikuti [prompt-remotion.md](../prompt-remotion.md), kemudian menempelkannya ke `.remotion`. Backend hanya memvalidasi dan merender input terstruktur tersebut.

## Requirements

Node.js 22+, Python 3.10+ (3.11 recommended), FFmpeg/FFprobe, Chromium dependencies, dan ruang disk untuk model serta hasil render. GPU CUDA sangat membantu VoxCPM2 dan generasi visual; CPU dapat dipilih, tetapi throughput/RAM harus diuji. Jangan menganggap CPU rendering atau AI footage akan real-time. Jalankan satu proses bot untuk antrean berbasis filesystem ini; jangan menjalankan beberapa replica yang berbagi `jobs.json`.

## Install in an existing checkout

Preserve `.env`, sessions, and database. If the checkout has local edits, resolve them before switching branches. Do not overwrite `.env` with the example.

```bash
git status --short
git fetch origin
git switch feat/remotion-whatsapp-linux
git pull --ff-only origin feat/remotion-whatsapp-linux
sudo apt-get update
sudo apt-get install -y ffmpeg python3-venv libnss3 libatk-bridge2.0-0 libgbm1 libasound2t64
npm install
npm test
python3 -m venv .venv-voxcpm
.venv-voxcpm/bin/pip install -r video-studio/services/voxcpm/requirements.txt
```

Package names differ across distributions (older Ubuntu uses `libasound2`). Upstream VoxCPM dependencies are substantial; select the matching PyTorch CUDA build for the VPS and lock the resolved environment after a real synthesis test.

Download VoxCPM2 once (model download is not inference/API credit usage):

```bash
mkdir -p "$HOME/alvareth-models/VoxCPM2"
.venv-voxcpm/bin/hf download openbmb/VoxCPM2 --local-dir "$HOME/alvareth-models/VoxCPM2"
VOXCPM_MODEL_PATH="$HOME/alvareth-models/VoxCPM2" VOXCPM_DEVICE=cuda .venv-voxcpm/bin/python video-studio/services/voxcpm/server.py
```

Use `VOXCPM_DEVICE=cpu` only when GPU is unavailable and memory/latency are acceptable. The wrapper validates `architecture=voxcpm2`, loads local files only, disables denoiser downloads and synthesis-time normalization dependencies, and serializes synthesis. `/speech` is OUR HTTP wrapper contract, not an official OpenBMB REST endpoint.

Keep the process running through your existing supervisor/systemd. No production supervisor configuration is changed automatically. A successful health response means the model loaded; it does not prove voice quality:

```bash
curl --fail http://127.0.0.1:7861/health
```

## Optional word alignment

Upstream supports local stable-ts forced alignment. Install the optional dependency and download a Whisper checkpoint once:

```bash
.venv-voxcpm/bin/pip install stable-ts==2.19.1
.venv-voxcpm/bin/python -c 'import whisper; whisper.load_model("base", download_root="/tmp/alvareth-whisper-download")'
mkdir -p "$HOME/alvareth-models/whisper"
cp /tmp/alvareth-whisper-download/base.pt "$HOME/alvareth-models/whisper/base.pt"
```

Restart the TTS service with `VOXCPM_ALIGNMENT_MODEL_PATH=$HOME/alvareth-models/whisper/base.pt`. The adapter uses upstream StableTSAligner with language `id` by default. Without valid alignment, speech remains scene-synchronized and word-highlight captions are disabled with a warning. No evenly-spaced fake timestamps are generated. Each scene is synthesized separately; speaker/prosody continuity must still be evaluated by listening.

## Bot environment

Add/update these values in the existing private `.env`:

```dotenv
VIDEO_STUDIO_VOXCPM_URL=http://127.0.0.1:7861
VIDEO_STUDIO_VOXCPM_TIMEOUT_MS=600000
VIDEO_STUDIO_VOICE_REQUIRED=true
VIDEO_STUDIO_RENDER_CONCURRENCY=1
VIDEO_STUDIO_WA_MAX_ACTIVE_JOBS=2
```

If infrastructure cannot run speech, an operator may explicitly set `VIDEO_STUDIO_VOICE_REQUIRED=false`; the result includes a no-narration warning. There is no alternate TTS provider. Remove obsolete `VIDEO_STUDIO_OLLAMA_*` and `VIDEO_STUDIO_AI_TIMEOUT_MS` settings from the private `.env`. Preserve unrelated bot credentials and configuration.

The repository updater defaults to main. On a staging checkout, set `AUTO_UPDATE_ENABLED=false` before starting so development testing is not replaced by production branch updates. Do not change a live VPS updater without an explicit deployment decision.

## Optional ComfyUI

No default visual/music model is silently chosen. Audit model license, node source, all network-capable nodes, and memory requirements. Use only operator-reviewed local workflows. Put approved API-format graphs outside Git secrets/data, calculate `sha256sum /path/to/workflow.json`, and add the exact digest to comma-separated `VIDEO_STUDIO_COMFYUI_REVIEWED_SHA256`. Set the relevant `VIDEO_STUDIO_COMFYUI_*_WORKFLOW_FILE` and loopback URL. Hash checks pin reviewed bytes; they cannot prove custom-node behavior or detect every renamed/banned model. Operator review is necessary.

The default AI-video selection is two scenes per job (configurable, maximum four); generated clips are 3–8 seconds. Character reference generation requires an image workflow and a video workflow containing `{{REFERENCE_IMAGE}}`. Without suitable visual workflows, the output is motion graphics, not generated 3D character animation or photorealistic footage. Without a music workflow/track, there is no music. SFX are generated locally and require no model.

## WhatsApp commands

`.remotion` opens the owner-only menu:

- `.remotion generate` — opens a session and asks for ChatGPT storyboard JSON.
- `.remotion <JSON>` — validates the supplied JSON and queues the render immediately.
- `.remotion status`, `.remotion history`, `.remotion send ID`, `.remotion guide`, `.remotion services`, `.remotion cancel`.

Brief teks biasa tidak diproses. The bot accepts a JSON payload up to 24,000 characters. Required root fields are `schemaVersion: 1`, `sourcePrompt`, and `scenes`. See [prompt-remotion.md](../prompt-remotion.md) for the exact schema, allowlists, constraints, and a full fox-story example.

Every plugin invocation requires `isROwner === true`; the router retains its own owner check. Prompt sessions require matching sender and chat; another owner cannot cancel that session. Cancellation only cancels input, not a queued render. Job history/output can be accessed by authorized owners. `.remotion services` checks runtime packages, configured media workflows, and VoxCPM2 health; it is not an end-to-end render guarantee.

## Sound and timing

Storyboard JSON assigns a cue and overlay delays. `engine/sound-design.js` converts visible entry/transition/notification/callout events to frame positions shared with the scene. Procedural effects have bounded peaks, short fades, and speech attenuation. Cues too close together are deduplicated and effects that cannot finish before scene end are omitted. Each motion does not automatically deserve a noise. Music is not forced.

Narration WAV is probed and fully decoded before use. Scene durations expand to complete speech plus breathing space, quantized to project FPS. Overlong narration (more than 19.7 seconds spoken per scene) or more than 300 seconds total fails clearly rather than truncating speech.

## Acceptance tests

```bash
npm test
python3 -m unittest discover -s tests -p '*_test.py'
# Real VoxCPM2 service required; this must produce actual narration:
npm run test:remotion-live
# Renderer-only fixed storyboard, explicitly NOT an AI or speech test:
node scripts/remotion-smoke.js --fixture
```

Smoke output defaults to `/tmp/alvareth-remotion-smoke`; override `REMOTION_SMOKE_DIR` to retain it. A successful smoke includes H.264 video, audio, correct dimensions, full FFmpeg decode, and JSON probe evidence. Listen to voice/SFX, inspect transitions/subtitles, then test all seven actions plus a non-owner account on real WhatsApp. CI fixture rendering never establishes that VoxCPM2 or WhatsApp works on the VPS.

See [REMOTION_LOCAL_LICENSES.md](REMOTION_LOCAL_LICENSES.md) for licensing and [REMOTION_AUDIT_2026-11-06.md](REMOTION_AUDIT_2026-11-06.md) for the audit evidence and limitations.
