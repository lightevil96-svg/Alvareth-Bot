#!/usr/bin/env bash
# Rootless bootstrap for Alvareth Remotion on Pterodactyl/Linux containers.
# Uses only user-writable paths; no apt, sudo, systemd, or shell installer.
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOCAL_PREFIX="${HOME}/.local"
LOCAL_BIN="${LOCAL_PREFIX}/bin"
OLLAMA_BIN="${LOCAL_BIN}/ollama"
VENV="${ROOT}/.venv-voxcpm"
MODEL_DIR="${VOXCPM_MODEL_PATH:-${HOME}/alvareth-models/VoxCPM2}"
LOG_DIR="${ALVARETH_DATA_DIR:-${HOME}/.alvareth-bot-data}/video-studio/logs"
LOCK_DIR="${LOG_DIR}/setup.lock"
EXIT_CODE_FILE="${LOG_DIR}/setup.exit-code"
TMP_UV=""
UV_VERSION="${UV_VERSION:-0.13.7}"
WITH_MODELS=0
ALLOW_CPU="${VOXCPM_ALLOW_CPU:-0}"

for arg in "$@"; do
  case "$arg" in
    --with-models) WITH_MODELS=1 ;;
    --allow-cpu) ALLOW_CPU=1 ;;
    --help|-h)
      cat <<'HELP'
Usage: bash scripts/setup-video-studio-linux.sh [--allow-cpu] [--with-models]

Installs uv, Python 3.11, the VoxCPM2 adapter and Ollama under user-writable
paths. No apt, sudo, systemd, or ensurepip is required.

Default: prepare runtimes/dependencies only. Large model weights are not downloaded.
--with-models: start local Ollama, pull the configured planner model, and download
               openbmb/VoxCPM2 weights.
--allow-cpu:   explicitly allow CPU-only VoxCPM2 (can be very slow).

Optional environment:
  VIDEO_STUDIO_OLLAMA_MODEL=qwen2.5:7b
  VIDEO_STUDIO_OLLAMA_BIN=/absolute/path/to/ollama
  VOXCPM_MODEL_PATH=/absolute/path/to/VoxCPM2
  VOXCPM_TORCH_INDEX_URL=https://download.pytorch.org/whl/cuXXX
  VOXCPM_TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
  UV_VERSION=0.13.7
HELP
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "[Alvareth setup] ERROR: $*" >&2; exit 1; }
info() { echo "[Alvareth setup] $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# Serialize installs and persist a result for the WhatsApp status command.
mkdir -p "$LOG_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  EXISTING_PID=""
  for _ in 1 2 3 4 5; do
    EXISTING_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    [ -n "$EXISTING_PID" ] && break
    sleep 1
  done
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    EXISTING_CMD="$(tr '\0' ' ' < "/proc/$EXISTING_PID/cmdline" 2>/dev/null || true)"
    case "$EXISTING_CMD" in
      *setup-video-studio-linux.sh*) fail "Installer lain masih berjalan dengan PID $EXISTING_PID." ;;
    esac
  fi
  rm -rf -- "$LOCK_DIR"
  mkdir "$LOCK_DIR" || fail "Tidak dapat membuat lock installer."
fi
chmod 700 "$LOG_DIR" "$LOCK_DIR" 2>/dev/null || true
printf '%s\n' "$BASHPID" > "$LOCK_DIR/pid"
rm -f -- "$EXIT_CODE_FILE"

finish_setup() {
  local code=$?
  trap - EXIT
  if [ -n "$TMP_UV" ]; then rm -rf -- "$TMP_UV" || true; fi
  printf '%s\n' "$code" > "$EXIT_CODE_FILE.tmp.$BASHPID"
  mv -f -- "$EXIT_CODE_FILE.tmp.$BASHPID" "$EXIT_CODE_FILE" || true
  rm -rf -- "$LOCK_DIR" || true
  exit "$code"
}
trap finish_setup EXIT
trap 'exit 130' INT TERM

[ "$(uname -s)" = "Linux" ] || fail "Script ini hanya untuk Linux."
case "$(uname -m)" in
  x86_64|amd64)
    OLLAMA_ARCH="amd64"
    UV_ARCHIVE="uv-x86_64-unknown-linux-musl.tar.gz"
    ;;
  aarch64|arm64)
    OLLAMA_ARCH="arm64"
    UV_ARCHIVE="uv-aarch64-unknown-linux-musl.tar.gz"
    ;;
  *) fail "Arsitektur $(uname -m) belum didukung." ;;
esac
have tar || fail "Perintah tar tidak tersedia."
have curl || fail "Perintah curl diperlukan untuk mengunduh runtime."
have find || fail "Perintah find tidak tersedia."
mkdir -p "$LOCAL_BIN" "$LOCAL_PREFIX/lib/ollama" "$LOG_DIR"
export PATH="$LOCAL_BIN:$PATH"

GPU_AVAILABLE=0
GPU_DESCRIPTION=""
if have nvidia-smi; then
  GPU_DESCRIPTION="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -n 1 || true)"
  if [ -n "$GPU_DESCRIPTION" ]; then GPU_AVAILABLE=1; fi
fi
if [ "$GPU_AVAILABLE" -ne 1 ] && [ "$ALLOW_CPU" != "1" ]; then
  fail "GPU NVIDIA tidak terlihat dari container. Tidak ada paket yang dipasang. Jika server memang CPU-only dan kamu menerima performa lambat, jalankan .remotion install cpu atau bash scripts/setup-video-studio-linux.sh --allow-cpu --with-models."
fi
if [ "$GPU_AVAILABLE" -eq 1 ]; then
  info "GPU terdeteksi: $GPU_DESCRIPTION"
else
  info "Mode CPU dipilih secara eksplisit. VoxCPM2 2B dapat berjalan di CPU, tetapi inferensi bisa sangat lambat."
fi
if have df; then
  df -Pk "$HOME" | tail -n 1 | awk '{printf "[Alvareth setup] Storage available: %.1f GiB\n", $4/1048576}'
fi

download() {
  curl -fL --retry 3 --connect-timeout 20 "$1" -o "$2"
}

# Install the standalone uv release binary directly. Do not invoke install.sh:
# some restricted game-server shells wrap /bin/sh and reject its option parsing.
if ! have uv && [ ! -x "$LOCAL_BIN/uv" ]; then
  info "Mengunduh uv ${UV_VERSION} (binary standalone)..."
  TMP_UV="$(mktemp -d)"
  download "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_ARCHIVE}" "$TMP_UV/uv.tar.gz"
  tar -xzf "$TMP_UV/uv.tar.gz" -C "$TMP_UV"
  UV_SOURCE="$(find "$TMP_UV" -type f -name uv -print -quit)"
  [ -n "$UV_SOURCE" ] || fail "Arsip uv tidak berisi binary uv."
  cp "$UV_SOURCE" "$LOCAL_BIN/uv"
  chmod 755 "$LOCAL_BIN/uv"
  rm -rf "$TMP_UV"
  TMP_UV=""
fi
UV_BIN="$(command -v uv || true)"
[ -n "$UV_BIN" ] || UV_BIN="$LOCAL_BIN/uv"
[ -x "$UV_BIN" ] || fail "Binary uv tidak ditemukan."
info "uv: $("$UV_BIN" --version)"

# uv provisions Python itself, bypassing Debian's missing python3-venv/ensurepip.
info "Menyiapkan Python 3.11 terkelola oleh uv..."
"$UV_BIN" python install 3.11
if [ -e "$VENV" ] && [ ! -x "$VENV/bin/python" ]; then
  info "Menghapus virtualenv lama yang tidak lengkap..."
  rm -rf -- "$VENV"
fi
if [ ! -x "$VENV/bin/python" ]; then
  "$UV_BIN" venv --python 3.11 "$VENV"
fi
PYTHON="$VENV/bin/python"
[ -x "$PYTHON" ] || fail "Virtualenv gagal dibuat: $VENV"

# The current official Ollama Linux package is .tar.zst, not the obsolete .tgz.
# Install zstandard into the isolated venv and stream-extract into ~/.local.
DETECTED_OLLAMA="${VIDEO_STUDIO_OLLAMA_BIN:-}"
if [ -n "$DETECTED_OLLAMA" ]; then
  [ -x "$DETECTED_OLLAMA" ] || fail "VIDEO_STUDIO_OLLAMA_BIN tidak executable: $DETECTED_OLLAMA"
elif have ollama; then
  DETECTED_OLLAMA="$(command -v ollama)"
elif [ -x "$OLLAMA_BIN" ]; then
  DETECTED_OLLAMA="$OLLAMA_BIN"
else
  info "Memasang modul decompressor zstandard di virtualenv..."
  "$UV_BIN" pip install --python "$PYTHON" zstandard
  info "Mengunduh paket resmi Ollama Linux ${OLLAMA_ARCH} (.tar.zst) dan mengekstraknya ke ${LOCAL_PREFIX}..."
  curl -fL --retry 3 --connect-timeout 20 --progress-bar \
    "https://ollama.com/download/ollama-linux-${OLLAMA_ARCH}.tar.zst" \
    | "$PYTHON" scripts/extract-ollama-tar-zst.py "$LOCAL_PREFIX"
  [ -x "$OLLAMA_BIN" ] || fail "Ekstraksi selesai tetapi $OLLAMA_BIN tidak ditemukan."
  chmod 755 "$OLLAMA_BIN"
  DETECTED_OLLAMA="$OLLAMA_BIN"
fi
info "Ollama binary: $DETECTED_OLLAMA"
"$DETECTED_OLLAMA" --version

# Report host and container memory without requiring the optional free command.
"$PYTHON" - <<'PY'
from pathlib import Path
mem = {}
try:
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith(("MemTotal:", "MemAvailable:")):
            key, value, *_ = line.split()
            mem[key.rstrip(":")] = int(value) // 1024
except OSError:
    pass
print("[Alvareth setup] Host-visible RAM:", f"{mem.get('MemTotal', 'unknown')} MiB")
print("[Alvareth setup] Host-visible available RAM:", f"{mem.get('MemAvailable', 'unknown')} MiB")
for p in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
    try:
        value = Path(p).read_text().strip()
        if value != "max" and value.isdigit() and int(value) < 2**60:
            print("[Alvareth setup] Container memory limit:", f"{int(value)//(1024*1024)} MiB")
            break
    except OSError:
        continue
PY

# CPU-only must be explicit. PyTorch CPU wheels come from the official CPU index.
if [ -n "${VOXCPM_TORCH_INDEX_URL:-}" ]; then
  info "Memasang PyTorch dari index: ${VOXCPM_TORCH_INDEX_URL}"
  "$UV_BIN" pip install --python "$PYTHON" torch torchaudio --index-url "$VOXCPM_TORCH_INDEX_URL"
elif [ "$GPU_AVAILABLE" -eq 1 ]; then
  info "GPU NVIDIA terdeteksi. Memasang PyTorch; periksa hasil CUDA di bawah..."
  "$UV_BIN" pip install --python "$PYTHON" torch torchaudio
else
  [ "$ALLOW_CPU" = "1" ] || fail "GPU NVIDIA tidak terlihat di container. Jika memang ingin mencoba CPU, jalankan: bash scripts/setup-video-studio-linux.sh --allow-cpu"
  info "Memasang PyTorch CPU. VoxCPM2 dapat berjalan sangat lambat tanpa GPU."
  "$UV_BIN" pip install --python "$PYTHON" torch torchaudio --index-url "https://download.pytorch.org/whl/cpu"
fi

info "Memasang adapter VoxCPM2 pada commit yang dipin di requirements.txt..."
"$UV_BIN" pip install --python "$PYTHON" -r video-studio/services/voxcpm/requirements.txt

"$PYTHON" - <<'PY'
import sys
import torch
print("[Alvareth setup] Python:", sys.version.split()[0])
print("[Alvareth setup] PyTorch:", torch.__version__)
print("[Alvareth setup] CUDA available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("[Alvareth setup] GPU:", torch.cuda.get_device_name(0))
import voxcpm
print("[Alvareth setup] VoxCPM import: OK")
PY

[ -x "$VENV/bin/hf" ] || fail "Perintah hf tidak terpasang; huggingface-hub CLI tidak ditemukan."

if [ "$WITH_MODELS" -eq 1 ]; then
  info "Menyiapkan Ollama loopback untuk unduhan model..."
  if ! curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    mkdir -p "${HOME}/.ollama/models"
    nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 \
      OLLAMA_MODELS="${HOME}/.ollama/models" \
      "$DETECTED_OLLAMA" serve >> "$LOG_DIR/ollama.log" 2>&1 </dev/null &
  fi
  READY=0
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then READY=1; break; fi
    sleep 2
  done
  [ "$READY" -eq 1 ] || fail "Ollama tidak siap setelah 120 detik. Log: $LOG_DIR/ollama.log"
  info "Mengunduh planner model ${VIDEO_STUDIO_OLLAMA_MODEL:-qwen2.5:7b}..."
  "$DETECTED_OLLAMA" pull "${VIDEO_STUDIO_OLLAMA_MODEL:-qwen2.5:7b}"
  info "Mengunduh bobot VoxCPM2 ke ${MODEL_DIR}..."
  mkdir -p "$MODEL_DIR"
  "$VENV/bin/hf" download openbmb/VoxCPM2 --local-dir "$MODEL_DIR"
fi

cat <<SUMMARY

[Alvareth setup] Runtime berhasil disiapkan.

VIDEO_STUDIO_OLLAMA_BIN=${DETECTED_OLLAMA}
VIDEO_STUDIO_OLLAMA_URL=http://127.0.0.1:11434
VIDEO_STUDIO_OLLAMA_MODEL=${VIDEO_STUDIO_OLLAMA_MODEL:-qwen2.5:7b}
VIDEO_STUDIO_VOXCPM_URL=http://127.0.0.1:7861
VIDEO_STUDIO_LOCAL_SERVICES_AUTOSTART=true
VOXCPM_MODEL_PATH=${MODEL_DIR}
VOXCPM_DEVICE=auto

Virtualenv: ${PYTHON}
Model directory: ${MODEL_DIR}
Logs: ${LOG_DIR}

Runtime dan model sudah disiapkan. Kirim: .remotion services, lalu buat video. VoxCPM2 akan dimuat otomatis saat narasi pertama diperlukan.
SUMMARY
