# Alvareth Remotion — local Linux setup

Current pipeline: owner WhatsApp → local Ollama JSON storyboard → schema/compiler → single-worker queue → local VoxCPM2 → optional reviewed local ComfyUI → deterministic Remotion → MP4 sent to the originating WhatsApp chat. This is WhatsApp-only: no LightJurnal remote-render API, public Video Studio endpoint, Cloudflare Tunnel, cloudflared process, or tunnel/API token is required.

## Requirements

Node.js 22+, Python 3.10+ (3.11 recommended), FFmpeg/FFprobe, Chromium dependencies, disk space for model weights and renders. A CUDA-capable GPU is strongly preferable for VoxCPM2 and any visual generation. CPU is selectable but throughput/RAM must be measured; no minimum VRAM or real-time claim is made. Ollama unloads after planning (keep_alive=0); the TTS service serializes synthesis. Run one bot process for this filesystem-backed queue, not multiple replicas sharing jobs.json.

## Install in an existing checkout

Preserve .env, sessions and database. If the checkout has local edits, resolve them before switching branches. Do not overwrite .env with the example.

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

Bootstrap ini tidak memerlukan `sudo`, `apt`, atau `systemd`. Mode GPU memerlukan GPU NVIDIA yang terlihat dari container melalui `nvidia-smi`; jika tool tidak terlihat, hal itu belum membuktikan host fisik tidak punya GPU karena GPU passthrough mungkin belum aktif. Mode CPU harus dipilih secara eksplisit dengan `--allow-cpu`. Script menampilkan RAM host-visible, limit cgroup, dan ruang storage bila tersedia. VoxCPM2 2B mendukung CPU, tetapi performanya dapat sangat lambat. Pastikan provider mengizinkan binary execution, koneksi HTTPS keluar, proses background, dan storage persisten.

Ollama memakai URL paket resmi `https://ollama.com/download/ollama-linux-amd64.tar.zst` (atau arm64 sesuai arsitektur). Script memasang binary ke `$HOME/.local/bin/ollama`, tanpa menulis ke `/usr`. Setelah bootstrap selesai, restart bot dan jalankan `.remotion services`. Bila panel membutuhkan environment path eksplisit, gunakan nilai `VIDEO_STUDIO_OLLAMA_BIN` yang dicetak script.

## Install engine langsung dari WhatsApp

Setelah commit terbaru sudah ada di server dan bot berjalan, owner tidak perlu masuk console untuk memasang runtime/model. Kirim perintah berikut di chat WhatsApp bot:

```text
.remotion install
```

Perintah tersebut mendeteksi GPU NVIDIA di container, lalu menjalankan installer di background dengan `--with-models`. Installer memasang `uv`, Python 3.11, Ollama, PyTorch, adapter VoxCPM2 pada commit upstream yang dipin, kemudian mengunduh model planner Qwen dan bobot VoxCPM2. Log dan status tersimpan di data directory bot.

Perintah lain:

- `.remotion install status` — melihat apakah installer berjalan, hasil exit code, dan potongan log terakhir.
- `.remotion install cpu` — memilih CPU secara eksplisit jika GPU NVIDIA tidak tersedia/di-pass-through. CPU bisa sangat lambat; periksa RAM dan disk sebelum menjalankannya.

Jika tidak ada GPU NVIDIA yang terlihat, `.remotion install` berhenti sebelum mengunduh runtime/model dan meminta pilihan CPU secara eksplisit. Acuan upstream VoxCPM2 2B sekitar 8 GB VRAM; kebutuhan aktual bergantung pada device dan konfigurasi. CPU didukung, tetapi bukan jaminan performa layak untuk produksi.

Installer ini tidak memasang FFmpeg/FFprobe, Chromium OS libraries, atau dependency npm bot. Pada server yang dibahas, pemeriksaan sebelumnya sudah mendeteksi Remotion + FFmpeg. Jika komponen itu tidak tersedia, pasang lewat image/container hosting atau administrator server. ComfyUI, workflow footage, dan musik tetap opsional dan tidak diunduh oleh installer inti.

Jangan menjalankan dua instalasi bersamaan atau menghapus folder data/log saat proses berjalan. Setelah exit code 0, jalankan `.remotion services`; Ollama akan dipakai untuk planner, sedangkan adapter VoxCPM2 dimulai otomatis saat video pertama kali membutuhkan narasi.
## Automatic local service startup

The bot starts local services only when the production step needs them: Ollama for storyboard planning, then VoxCPM2 when narration is present. This avoids loading the 7B planner and 2B TTS model together during a redundant preflight. `.remotion services` is status-only and does not load models. Runtime startup never installs packages, downloads model weights, or calls a hosted provider. VoxCPM2 cold-start wait defaults to 10 minutes and can be adjusted with `VIDEO_STUDIO_VOXCPM_STARTUP_TIMEOUT_MS`.

Defaults:
- Ollama: `http://127.0.0.1:11434`, model `qwen2.5:7b`.
- VoxCPM2: `http://127.0.0.1:7861`, Python `.venv-voxcpm/bin/python`, model directory `$HOME/alvareth-models/VoxCPM2`.
- `VIDEO_STUDIO_LOCAL_SERVICES_AUTOSTART=true`; set it to `false` to disable process startup.
- `VIDEO_STUDIO_VOXCPM_STARTUP_TIMEOUT_MS=600000`; maximum wait for VoxCPM2 to load its local model (10 minutes by default).
- `VOXCPM_DEVICE` may be `cuda` or `cpu`; leave it blank to detect CUDA through the installed PyTorch.

For a rootless/Pterodactyl installation, use the bootstrap above rather than the Debian `python3 -m venv` commands. It can also download both models when run with `--with-models`. If downloading models separately, use the full Ollama path if `~/.local/bin` is not on the panel's PATH:
```bash
~/.local/bin/ollama pull qwen2.5:7b
.venv-voxcpm/bin/hf download openbmb/VoxCPM2 --local-dir "$HOME/alvareth-models/VoxCPM2"
```

If the model is stored elsewhere, set `VOXCPM_MODEL_PATH` in the private server environment. If the Python executable is elsewhere, set `VIDEO_STUDIO_VOXCPM_PYTHON`. The adapter process is detached from the bot worker and bound to loopback. Its private startup/error logs are written under $ALVARETH_DATA_DIR/video-studio/logs/ (default ~/.alvareth-bot-data/video-studio/logs/); inspect ollama.log or voxcpm2.log if a process exits. The bot reports a missing binary, virtualenv, model, unloaded model, or missing Ollama model separately. Run `.remotion services` again after setup and wait until both direct checks are green.

Service autostart itself is not provisioning; `.remotion install` provisions the local runtime and model weights. The server still needs enough RAM/VRAM, disk, compatible PyTorch/CUDA and network access. A green health check is not a substitute for a real narration and MP4 test.

## Optional ComfyUI

No default visual/music model is silently chosen. Audit model license, node source, all network-capable nodes and memory requirements. Use only non-WAN local workflows. Put approved API-format graphs outside Git secrets/data, calculate `sha256sum /path/to/workflow.json`, and add the exact digest to comma-separated `VIDEO_STUDIO_COMFYUI_REVIEWED_SHA256`. Set the relevant VIDEO_STUDIO_COMFYUI_*_WORKFLOW_FILE and loopback URL. Hash checks pin reviewed bytes; they cannot prove custom-node behavior or detect a renamed banned model. The operator review is necessary.

Without suitable visual workflows the output is designed motion graphics, not generated character animation/photorealistic footage. Without suitable music, there is no music. SFX are generated locally and require no model.

## WhatsApp-only operation

The .remotion plugin is the only Video Studio control surface. The bot plans, renders, stores and sends the MP4 inside its own WhatsApp workflow. No external website, public render endpoint, Cloudflare Tunnel, cloudflared, VIDEO_STUDIO_API_KEY, or tunnel token is part of this design. The optional Alvareth /health endpoint is hosting monitoring only and cannot submit or download Video Studio jobs.

## WhatsApp commands

`.remotion` provides eight menu actions: generate, status, history, resend, services, install, guide, cancel. `.remotion <natural prompt>` also works. Every plugin invocation requires `isROwner === true`; the router retains its own owner check. Prompt sessions require matching sender and chat; another owner cannot cancel that session. Cancellation only cancels input, not a queued render. Job history/output can be accessed by authorized owners. `/services` is configuration plus live Ollama/VoxCPM2 health, not an end-to-end guarantee. `.remotion install` provisions local runtimes and model weights; `.remotion install status` reports the installer.

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

Smoke output defaults to /tmp/alvareth-remotion-smoke; override REMOTION_SMOKE_DIR to retain it. A successful smoke includes H.264 video, audio, correct dimensions, full FFmpeg decode and JSON probe evidence. Listen to voice/SFX, inspect transitions/subtitles, then test all eight actions plus a non-owner account on real WhatsApp. CI fixture rendering never establishes that VoxCPM2 or WhatsApp works on the VPS.

See REMOTION_LOCAL_LICENSES.md for licensing and REMOTION_AUDIT_2026-11-06.md for this session's evidence and limitations.
