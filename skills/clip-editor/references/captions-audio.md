# Captions and audio finishing

## Transcript trust levels

- `ASR_RAW`: machine transcription, not yet listened to or corrected.
- Segment-level transcript: timestamps cover a phrase/sentence, not individual words.
- Word-aligned transcript: word timestamps supplied by a real aligner; still review names, slang, overlap, and code-switching.
- Human-reviewed: a person checked the wording and timing against the source.

Do not convert phrase timestamps into word timestamps by dividing the duration evenly. Keep the draft SRT segment-level or use a real forced aligner and then inspect it.

## Caption design

- Use no more than two lines at a time; break lines at natural phrase boundaries.
- Keep captions inside platform safe margins; default to at least 8–10% horizontal margin and enough bottom clearance for app controls.
- Use high-contrast text with a consistent outline or backing treatment.
- Highlight only one or two important words at a time. Do not animate every syllable unless accurate word timing exists.
- Keep speaker labels separate from dialogue and only show them when needed for comprehension.
- Preserve original language, spelling, names, slang, and code-switching. Do not silently translate.
- Check punctuation and line breaks on a phone-sized preview, not only a desktop monitor.

## Audio mix

- Dialogue is the priority. Use conservative noise reduction and EQ; heavy processing can create metallic or watery speech.
- Keep original ambient sound when it contributes to the scene.
- If adding background music, use a track the user supplied or is authorised to use. Duck it under speech; do not let music mask consonants.
- Avoid clipping and abrupt loudness jumps. Use a limiter only as a safety stage.
- A practical starting export target is around -14 LUFS integrated and no higher than -1 dBTP true peak. This is a starting target, not a universal requirement; follow the user's platform, broadcaster, or client specification when provided.
- Check mono compatibility and listen to the final render on ordinary speakers/headphones.
