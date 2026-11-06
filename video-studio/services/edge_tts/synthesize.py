#!/usr/bin/env python3
"""Thin adapter for Microsoft's online Edge TTS voices via the edge-tts package.

This service is online and free to use, but edge-tts is an unofficial client of
the Edge browser speech endpoint. It does not require a local ML model or API key.
"""
import asyncio
import base64
import json
import sys

import edge_tts

ALLOWED_VOICES = {"id-ID-GadisNeural", "id-ID-ArdiNeural"}


async def synthesize(payload):
    text = str(payload.get("text", "")).strip()
    if not text or len(text) > 1200:
        raise ValueError("Teks voice-over harus berisi 1–1.200 karakter.")

    voice = str(payload.get("voice", "id-ID-GadisNeural"))
    if voice not in ALLOWED_VOICES:
        raise ValueError("Voice Edge TTS tidak diizinkan.")

    rate = str(payload.get("rate", "+0%"))
    pitch = str(payload.get("pitch", "+0Hz"))
    volume = str(payload.get("volume", "+0%"))
    print("[EDGE-TTS] Menghubungkan ke layanan TTS online...", file=sys.stderr, flush=True)

    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
        boundary="WordBoundary",
        connect_timeout=30,
        receive_timeout=86400,
    )

    audio = bytearray()
    words = []
    async for message in communicate.stream():
        if message["type"] == "audio":
            audio.extend(message["data"])
        elif message["type"] == "WordBoundary":
            start = float(message["offset"]) / 10_000_000
            end = float(message["offset"] + message["duration"]) / 10_000_000
            word = str(message.get("text", "")).strip()
            if word and end > start:
                words.append({
                    "text": word,
                    "start": round(start, 4),
                    "end": round(end, 4),
                })

    if not audio:
        raise RuntimeError("Edge TTS tidak mengembalikan audio.")
    print(
        "[EDGE-TTS] Audio diterima: "
        + str(len(audio))
        + " byte; word-boundary: "
        + str(len(words))
        + ".",
        file=sys.stderr,
        flush=True,
    )
    return {
        "provider": "EdgeTTS",
        "voice": voice,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "audio_format": "mp3",
        "words": words,
    }


async def main():
    payload = json.load(sys.stdin)
    result = await synthesize(payload)
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print("[EDGE-TTS] ERROR: " + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
