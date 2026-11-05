#!/usr/bin/env bash
# Rootless bootstrap for Alvareth Remotion on Pterodactyl/Debian containers.
# No apt, sudo, systemd, paid API, or global Python package changes.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOCAL_PREFIX="${HOME}/.local"
LOCAL_BIN="${LOCAL_PREFIX}/bin"
OLLAMA_BIN="${LOCAL_BIN}/ollama"
VENV="${ROOT}/.venv-voxcpm"
MODEL_DIR="${VOXCPM_MODEL_PATH:-${HOME}/alvareth-models/VoxCPM2}"
LOG_DIR="${ALVARETH_DATA_DIR:-${HOME}/.alvareth-bot-data}/video-studio/logs"
WITH_MODELS=0

for arg in "$@"; do
  case "$arg" in
    --with-models) WITH_MODELS=1 ;;
    --help|-h)
      cat <<'HELP'
Usage: bash scripts/setup-video-studio-linux.sh [--with-models]

Installs Ollama and uv into ~/.local, creates a Python 3.11 virtualenv
without ensurepip, and installs the pinned VoxCPM2 adapter dependencies.

By default, large model weights are NOT downloaded.
Pass --with-models to start local Ollama, pull qwen2.5:7b, and download
openbmb/VoxCPM2 weights into $HOME/alvareth-models/VoxCPM2.

Optional:
  VOXCPM_TORCH_INDEX_URL=https://download.pytorch.org/whl/cuXXX
      Select the exact PyTorch CUDA wheel index compatible with the host driver.
  VOXCPM_TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
      Force CPU-only PyTorch.
  VOXCPM_MODEL_PATH=/absolute/path
      Override the VoxCPM2 model directory.
HELP
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "[Alvareth setup] ERROR: $*" >&2; exit 1; }
info() { echo "[Alvareth setup] $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(uname -s)" = "Linux" ] || fail "Script ini hanya untuk Linux."
case "$(uname -m)" in
  x86_64|amd64) OLLAMA_ARCH="amd64" ;;
  aarch64|arm64) OLLAMA_ARCH="arm64" ;;
  *) fail "Arsitektur $(uname -m) belum didukung oleh bootstrap Ollama ini." ;;
esac
have tar || fail "Perintah tar tidak tersedia pada container."
if ! have curl && ! have wget; then fail "Container membutuhkan curl atau wget untuk mengunduh runtime."; fi

download() {
  local url="$1" output="$2"
  if have curl; then
    curl -fL --retry 3 --connect-timeout 20 "$url" -o "$output"
  else
    wget -O "$output" "$url"
  fi
}

mkdir -p "$LOCAL_BIN" "$LOCAL_PREFIX/lib/ollama" "$LOG_DIR"

# Install official Ollama Linux archive into the writable user prefix.
if ! have ollama && [ ! -x "$OLLAMA_BIN" ]; then
  info "Mengunduh binary resmi Ollama untuk Linux ${OLLAMA_ARCH} ke ${LOCAL_PREFIX} (tanpa root)..."
  TMP_OLLAMA="$(mktemp -d)"
  trap 'rm -rf "$TMP_OLLAMA"' EXIT
  download "https://ollama.com/download/ollama-linux-${OLLAMA_ARCH}.tgz" "$TMP_OLLAMA/ollama.tgz"
  tar -tzf "$TMP_OLLAMA/ollama.tgz" | grep -Eq '(^|/)bin/ollama$' || fail "Arsip Ollama tidak berisi bin/ollama."
  tar -xzf "$TMP_OLLAMA/ollama.tgz" -C "$LOCAL_PREFIX"
  chmod 755 "$OLLAMA_BIN"
  rm -rf "$TMP_OLLAMA"
  trap - EXIT
fi

if have ollama; then
  DETECTED_OLLAMA="$(command -v ollama)"
else
  DETECTED_OLLAMA="$OLLAMA_BIN"
fi
[ -x "$DETECTED_OLLAMA" ] || fail "Binary Ollama tidak ditemukan setelah instalasi: $DETECTED_OLLAMA"
info "Ollama binary: $DETECTED_OLLAMA"
"$DETECTED_OLLAMA" --version

# Install uv as a standalone user binary. uv does not depend on Python/ensurepip.
if ! have uv && [ ! -x "$LOCAL_BIN/uv" ]; then
  info "Memasang uv ke ${LOCAL_BIN}..."
  TMP_UV="$(mktemp -d)"
  trap 'rm -rf "$TMP_UV"' EXIT
  download "https://astral.sh/uv/install.sh" "$TMP_UV/install-uv.sh"
  UV_INSTALL_DIR="$LOCAL_BIN" UV_NO_MODIFY_PATH=1 sh "$TMP_UV/install-uv.sh"
  rm -rf "$TMP_UV"
  trap - EXIT
fi
UV_BIN="$(command -v uv || true)"
if [ -z "$UV_BIN" ]; then UV_BIN="$LOCAL_BIN/uv"; fi
[ -x "$UV_BIN" ] || fail "uv gagal dipasang. Periksa koneksi HTTPS dan izin tulis HOME."
export PATH="$LOCAL_BIN:$PATH"
info "uv: $("$UV_BIN" --version)"

# VoxCPM2 upstream supports Python 3.10-3.12. Use managed Python 3.11 so
# Debian's missing python3-venv/ensurepip package is not required.
info "Menyiapkan Python 3.11 terkelola oleh uv..."
"$UV_BIN" python install 3.11
if [ -e "$VENV" ]; then
  case "$VENV" in
    "$ROOT/.venv-voxcpm") rm -rf -- "$VENV" ;;
    *) fail "Lokasi virtualenv tidak aman: $VENV" ;;
  esac
fi
"$UV_BIN" venv --python 3.11 "$VENV"
PYTHON="$VENV/bin/python"
[ -x "$PYTHON" ] || fail "Virtualenv gagal dibuat: $VENV"

# Pick CPU wheels when no NVIDIA GPU is exposed. For CUDA, users may pass the
# official PyTorch index URL matching their driver/CUDA compatibility.
if [ -n "${VOXCPM_TORCH_INDEX_URL:-}" ]; then
  info "Memasang PyTorch dari index yang dipilih: ${VOXCPM_TORCH_INDEX_URL}"
  "$UV_BIN" pip install --python "$PYTHON" torch torchaudio --index-url "$VOXCPM_TORCH_INDEX_URL"
elif have nvidia-smi && nvidia-smi >/dev/null 2>&1; then
  info "GPU NVIDIA terdeteksi. Memasang PyTorch dari PyPI; verifikasi CUDA akan dilakukan sesudah instalasi."
  "$UV_BIN" pip install --python "$PYTHON" torch torchaudio
else
  info "Tidak ada GPU NVIDIA yang terlihat. Memasang PyTorch CPU; inference VoxCPM2 dapat sangat lambat."
  "$UV_BIN" pip install --python "$PYTHON" torch torchaudio --index-url "https://download.pytorch.org/whl/cpu"
fi

info "Memasang adapter VoxCPM2 pada commit yang dipin di requirements.txt..."
"$UV_BIN" pip install --python "$PYTHON" -r video-studio/services/voxcpm/requirements.txt

"$PYTHON" - <<'PY'
import sys
import torch
print("Python:", sys.version.split()[0])
print("PyTorch:", torch.__version__)
print("CUDA available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))
try:
    import voxcpm
    print("VoxCPM import: OK")
except Exception as exc:
    print("VoxCPM import failed:", repr(exc))
    raise
PY

[ -x "$VENV/bin/hf" ] || fail "Perintah hf tidak terpasang; huggingface-hub CLI tidak ditemukan."

if [ "$WITH_MODELS" -eq 1 ]; then
  have curl || fail "--with-models membutuhkan curl untuk health check Ollama."
  if ! curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    info "Menyalakan Ollama lokal untuk mengunduh model..."
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
  info "Mengunduh model planner qwen2.5:7b..."
  "$DETECTED_OLLAMA" pull "${VIDEO_STUDIO_OLLAMA_MODEL:-qwen2.5:7b}"
  info "Mengunduh bobot VoxCPM2 ke ${MODEL_DIR}..."
  mkdir -p "$MODEL_DIR"
  "$VENV/bin/hf" download openbmb/VoxCPM2 --local-dir "$MODEL_DIR"
fi

cat <<SUMMARY

[Alvareth setup] Runtime berhasil disiapkan.

Tambahkan/cek environment berikut pada panel hosting (jika panel meminta path absolut):
  VIDEO_STUDIO_OLLAMA_BIN=${DETECTED_OLLAMA}
  VIDEO_STUDIO_OLLAMA_URL=http://127.0.0.1:11434
  VIDEO_STUDIO_OLLAMA_MODEL=${VIDEO_STUDIO_OLLAMA_MODEL:-qwen2.5:7b}
  VIDEO_STUDIO_VOXCPM_URL=http://127.0.0.1:7861
  VIDEO_STUDIO_LOCAL_SERVICES_AUTOSTART=true
  VOXCPM_MODEL_PATH=${MODEL_DIR}
  VOXCPM_DEVICE=auto

Virtualenv:
  ${PYTHON}

Model directory:
  ${MODEL_DIR}

Logs:
  ${LOG_DIR}

Selanjutnya restart bot, lalu kirim:
  .remotion services

Catatan: --with-models mengunduh bobot besar. Tanpa flag tersebut, binary/dependencies
sudah disiapkan tetapi model qwen2.5:7b dan VoxCPM2 belum diunduh.
SUMMARY

if ! have nvidia-smi || ! nvidia-smi >/dev/null 2>&1; then
  echo "[PERINGATAN] Container tidak menampilkan GPU NVIDIA. VoxCPM2 berjalan di CPU dan mungkin tidak praktis untuk produksi."
fi
