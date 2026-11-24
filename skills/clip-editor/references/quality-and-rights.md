# Quality control, delivery, and rights

## Technical QC

For every final MP4:
- Confirm the file exists, is non-empty, and can be decoded from beginning to end.
- Use `ffprobe` or equivalent to verify MP4 container, video codec, pixel format, dimensions, frame rate, duration, and audio stream.
- Compare actual dimensions to the requested aspect ratio. Check rotation/display matrix and sample aspect ratio; do not rely on filename extensions.
- Scan for black frames and freezes. Investigate expected intentional fades, pauses, still frames, and transitions before marking them as failures.
- Check audio peak/loudness, clipping, unexpected silence, channel layout, and A/V sync.
- Inspect a frame at the beginning, after every major cut, around captions/overlays, and near the end. Watch the whole clip when possible.
- Confirm the last word, reaction, and final frame are not cut abruptly.
- Open the output in a real player if one is available. A successful renderer exit status alone is not sufficient.

## Visual and caption QC

- Captions match the spoken words; speaker labels do not drift between speakers.
- No caption exceeds two lines or crosses safe margins.
- No spelling error in names, numbers, game terminology, or creator handles.
- Text does not cover a face/avatar, mouth, important gameplay HUD, or key action.
- Cropping does not cut off a second speaker or important event.
- Transitions are not jarring and effects do not obscure content.

## Rights and publication gate

Track one of these statuses in the clip plan:
- `original`: user owns or created the source.
- `licensed`: source is covered by a licence that permits the intended edit/use.
- `permission_granted`: relevant rights holder has granted permission.
- `public_domain`: public-domain status has been established for the source.
- `unknown`: rights have not been established.
- `review_required`: human/legal review is needed.

An `unknown` or `review_required` status is a warning for a private editing draft and a **publication blocker**. Attribution is not a substitute for permission. Fair use/fair dealing is context- and jurisdiction-dependent and cannot be guaranteed by an editing agent.

## Deliverables

Keep source and outputs separate. Deliver:
- `clip-plan.json` — selected windows and exact editing decisions.
- `clips/*.mp4` — rendered clips.
- `subtitles/*.srt` — final reviewed caption files.
- `thumbnails/*.jpg` — one frame/thumbnail per clip where requested.
- `publish/captions-and-hashtags.md` — draft metadata, never auto-published without authorization.
- `reports/qc-report.md` and `render-manifest.json` — actual measurements and checks.

Use exact paths. Record failures and skipped checks; never turn "not checked" into "passed".
