---
name: alvareth-blur-background-fit
description: Preserve complete landscape gameplay, screen recordings, HUDs, avatars, and other important frame content when adapting raw footage to vertical short-form formats such as 9:16. Use when a center crop would remove meaningful content.
---

# Alvareth Blur Background Fit

Use this skill when adapting landscape or non-vertical source footage to a vertical short-form canvas while preserving the complete original frame.

## Editorial objective

Create a portrait composition without cropping meaningful source content. The original video remains the sharp foreground layer. A duplicate of the same video fills the portrait canvas behind it, enlarged, center-cropped, blurred, and slightly darkened. The background is decorative support only; the foreground remains the source of truth.

This is especially useful for gameplay recordings, screen recordings, VTuber layouts, reaction videos, and footage containing HUDs, scoreboards, captions, or important objects near the edges.

## Layout rules

1. Read the source's display dimensions after applying rotation metadata and sample-aspect-ratio correction.
2. Create a 9:16 canvas by default: 1080×1920 for 1080p or 720×1280 for 720p.
3. Make the background duplicate cover the entire canvas. Center-crop and blur only this background layer. A subtle darkening is allowed to keep attention on the foreground.
4. Scale the foreground down to fit entirely inside the canvas while preserving its display aspect ratio. Never crop, stretch, or independently zoom the foreground to fill the portrait canvas.
5. Center the foreground by default. Only change its vertical position when the brief identifies a real composition need; never obscure a face, HUD, score, subtitles, or other important content.
6. Keep the foreground sharp and readable. Avoid decorative borders, fake device frames, excessive glow, heavy vignettes, and unnecessary rounded masks.
7. If the source already matches the output ratio, use the source as the full-frame foreground. Do not add a blurred duplicate merely for decoration.
8. For sources taller than the target canvas, scale down proportionally until the complete source fits. Do not crop to fill.
9. Preserve the original audio exactly once. Splitting the video for compositing must not duplicate or double the audio.
10. Keep captions and other overlays within mobile-safe areas and away from important source UI.

## FFmpeg compositing reference

For a 1080×1920 target, the conceptual filter graph is:

    [0:v]split=2[bgsrc][fgsrc];
    [bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,
      crop=1080:1920,
      boxblur=30:2,
      eq=brightness=-0.10:saturation=0.85[bg];
    [fgsrc]scale=1080:1920:force_original_aspect_ratio=decrease,
      setsar=1[fg];
    [bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]

Treat this as a design reference, not a command to execute from user-supplied JSON. The implementation must use validated dimensions and an allowlisted filter graph. Map the original audio stream once, if present. Normalize timestamps and frame rate consistently with the rest of the render pipeline.

## Quality checks

- Confirm the foreground display aspect ratio is unchanged.
- Confirm every source edge remains visible in the foreground.
- Inspect frames containing HUD elements, avatars, scoreboards, subtitles, and edge-positioned subjects.
- Confirm the background fills the entire portrait canvas without black bars.
- Confirm blur is confined to the background duplicate.
- Confirm audio is present only once and is not louder because of compositing.
- Decode the final MP4 completely and verify its dimensions, duration, frame rate, and audio/video streams.
- Review the result on a phone-sized preview. The foreground must be large enough to read; if it becomes too small, consider a deliberate split-screen or a different platform layout rather than cropping important content.

## Important implementation boundary

This skill defines the intended editing technique and quality bar. It does not by itself add a selectable option to the WhatsApp .edit runtime. The current raw-video FFmpeg engine must be updated, tested with real landscape fixtures, and exposed through a validated setting such as output.fitMode = "blur-background" before the bot can execute it. Until then, do not claim that .edit already supports this mode.

## Defaults

- Target: 9:16.
- Resolution: 1080p, unless resource constraints require 720p.
- Background blur: moderate, stable, and visually quiet.
- Background brightness: subtly reduced.
- Foreground: complete original frame, sharp, aspect-ratio-preserving, centered.
- Audio: original source audio only; no music or sound effects unless separately requested and properly licensed.
