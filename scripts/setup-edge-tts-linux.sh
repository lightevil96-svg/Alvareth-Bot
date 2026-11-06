#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${HOME:-$ROOT}"
UV_BIN=""

if command -v uv >/dev/null 2>&1; then
  UV_BIN="$(command -v uv)"
elif [[ -x "$HOME_DIR/.local/bin/uv" ]]; then
  UV_BIN="$HOME_DIR/.local/bin/uv"
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "[EDGE-TTS-INSTALL] curl tidak tersedia; pasang curl atau uv terlebih dahulu." >&2
    exit 1
  fi
  echo "[EDGE-TTS-INSTALL] Mengunduh installer uv (tanpa PyTorch/VoxCPM2)..."
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HOME_DIR/.local/bin" sh
  UV_BIN="$HOME_DIR/.local/bin/uv"
fi

VENV="$ROOT/.venv-edge-tts"
PYTHON="$VENV/bin/python"
REQUIREMENTS="$ROOT/video-studio/services/edge_tts/requirements.txt"

echo "[EDGE-TTS-INSTALL] Menyiapkan Python 3.11 ringan..."
"$UV_BIN" python install 3.11
echo "[EDGE-TTS-INSTALL] Membuat virtualenv $VENV..."
"$UV_BIN" venv --python 3.11 "$VENV"
echo "[EDGE-TTS-INSTALL] Memasang dependensi TTS online..."
"$UV_BIN" pip install --python "$PYTHON" -r "$REQUIREMENTS"
echo "[EDGE-TTS-INSTALL] Memeriksa provider..."
"$PYTHON" -c 'import edge_tts; print("Edge TTS", getattr(edge_tts, "__version__", "ready"))'
echo "[EDGE-TTS-INSTALL] Selesai. Tidak ada model suara lokal atau GPU yang diunduh."
