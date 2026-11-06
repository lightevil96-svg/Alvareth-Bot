# Alvareth Remotion — local Linux setup

## Current architecture

Brief pengguna → model AI eksternal pilihan operator → storyboard JSON → parser/normalizer → compiler → validator → single-worker queue → Edge TTS online (default) atau VoxCPM2 lokal (opsional) → ComfyUI opsional → Remotion/FFmpeg → MP4 → WhatsApp.

Bot tidak menjalankan Ollama, Qwen, API model bahasa, atau LLM lokal untuk menyusun storyboard. Pemilik meminta model AI pilihannya membaca prompt-remotion.md di root repository, menghasilkan JSON, lalu menempelkannya ke .remotion. Backend hanya mem-parsing, menormalisasi, memvalidasi, mengompilasi, dan merender JSON tersebut.

## Requirements

Node.js 22+, Python 3.10+ (3.11 recommended), FFmpeg/FFprobe, Chromium dependencies, dan ruang disk untuk model serta hasil render. GPU CUDA sangat membantu VoxCPM2 dan generasi visual; CPU dapat dipilih secara eksplisit, tetapi throughput/RAM harus diuji. Jangan menganggap render CPU atau AI footage akan real-time. Jalankan satu proses bot untuk antrean berbasis filesystem ini; jangan menjalankan beberapa replica yang berbagi jobs.json.

Procedural 3D scenes use the pinned `@remotion/three`, `@react-three/fiber`, and `three` dependencies installed by `npm install`; they do not require ComfyUI. The renderer defaults to software WebGL (`swangle`) for CPU-only VPS and CI. If the host has a supported GPU, set `VIDEO_STUDIO_WEBGL_RENDERER=angle-egl` to use it; GPU acceleration can improve 3D throughput. Software WebGL is slower, so test a short 3D fixture before producing long videos.

## Install in an existing checkout

Preserve .env, sessions, and database. If the checkout has local edits, resolve them before switching branches. Do not overwrite .env with the example.

```bash
git status --short
git fetch origin
git switch main
git pull --ff-only origin main
sudo apt-get update
sudo apt-get install -y ffmpeg python3-venv libnss3 libatk-bridge2.0-0 libgbm1 libasound2t64
npm install
npm test
python3 -m venv .venv-voxcpm
.venv-voxcpm/bin/pip install -r video-studio/services/voxcpm/requirements.txt
```

Package names differ across distributions (older Ubuntu uses libasound2). Upstream VoxCPM dependencies are substantial; select the matching PyTorch CUDA build for the VPS and lock the resolved environment after a real synthesis test.

Download VoxCPM2 once (model download is not inference/API credit usage):

```bash
mkdir -p "$HOME/alvareth-models/VoxCPM2"
.venv-voxcpm/bin/hf download openbmb/VoxCPM2 --local-dir "$HOME/alvareth-models/VoxCPM2"
VOXCPM_MODEL_PATH="$HOME/alvareth-models/VoxCPM2" VOXCPM_DEVICE=cuda .venv-voxcpm/bin/python video-studio/services/voxcpm/server.py
```

Use VOXCPM_DEVICE=cpu only when GPU is unavailable and memory/latency are acceptable. The wrapper validates architecture=voxcpm2, loads local files only, disables denoiser downloads and synthesis-time normalization dependencies, and serializes synthesis. /speech is Alvareth's HTTP wrapper contract, not an official OpenBMB REST endpoint.

Keep the process running through your existing supervisor/systemd. No production supervisor configuration is changed automatically. A successful health response means the model loaded; it does not prove voice quality:

```bash
curl --fail http://127.0.0.1:7861/health
```

## Rootless / Pterodactyl installation

If the hosting console is in /home/container and does not provide root/apt, use scripts/setup-video-studio-linux.sh only when you want the optional local VoxCPM2 provider. The default Edge TTS provider has a separate lightweight installer and does not need PyTorch, VoxCPM2 weights, or a GPU.

Runtime and dependencies only:

```bash
bash scripts/setup-video-studio-linux.sh
```

If NVIDIA is not visible inside the container but you explicitly accept slow CPU inference:

```bash
bash scripts/setup-video-studio-linux.sh --allow-cpu
```

After checking container RAM and disk, download model weights:

```bash
bash scripts/setup-video-studio-linux.sh --allow-cpu --with-models
```

For a server with NVIDIA passthrough, run without --allow-cpu. If a specific PyTorch build is needed, set VOXCPM_TORCH_INDEX_URL according to the driver/CUDA version from PyTorch Start Locally.

The bootstrap does not require sudo, apt, or systemd. GPU mode requires NVIDIA to be visible in the container through nvidia-smi; if it is not visible, the physical host may still have a GPU that has not been passed through. CPU mode must be selected explicitly. The script reports host-visible RAM, cgroup limits, and storage where available. VoxCPM2 2B supports CPU but may be very slow. Ensure the provider allows binary execution, outbound HTTPS, background processes, and persistent storage.

## Install engine from WhatsApp

Optional: if you want the slower local VoxCPM2 provider instead of the default online Edge TTS, an owner can install it without opening the console:

```text
.remotion install
```

The command detects NVIDIA visibility and starts the optional local VoxCPM2 installer in the background with model download enabled. It installs uv, Python 3.11, PyTorch, the pinned VoxCPM2 adapter, and VoxCPM2 weights. It is not required when using Edge TTS.

## Default voice provider: Edge TTS online

The default TTS provider is Microsoft's Indonesian Neural voice service through the community `edge-tts` client. It is free, needs no API key, does not download a speech model, and does not require a GPU. The client is unofficial and depends on Microsoft's online Edge speech endpoint; availability, rate limits, and endpoint behavior can change.

Install it from WhatsApp:

```text
.remotion voice install
```

This creates a lightweight `.venv-edge-tts` using uv/Python 3.11 and installs only `edge-tts`; it does not install PyTorch or VoxCPM2. Select the provider and voice from:

```text
.remotion voice
```

Available Indonesian voices are `id-ID-GadisNeural` (female) and `id-ID-ArdiNeural` (male). The menu also changes speech rate, pitch, and volume. Settings are persisted and snapshotted into each new job. Edge TTS returns word-boundary events used for subtitle timing. If the online service is unavailable, switch to VoxCPM2 only if its local runtime and model are installed.

## Optional local VoxCPM2 provider

Use `.remotion install` only if you want to download and run the 2B local speech model. It is not required for Edge TTS.

Other commands:

- .remotion install status — installer status, exit code, and recent log lines.
- .remotion voice — opens provider, voice, rate, pitch, volume, and narrator-style controls.
- .remotion voice install — installs the lightweight online Edge TTS adapter.
- .remotion services start voice — starts the VoxCPM2 adapter only when that local provider is selected.
- .remotion services — checks status without loading large models.
- .remotion install cpu — explicitly selects CPU if NVIDIA is not visible. CPU can be very slow; check RAM/disk first.
- .remotion hardware — reports CPU, RAM, disk, and visible graphics devices.

If NVIDIA is not visible, .remotion install stops before installing/downloading the runtime and asks the owner to choose CPU explicitly. Upstream VoxCPM2 2B cites around 8 GB VRAM as a reference; actual requirements depend on device and configuration. CPU support does not guarantee production-quality throughput.

## Bot environment

Add/update these values in the existing private .env:

```dotenv
VIDEO_STUDIO_VOXCPM_URL=http://127.0.0.1:7861
VIDEO_STUDIO_VOICE_REQUIRED=true
VIDEO_STUDIO_LOCAL_SERVICES_AUTOSTART=true
VIDEO_STUDIO_VOXCPM_STARTUP_TIMEOUT_MS=600000
VIDEO_STUDIO_RENDER_CONCURRENCY=1
VIDEO_STUDIO_WA_MAX_ACTIVE_JOBS=2
```

Optional paths for rootless/Pterodactyl environments:

```dotenv
VOXCPM_MODEL_PATH=/home/container/alvareth-models/VoxCPM2
VIDEO_STUDIO_VOXCPM_PYTHON=/home/container/.venv-voxcpm/bin/python
```

If speech infrastructure cannot run, an operator may explicitly set VIDEO_STUDIO_VOICE_REQUIRED=false; the result includes a no-narration warning. Edge TTS is the default online provider; VoxCPM2 is optional. Remove obsolete local planner URL/model settings from the private .env if present. Preserve unrelated bot credentials and configuration.

The repository updater defaults to main. On a staging checkout, set AUTO_UPDATE_ENABLED=false before starting so development testing is not replaced by production branch updates. Do not change a live VPS updater without an explicit deployment decision.

## External AI storyboard input

Use the repository-root prompt-remotion.md as the authoritative prompt and schema guide. Any external AI model must return one valid JSON object with schemaVersion: 1, sourcePrompt containing the original user brief, and scenes containing 1–60 scene objects. Target duration must not exceed 300 seconds; each initial scene estimate must be no longer than 20 seconds. Keep headlines short (ideally 3–8 words), subtext concise, and points brief.

The WhatsApp payload limit is 24,000 characters. .remotion generate opens an input session; paste the JSON in the next message. .remotion <JSON> can start immediately. Plain-language briefs are intentionally rejected because the bot no longer has a local prompt-generating LLM.

Storyboard fitting rejects a target that is shorter than its estimated narration/reading requirement. After TTS, each narrated scene is re-timed from its measured audio file: the video scene lasts at least 1.25 seconds or the actual voice duration plus a 0.25-second visual tail, whichever is longer. The original AI duration is only an estimate for narrated scenes. Scenes without narration retain their planned duration.

## Optional word alignment

Upstream supports local stable-ts forced alignment. Install the optional dependency and download a Whisper checkpoint once:

```bash
.venv-voxcpm/bin/pip install stable-ts==2.19.1
.venv-voxcpm/bin/python -c 'import whisper; whisper.load_model("base", download_root="/tmp/alvareth-whisper-download")'
mkdir -p "$HOME/alvareth-models/whisper"
cp /tmp/alvareth-whisper-download/base.pt "$HOME/alvareth-models/whisper/base.pt"
```

Restart the VoxCPM2 TTS service with VOXCPM_ALIGNMENT_MODEL_PATH=$HOME/alvareth-models/whisper/base.pt. Edge TTS already returns word-boundary timing and does not need this optional Whisper alignment. Without valid local alignment for VoxCPM2, captions use approximate timing from measured WAV duration and syllable/punctuation weights. Each scene is synthesized separately, so speaker/prosody continuity must still be evaluated by listening.

## Optional ComfyUI

The core installer does not install ComfyUI, visual/audio model weights, custom nodes, or workflow files. .remotion services marks a ComfyUI workflow ready only when the file exists and its exact SHA-256 is approved. Character reference additionally requires reviewed image/video workflows and the {{REFERENCE_IMAGE}} placeholder in the video graph.

Audit each model license, custom-node source, network-capable node, and memory requirement. Use only operator-reviewed local workflows. Store approved API-format graphs outside Git secrets/data, calculate sha256sum /path/to/workflow.json, and add the exact digest to VIDEO_STUDIO_COMFYUI_REVIEWED_SHA256. Set the relevant VIDEO_STUDIO_COMFYUI_*_WORKFLOW_FILE and loopback URL. Hash checks pin reviewed bytes but cannot prove custom-node behavior or detect every renamed/banned model; operator review is necessary.

Default AI-video selection is two scenes per job (configurable, maximum four); generated clips are 3–8 seconds. A character reference image can help continuity but does not guarantee identical identity across every frame/clip. Without a suitable ComfyUI video workflow, the output is motion graphics, not generated 3D character footage. Without a music workflow/track, there is no music. SFX are generated locally and require no model.

## Sound and timing

The storyboard JSON assigns scene sound cues and overlay delays. engine/sound-design.js converts visual entry/transition/notification/callout events to frame positions shared with the scene. Procedural effects have bounded peaks, short fades, and speech attenuation. Cues too close together are deduplicated; effects that cannot finish before scene end are omitted. Not every movement needs a sound. Music is not forced.

Narration audio (MP3 from Edge TTS or WAV from VoxCPM2) is probed and fully decoded before use. Every narrated scene is timed from its own measured voice-over duration, plus a short 0.25-second visual tail and a 1.25-second minimum hold, quantized to project FPS. This means short narration produces a shorter scene and longer narration produces a longer scene; the AI's original duration estimate cannot force all scenes to stay equal. Overlong narration (more than 19.7 seconds spoken per scene) or more than 300 seconds total fails clearly rather than truncating speech.

## Acceptance tests

```bash
npm test
python3 -m unittest discover -s tests -p '*_test.py'
# Optional live VoxCPM2 service test; this requires its local model to be installed:
npm run test:remotion-live
# Renderer-only fixed storyboard, explicitly NOT an AI or speech test:
node scripts/remotion-smoke.js --fixture
```

Smoke output defaults to /tmp/alvareth-remotion-smoke; override REMOTION_SMOKE_DIR to retain it. A successful smoke includes H.264 video, audio, correct dimensions, full FFmpeg decode, and JSON probe evidence. Listen to voice/SFX, inspect transitions/subtitles, then test all menu actions and a non-owner account on real WhatsApp. CI fixture rendering never establishes that the online Edge TTS endpoint, local VoxCPM2, or WhatsApp works on the VPS.

See REMOTION_LOCAL_LICENSES.md for licensing and REMOTION_AUDIT_2026-11-06.md for audit evidence and limitations.