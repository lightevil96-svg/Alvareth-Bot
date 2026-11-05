#!/usr/bin/env python3
"""Local MOSS-SoundEffect v2 batch worker for Alvareth Remotion."""
import argparse
import json
import os
from pathlib import Path


def load_runtime():
    import torch
    from moss_soundeffect_v2 import MossSoundEffectPipeline
    return torch, MossSoundEffectPipeline


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input", default="")
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--model-id", default="OpenMOSS-Team/MOSS-SoundEffect-v2.0")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--cfg-scale", type=float, default=4.0)
    args = parser.parse_args()

    try:
        torch, Pipeline = load_runtime()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
        raise SystemExit(2)

    if args.check:
        print(json.dumps({
            "ok": True,
            "torch": torch.__version__,
            "cuda": bool(torch.cuda.is_available()),
            "device": "cuda" if torch.cuda.is_available() else "cpu"
        }), flush=True)
        return

    if not args.input or not args.output_dir:
        parser.error("--input and --output-dir are required unless --check is used")

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    events = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(events, list) or not events:
        raise SystemExit("Input must be a non-empty JSON array.")

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("MOSS-SoundEffect was configured for CUDA but torch.cuda.is_available() is false.")

    if device == "cuda":
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    else:
        dtype = torch.float32

    pipe = Pipeline.from_pretrained(
        args.model_id,
        torch_dtype=dtype,
        device=device
    )

    results = []
    for index, event in enumerate(events, 1):
        prompt = str(event.get("prompt", "")).strip()
        seconds = max(0.25, min(4.0, float(event.get("seconds", 0.8))))
        if not prompt:
            results.append({"id": event.get("id"), "ok": False, "error": "empty prompt"})
            continue
        output_path = output_dir / ("sfx_" + str(index).zfill(3) + ".wav")
        try:
            audio = pipe(
                prompt=prompt,
                seconds=seconds,
                num_inference_steps=max(10, min(100, args.steps)),
                cfg_scale=max(1.0, min(8.0, args.cfg_scale))
            )
            pipe.save_audio(audio, str(output_path))
            if not output_path.exists() or output_path.stat().st_size < 1000:
                raise RuntimeError("Generated audio file is empty.")
            results.append({
                "id": event.get("id"),
                "ok": True,
                "file": output_path.name,
                "bytes": output_path.stat().st_size
            })
            print(json.dumps(results[-1]), flush=True)
        except Exception as exc:
            results.append({"id": event.get("id"), "ok": False, "error": str(exc)[:500]})
            print(json.dumps(results[-1]), flush=True)
        if device == "cuda":
            torch.cuda.empty_cache()

    failed = [item for item in results if not item.get("ok")]
    print(json.dumps({"summary": {"generated": len(results) - len(failed), "failed": len(failed)}}), flush=True)
    if failed and len(failed) == len(results):
        raise SystemExit(3)


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
