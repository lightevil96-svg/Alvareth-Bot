"""Loopback-only Alvareth adapter. Upstream pinned in requirements.txt.
No inference-time downloads, hosted providers or user-controlled filesystem paths.
"""
import base64
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

MODEL = None
ALIGNER = None
LOCK = threading.Lock()

def load_models():
    global MODEL, ALIGNER
    from voxcpm import VoxCPM
    model_path = Path(os.environ["VOXCPM_MODEL_PATH"])
    config = json.loads((model_path / "config.json").read_text())
    if config.get("architecture") != "voxcpm2":
        raise ValueError("VOXCPM_MODEL_PATH must contain VoxCPM2 (architecture=voxcpm2)")
    MODEL = VoxCPM.from_pretrained(str(model_path), local_files_only=True,
        load_denoiser=False, optimize=False, device=os.getenv("VOXCPM_DEVICE", "cpu"))
    alignment_path = os.getenv("VOXCPM_ALIGNMENT_MODEL_PATH")
    if alignment_path:
        if not Path(alignment_path).is_file():
            raise ValueError("Alignment requires a pre-downloaded local Whisper checkpoint")
        from voxcpm.timestamps.stable_ts import StableTSAligner
        ALIGNER = StableTSAligner(model_name=alignment_path,
            device=os.getenv("VOXCPM_ALIGNMENT_DEVICE", "cpu"), language="id")

def synthesize(text, language="id"):
    import numpy as np
    import soundfile as sf
    if language not in ("id", "en"):
        language = "id"  # TTS infers language; this is only an alignment hint.
    style = os.getenv("VOXCPM_VOICE_DESCRIPTION", "A warm clear narrator, natural pace and calm expression")
    wav = np.asarray(MODEL.generate(text=f"({style}){text}", cfg_value=2.0,
        inference_timesteps=10, normalize=False, denoise=False,
        retry_badcase=True, retry_badcase_max_times=1, max_len=1024), dtype=np.float32).reshape(-1)
    rate = MODEL.tts_model.sample_rate
    if not wav.size or not np.isfinite(wav).all() or len(wav) / rate > 19.7:
        raise ValueError("Invalid or overlong speech; shorten scene narration")
    peak = float(np.max(np.abs(wav)))
    if peak < 0.0001:
        raise ValueError("Silent speech output")
    wav = wav * min(1.0, 0.80 / peak)  # headroom for event SFX
    data = io.BytesIO()
    sf.write(data, wav, rate, format="WAV", subtype="PCM_16")
    words = []
    warning = "Word alignment is disabled"
    if ALIGNER is not None:
        try:
            with TemporaryDirectory(prefix="alvareth-align-") as directory:
                audio_path = str(Path(directory) / "speech.wav")
                Path(audio_path).write_bytes(data.getvalue())
                ALIGNER.language = language
                result = ALIGNER.align(audio_path=audio_path, text=text, sample_rate=rate, level="word")
                words = [{"text": item.text, "start": item.start, "end": item.end} for item in result.items]
                warning = ""
        except Exception:
            warning = "Local word alignment failed; speech remains available"
    return {"provider": "VoxCPM2", "audio_base64": base64.b64encode(data.getvalue()).decode(),
            "duration_seconds": len(wav) / rate, "words": words, "warning": warning}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log narration or request bodies.

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, {"error": "Not found"})
        self.reply(200 if MODEL else 503, {"provider": "VoxCPM2", "ready": MODEL is not None,
            "alignment": ALIGNER is not None, "busy": LOCK.locked()})

    def do_POST(self):
        if self.path != "/speech":
            return self.reply(404, {"error": "Not found"})
        self.connection.settimeout(10)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 10000:
                return self.reply(413, {"error": "Invalid request size"})
            body = json.loads(self.rfile.read(length))
            text = body.get("text")
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1200:
                return self.reply(400, {"error": "Text must contain 1-1200 characters"})
        except (ValueError, AttributeError, TimeoutError):
            return self.reply(400, {"error": "Invalid JSON request"})
        if MODEL is None:
            return self.reply(503, {"error": "VoxCPM2 is not ready"})
        if not LOCK.acquire(blocking=False):
            return self.reply(429, {"error": "VoxCPM2 busy; only one inference at a time"})
        try:
            self.reply(200, synthesize(text.strip(), body.get("language", "id")))
        except Exception:
            self.reply(500, {"error": "Local synthesis failed; check model/device and narration length"})
        finally:
            LOCK.release()

if __name__ == "__main__":
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    load_models()
    ThreadingHTTPServer(("127.0.0.1", int(os.getenv("VOXCPM_PORT", "7861"))), Handler).serve_forever()
