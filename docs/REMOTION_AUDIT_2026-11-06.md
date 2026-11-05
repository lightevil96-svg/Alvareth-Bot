# Remotion continuation audit — 2026-11-06

## Starting state

Fresh checkout of feat/remotion-whatsapp-linux, clean at 1f18a72. Branch exists and includes the prior WhatsApp menu/session/status/history/resend, disk-streamed MP4 uploader, single-worker persisted render queue, planner/compiler, rich layouts, character/visual bible and optional ComfyUI adapter. No existing local changes were overwritten. No VPS filesystem or production session was accessed. Baseline commit had no workflow runs returned by the connector.

Not complete initially: planner used hosted OpenAI-compatible/API-Faa; narration used ElevenLabs; stock pipeline used Pexels quota; defaults forced generated music; SFX were fixed to speech starts, ignoring transition handles and overlay event timing. Validator discarded audio/caption configuration and truncated voice tracks to 30 despite 60-scene allowance. Owner restriction depended on the outer router. No VoxCPM2 service existed. FreeTheAI plugin was already deleted by prior work.

## Changes

- Local loopback-only Ollama planner, JSON mode, timeouts, explicit failure, no paid/hosted fallback. Default model qwen2.5:7b. Local inference service URLs reject redirects, embedded credentials and remote hosts.
- Plugin-level strict owner gate, sender-bound session cancellation, bounded concurrent planning, live local service health checks. Existing native-flow menu and text fallback retained.
- Python VoxCPM2 wrapper pinned to inspected OpenBMB source; local-only weights, 1 inference at a time, bounded input, API-independent /speech contract, safe peak headroom, optional cached upstream stable-ts aligner. Node verifies WAV and expands scene duration to fit complete speech on integer frames. Required narration fails rather than silently becoming a voiceless result; explicit operator silent mode available.
- Event-driven procedural whoosh/swish/pop/impact/thump/click/chime/sparkle/riser. Transition/title/notification/callout events share actual scene frame coordinates. Sparse cues, speech attenuation, fades and no chopped tails. Music omitted without local track.
- Preserved existing layouts/typography/camera/background modules; coherent palette fallback, fixed audio and caption serialization and voice fade duration. This does not create photorealistic animation or guarantee consistent characters.
- Removed legacy hosted voice code, hosted planner fallbacks, quota-backed stock downloader, obsolete media environment examples and synthetic music fallback. Other bot features' dependencies/API integrations preserved.
- ComfyUI accepts only loopback and exact reviewed workflow hashes; known banned model/provider identifiers rejected. Custom-node/model license and code audit still required; no model is installed by this change.
- Output validation now probes codec, dimensions, frame rate, duration and required audio, and fully decodes output before queue marks completed.
- Added scoped MIT editorial references and an Alvareth integration skill; preserved existing official Remotion skills without blind refresh. See REMOTION_LOCAL_LICENSES.md.

## Verification actually performed

- Baseline npm test initially failed because dependencies were absent (chalk import), not a reproduced application regression.
- Installed Node dependencies with --ignore-scripts in this test environment; no production install/deploy. This does not verify native install scripts on the VPS.
- Full npm test passed after installation, including existing unrelated bot regression suites.
- Added local-provider contract tests with actual FFmpeg-created WAV fixtures, WAV probe/full decode, no-network provider routing, 60 voice tracks, SFX frame origins at 24/25/30 FPS, peak/envelope checks, reviewed graph rejection, and actual H.264 verification gate.
- Plugin tests invoke actual handler with mock transport: all non-owner actions rejected, seven menu rows, configured prefix, prompt sender binding, cancellation isolation, status/history/resend-empty/guide. Shared existing interactive-command and MP4 uploader regression tests also pass. These are NOT live WhatsApp delivery.
- Python syntax and 3 HTTP contract tests pass with mocked inference (not generated human speech).
- Remotion JSX entrypoint bundles successfully with esbuild. Full Remotion bundle was reached, but local MP4 render failed when sandbox denied os.networkInterfaces (uv_interface_addresses). No production code patch bypasses the environment restriction.
- Real local-service smoke attempted: Ollama not running (fetch failed); Python VoxCPM service not installed (ModuleNotFoundError). No GPU executable detected, weights absent. No generated speech or Indonesian pronunciation quality claimed.
- CI now includes actual Remotion fixture MP4 rendering, full decode, probe metadata, representative frames and audio-level artifact. CI result is recorded separately after the run; fixture does not use a real planner or VoxCPM2.

## Still unverified / deployment gates

VoxCPM2 installation/model loading/synthesis performance, Indonesian pronunciation, real forced alignment accuracy, speaker continuity, ComfyUI model and license selection, live WhatsApp callbacks/uploads/reconnect delivery, production VPS render and audio/visual review. Full requested prompt→AI voice→WhatsApp scenario is provided by scripts/remotion-smoke.js but cannot be honestly marked passed here without services/models/session. Runtime queue is single-process, not a distributed job queue. Watcher notifications are not persisted across restarts; owner can inspect/resend through status/history/send.

See REMOTION_WHATSAPP_LINUX.md for exact setup and acceptance commands. No VPS deployment or main merge performed.
