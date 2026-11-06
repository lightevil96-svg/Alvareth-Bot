# Alvareth Remotion — local Linux setup

Current pipeline: owner WhatsApp → local Ollama JSON storyboard → schema/compiler → single-worker queue → local VoxCPM2 → optional reviewed local ComfyUI → deterministic Remotion → MP4 upload. No hosted planner/TTS/stock fallback. No deployment is performed by this change.

## Requirements

Node.js 22+, Python 3.10+ (3.11 recommended), FFmpeg/FFprobe, Chromium dependencies, disk space for model weights and renders. A CUDA-capable GPU is strongly preferable for VoxCPM2 and any visual generation. CPU is selectable but throughput/RAM must be measured; no minimum VRAM or real-time claim is made. Ollama unloads after planning (keep_alive=0); the TTS service serializes synthesis. Run one bot process for this filesystem-backed queue, not multiple replicas sharing jobs.json.

## Install in an existing checkout

Preserve .env, sessions and database. If the checkout has local edits, resolve them before switching branches. Do not overwrite .env with the example.

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

Package names differ across distributions (older Ubuntu uses libasound2). Upstream VoxCPM dependencies are substantial; select the matching PyTorch CUDA build for the VPS and lock the resolved environment after a real synthesis test.

Install Ollama using its official Linux instructions: https://docs.ollama.com/linux. Then download an explicitly licensed model once:

```bash
ollama pull qwen2.5:7b
```

Set `OLLAMA_NO_CLOUD=1` on the Ollama service and bind to `127.0.0.1:11434`. The application rejects non-loopback URLs and cloud-tagged model names. Do not expose Ollama, ComfyUI or the TTS port publicly.

Download VoxCPM2 once (model download is not inference/API credit usage):

```bash
mkdir -p "$HOME/alvareth-models/VoxCPM2"
.venv-voxcpm/bin/hf download openbmb/VoxCPM2 --local-dir "$HOME/alvareth-models/VoxCPM2"
VOXCPM_MODEL_PATH="$HOME/alvareth-models/VoxCPM2" VOXCPM_DEVICE=cuda   .venv-voxcpm/bin/python video-studio/services/voxcpm/server.py
```

Use `VOXCPM_DEVICE=cpu` only when GPU is unavailable and memory/latency are acceptable. The wrapper validates architecture=voxcpm2, loads local files only, disables denoiser downloads and synthesis-time normalization dependencies, uses the documented voice-description prefix, and retains a single loaded model. `/speech` is OUR HTTP wrapper contract, not an alleged official OpenBMB REST endpoint.

The process must remain running via your existing supervisor/systemd. No production supervisor configuration is changed automatically. Successful health means loaded model, not proven voice quality:

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

Restart the TTS service with `VOXCPM_ALIGNMENT_MODEL_PATH=$HOME/alvareth-models/whisper/base.pt`. The adapter uses upstream StableTSAligner with language `id` by default. Without valid alignment, speech remains scene-synchronized and word-highlight captions are disabled with a warning. No evenly-spaced fake timestamps. Each scene is synthesized separately; speaker/prosody continuity must still be evaluated by listening.

## Bot environment

Add/update these values in the existing private .env:

```dotenv
VIDEO_STUDIO_OLLAMA_URL=http://127.0.0.1:11434
VIDEO_STUDIO_OLLAMA_MODEL=qwen2.5:7b
VIDEO_STUDIO_AI_TIMEOUT_MS=180000
VIDEO_STUDIO_VOXCPM_URL=http://127.0.0.1:7861
VIDEO_STUDIO_VOXCPM_TIMEOUT_MS=600000
VIDEO_STUDIO_VOICE_REQUIRED=true
VIDEO_STUDIO_RENDER_CONCURRENCY=1
```

If infrastructure cannot run speech, an operator may explicitly set `VIDEO_STUDIO_VOICE_REQUIRED=false`; the result includes a no-narration warning. There is no alternate TTS provider. Remove obsolete VIDEO_STUDIO_AI_API_KEY/BASE_URL/FALLBACK_URL, VIDEO_STUDIO_ELEVENLABS_*, VIDEO_STUDIO_PEXELS_* and VIDEO_STUDIO_COMFYUI_API_KEY settings after checking no external custom script uses them. Other bot features' API keys are unrelated and must be preserved.

The repository updater defaults to main. On a staging checkout, set `AUTO_UPDATE_ENABLED=false` before starting so development testing is not replaced by production branch updates. Do not change a live VPS updater without an explicit deployment decision.

## Pterodactyl / container tanpa akses root

Jika console hosting menunjukkan path seperti `/home/container` dan tidak memiliki akses `apt`/root, gunakan bootstrap user-space. Script terbaru mengunduh binary `uv` langsung dari GitHub Releases (tanpa menjalankan installer `/bin/sh`), mengelola Python 3.11 tanpa `ensurepip`, dan mengekstrak paket resmi Ollama `.tar.zst` ke `$HOME/.local` dengan decompressor Python.

Runtime dan dependensi saja:

```bash
bash scripts/setup-video-studio-linux.sh
```

Jika container tidak menampilkan GPU NVIDIA tetapi kamu memang ingin mencoba inference VoxCPM2 dengan CPU:

```bash
bash scripts/setup-video-studio-linux.sh --allow-cpu
```

Setelah RAM container diperiksa dan cukup, unduh bobot model:

```bash
bash scripts/setup-video-studio-linux.sh --allow-cpu --with-models
```

Untuk server dengan GPU NVIDIA yang sudah dipassthrough, jalankan tanpa `--allow-cpu`. Jika build PyTorch tertentu dibutuhkan, set `VOXCPM_TORCH_INDEX_URL` sesuai driver/CUDA dari [PyTorch Start Locally](https://pytorch.org/get-started/locally/).

Bootstrap ini tidak memerlukan `sudo`, `apt`, `systemd`, `free`, atau `nvidia-smi` untuk membuat virtualenv. Ketersediaan GPU dideteksi dari `nvidia-smi` jika tool itu terlihat di container; tidak ditemukannya tool tersebut belum membuktikan host fisik tidak punya GPU. Script menampilkan RAM host-visible dan limit cgroup bila tersedia. VoxCPM2 2B mendukung CPU sebagai pilihan perangkat, tetapi performanya bisa sangat lambat. Pastikan provider mengizinkan binary execution, koneksi HTTPS keluar, proses background, dan storage persisten.

Ollama memakai URL paket resmi `https://ollama.com/download/ollama-linux-amd64.tar.zst` (atau arm64 sesuai arsitektur). Script memasang binary ke `$HOME/.local/bin/ollama`, tanpa menulis ke `/usr`. Setelah bootstrap selesai, restart bot dan jalankan `.remotion services`. Bila panel membutuhkan environment path eksplisit, gunakan nilai `VIDEO_STUDIO_OLLAMA_BIN` yang dicetak script.

## Automatic local service startup

The bot now attempts to start the local services when you run `.remotion services` or generate a video. It starts `ollama serve` only when the Ollama binary is installed and the loopback endpoint is not responding. It starts the VoxCPM2 adapter only when the Python virtualenv, adapter file and local VoxCPM2 model are present. It does not install packages, download model weights, or call a hosted provider.

Defaults:
- Ollama: `http://127.0.0.1:11434`, model `qwen2.5:7b`.
- VoxCPM2: `http://127.0.0.1:7861`, Python `.venv-voxcpm/bin/python`, model directory `$HOME/alvareth-models/VoxCPM2`.
- `VIDEO_STUDIO_LOCAL_SERVICES_AUTOSTART=true`; set it to `false` to disable process startup.
- `VOXCPM_DEVICE` may be `cuda` or `cpu`; leave it blank to detect CUDA through the installed PyTorch.

Install/pull the Ollama model once:
```bash
ollama pull qwen2.5:7b
```

Prepare VoxCPM2 once (install a PyTorch build matching the VPS GPU/driver before installing the pinned adapter requirements):
```bash
python3 -m venv .venv-voxcpm
.venv-voxcpm/bin/pip install --upgrade pip
.venv-voxcpm/bin/pip install -r video-studio/services/voxcpm/requirements.txt
mkdir -p "$HOME/alvareth-models/VoxCPM2"
.venv-voxcpm/bin/hf download openbmb/VoxCPM2 --local-dir "$HOME/alvareth-models/VoxCPM2"
```

If the model is stored elsewhere, set `VOXCPM_MODEL_PATH` in the private server environment. If the Python executable is elsewhere, set `VIDEO_STUDIO_VOXCPM_PYTHON`. The adapter process is detached from the bot worker and bound to loopback. Its private startup/error logs are written under $ALVARETH_DATA_DIR/video-studio/logs/ (default ~/.alvareth-bot-data/video-studio/logs/); inspect ollama.log or voxcpm2.log if a process exits. The bot reports a missing binary, virtualenv, model, unloaded model, or missing Ollama model separately. Run `.remotion services` again after setup and wait until both direct checks are green.

This is process autostart, not provisioning: the server still needs enough RAM/VRAM, disk, compatible PyTorch/CUDA and model weights. A green health check is not a substitute for a real narration and MP4 test.

## Optional ComfyUI

No default visual/music model is silently chosen. Audit model license, node source, all network-capable nodes and memory requirements. Use only non-WAN local workflows. Put approved API-format graphs outside Git secrets/data, calculate `sha256sum /path/to/workflow.json`, and add the exact digest to comma-separated `VIDEO_STUDIO_COMFYUI_REVIEWED_SHA256`. Set the relevant VIDEO_STUDIO_COMFYUI_*_WORKFLOW_FILE and loopback URL. Hash checks pin reviewed bytes; they cannot prove custom-node behavior or detect a renamed banned model. The operator review is necessary.

Without suitable visual workflows the output is designed motion graphics, not generated character animation/photorealistic footage. Without suitable music, there is no music. SFX are generated locally and require no model.

## WhatsApp commands

`.remotion` provides seven menu actions: generate, status, history, resend, services, guide, cancel. `.remotion <natural prompt>` also works. Every plugin invocation requires `isROwner === true`; the router retains its own owner check. Prompt sessions require matching sender and chat; another owner cannot cancel that session. Cancellation only cancels input, not a queued render. Job history/output can be accessed by authorized owners. `/services` is configuration plus live Ollama/VoxCPM2 health, not an end-to-end guarantee.

## Sound and timing

The planner selects a scene cue and overlay delays. `engine/sound-design.js` converts visible entry/transition/notification/callout events to frame positions shared with the scene. Nine procedural effects have bounded peaks, short fades and speech attenuation. Cues too close together are deduplicated and effects that cannot finish before scene end are omitted. Each motion does not automatically deserve a noise. Optional music uses only a supplied/generated local track.

Narration WAV is probed and fully decoded before use. Scene durations expand to complete speech plus breathing space, quantized to project FPS. Longer than 19.7 seconds spoken per scene or 300 seconds total fails clearly rather than truncating narration.

## Acceptance tests

```bash
npm test
python3 -m unittest discover -s tests -p '*_test.py'
# Real services required; this must produce actual VoxCPM2 narration:
npm run test:remotion-live
# Renderer-only fixed storyboard, explicitly NOT an AI or speech test:
node scripts/remotion-smoke.js --fixture
```

Smoke output defaults to /tmp/alvareth-remotion-smoke; override REMOTION_SMOKE_DIR to retain it. A successful smoke includes H.264 video, audio, correct dimensions, full FFmpeg decode and JSON probe evidence. Listen to voice/SFX, inspect transitions/subtitles, then test all seven actions plus a non-owner account on real WhatsApp. CI fixture rendering never establishes that VoxCPM2 or WhatsApp works on the VPS.

See REMOTION_LOCAL_LICENSES.md for licensing and REMOTION_AUDIT_2026-11-06.md for this session's evidence and limitations.
