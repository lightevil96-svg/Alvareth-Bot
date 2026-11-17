#!/usr/bin/env python3
"""Local audio transcription and on-screen text extraction for Alvareth Bot."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def run_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=True, capture_output=True, text=True)


def probe_duration(input_path: Path) -> float | None:
    ffprobe = os.environ.get("FFPROBE_BINARY", "ffprobe")
    try:
        result = run_command([
            ffprobe, "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)
        ])
        value = float(result.stdout.strip())
        return value if value >= 0 else None
    except Exception:
        return None


def extract_audio(input_path: Path, output_path: Path) -> None:
    ffmpeg = os.environ.get("FFMPEG_BINARY", "ffmpeg")
    run_command([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(input_path), "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(output_path)
    ])


def transcribe_audio(audio_path: Path, model_name: str, device: str,
                     compute_type: str, language: str | None) -> tuple[list[dict[str, Any]], str]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper belum terpasang. Jalankan: "
            "python3 -m pip install -r requirements-lirik.txt"
        ) from exc

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        task="transcribe",
        beam_size=5,
        temperature=0.0,
        vad_filter=False,
        condition_on_previous_text=False,
        word_timestamps=False,
    )
    output: list[dict[str, Any]] = []
    for segment in segments_iter:
        text = str(segment.text or "").strip()
        start = max(0.0, float(segment.start))
        end = max(start, float(segment.end))
        if text and end > start:
            output.append({
                "start": start,
                "end": end,
                "text": text,
                "source": "AUDIO",
            })
    return output, str(getattr(info, "language", None) or language or "unknown")


def extract_on_screen_text(input_path: Path, sample_fps: float,
                           min_confidence: float) -> tuple[list[dict[str, Any]], str]:
    try:
        import cv2
        from rapidocr import RapidOCR
    except ImportError as exc:
        return [], (
            "RapidOCR/OpenCV belum terpasang. Jalankan: "
            "python3 -m pip install -r requirements-lirik.txt. "
            + str(exc)
        )

    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        return [], "Video tidak dapat dibuka untuk OCR."

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frame_count = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / fps if fps > 0 and frame_count > 0 else 0.0
    if duration <= 0:
        capture.release()
        return [], "Durasi/frame video tidak dapat dibaca untuk OCR."

    interval = 1.0 / max(0.1, min(5.0, sample_fps))
    engine = RapidOCR()
    events: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    timestamp = 0.0

    try:
        while timestamp < duration:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            ok, frame = capture.read()
            if not ok or frame is None:
                timestamp += interval
                continue

            raw = engine(frame)
            rows = raw[0] if isinstance(raw, tuple) else raw
            detected: list[tuple[float, float, str]] = []
            for item in rows or []:
                if not isinstance(item, (list, tuple)) or len(item) < 3:
                    continue
                text = " ".join(str(item[1] or "").split()).strip()
                try:
                    confidence = float(item[2])
                except (TypeError, ValueError):
                    confidence = 0.0
                if not text or confidence < min_confidence:
                    continue
                box = item[0]
                try:
                    center_x = sum(float(point[0]) for point in box) / len(box)
                    center_y = sum(float(point[1]) for point in box) / len(box)
                except Exception:
                    center_x, center_y = 0.0, 0.0
                detected.append((center_y, center_x, text))

            detected.sort(key=lambda row: (row[0], row[1]))
            frame_text = " ".join(row[2] for row in detected).strip()
            if frame_text:
                normalized = " ".join(frame_text.lower().split())
                if current and current["_normalized"] == normalized and timestamp - current["end"] <= max(2.5, interval * 2.5):
                    current["end"] = min(duration, timestamp + interval)
                else:
                    if current:
                        current.pop("_normalized", None)
                        events.append(current)
                    current = {
                        "start": timestamp,
                        "end": min(duration, timestamp + interval),
                        "text": frame_text,
                        "source": "ON_SCREEN",
                        "_normalized": normalized,
                    }
            elif current and timestamp - current["end"] > max(2.5, interval * 2.5):
                current.pop("_normalized", None)
                events.append(current)
                current = None

            timestamp += interval
    finally:
        capture.release()

    if current:
        current.pop("_normalized", None)
        events.append(current)
    return events, ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--kind", choices=("audio", "video"), required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default=None)
    parser.add_argument("--ocr-fps", type=float, default=1.0)
    parser.add_argument("--ocr-min-confidence", type=float, default=0.55)
    parser.add_argument("--max-duration", type=float, default=1800.0)
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    if not input_path.is_file():
        raise RuntimeError("File sumber tidak ditemukan.")
    duration = probe_duration(input_path)
    if duration is not None and args.max_duration > 0 and duration > args.max_duration:
        raise RuntimeError(
            "Durasi media " + str(round(duration)) + " detik melebihi batas "
            + str(round(args.max_duration)) + " detik."
        )

    audio_segments: list[dict[str, Any]] = []
    on_screen_segments: list[dict[str, Any]] = []
    audio_error = ""
    ocr_error = ""
    detected_language = args.language or "unknown"

    with tempfile.TemporaryDirectory(prefix="alvareth-lirik-") as temp_dir:
        audio_path = Path(temp_dir) / "audio.wav"
        try:
            extract_audio(input_path, audio_path)
            audio_segments, detected_language = transcribe_audio(
                audio_path, args.model, args.device, args.compute_type, args.language
            )
        except Exception as exc:
            audio_error = str(exc).replace("\n", " ")[:900]
            if args.kind == "audio":
                raise RuntimeError(audio_error) from exc

    if args.kind == "video":
        try:
            on_screen_segments, ocr_error = extract_on_screen_text(
                input_path, args.ocr_fps, args.ocr_min_confidence
            )
        except Exception as exc:
            ocr_error = str(exc).replace("\n", " ")[:900]

    all_segments = sorted(
        audio_segments + on_screen_segments,
        key=lambda item: (float(item["start"]), 0 if item["source"] == "AUDIO" else 1),
    )
    payload = {
        "language": detected_language,
        "model": args.model,
        "duration": duration,
        "segments": all_segments,
        "audio_segments": len(audio_segments),
        "on_screen_segments": len(on_screen_segments),
        "ocr_enabled": args.kind == "video" and not bool(ocr_error),
        "ocr_error": ocr_error,
        "audio_error": audio_error,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print("[ALVARETH-LIRIK] " + str(error), file=sys.stderr)
        raise SystemExit(1)
