# Video analysis with .analisis

.analisis is an owner-only, private-chat command. It prepares audiovisual analysis artifacts for the Skills-Clip workflow; it does not render or publish a finished MP4.

## WhatsApp usage

1. Send a video to the bot in a private chat.
2. Reply to that video with .analisis.
3. The bot downloads the video and opens an interactive list.
4. Choose an analysis action. The first action runs the analysis pipeline and caches the result for the current sender/chat.
5. Use the menu again to download the relevant artifact or the complete ZIP.

To configure Gemini, choose API Key Gemini, send the key as the next private text message, and wait for confirmation. The input session expires after five minutes. Delete the message containing the key from the WhatsApp chat after the bot confirms it.

Available actions:

| Button | Output |
|---|---|
| API Key Gemini | Save or replace the Gemini key in private chat |
| Analisis lengkap | Summary plus ZIP handoff |
| Transkrip + subtitle | Draft SRT and transcript JSON |
| Deteksi speaker | Speaker turns, overlap and face-match candidates |
| Identifikasi karakter | Observable visual descriptions and visible labels |
| Ringkasan video | Markdown analysis report |
| Cari highlight | Timestamped hook/setup/payoff candidates |
| Deteksi adegan | Timestamped scene breakdown |
| Export Skills-Clip | Complete artifact ZIP |
| Status analisis | Current job state |

Text commands are also available: .analisis apikey (open input), .analisis apikey status, .analisis apikey clear, .analisis apikey cancel, .analisis full, .analisis transcript, .analisis speakers, .analisis characters, .analisis summary, .analisis highlights, .analisis scenes, .analisis export, .analisis status, .analisis send, and .analisis cancel.

The command requires a quoted/replied video to create a session. The menu can still be opened without a video, but analysis actions will ask for a source video.

## Analysis engines

### Gemini video understanding

Set GEMINI_API_KEY in the server environment, or use the API Key Gemini button in the private .analisis menu. The bot stores a key entered through WhatsApp in ~/.alvareth-bot-data/video-analysis/gemini-api-key.json (or ALVARETH_DATA_DIR/video-analysis/gemini-api-key.json), with directory permissions 700 and file permissions 600. The file is not encrypted at rest, so restrict server and backup access. A locally stored key takes precedence over GEMINI_API_KEY. The bot uploads the video through Gemini Files API and calls generateContent with the video file URI. The default model is gemini-3.8-flash; override it with ALVARETH_VIDEO_ANALYSIS_MODEL if a compatible video model is available to your API key.

Gemini produces a structured analysis with:
- scene ranges and visual focus;
- a short video summary;
- provisional speaker descriptions;
- character appearance descriptions and visible labels;
- transcript segments, when speech is understood;
- highlight candidates with setup and payoff;
- conservative editorial recommendations and uncertainty notes.

The model is instructed not to invent dialogue, identity, or word-level timestamps. Gemini transcript segments are not word-aligned. The bot keeps them as unresolved segment-level ASR and can create only a segment-timed draft SRT.

### Optional Cutroom sidecar

For audio diarization, word timestamps, face tracks and active-speaker candidates, deploy Cutroom separately: https://github.com/jain-eshan/cutroom. Configure ALVARETH_CUTROOM_API_URL, for example http://127.0.0.1:8000.

The adapter uses the upstream /process, /progress/{job_id} and /jobs/{job_id} API. The sidecar must have its own FFmpeg/Python/model dependencies and valid pyannote model access. The bot does not install or download these models automatically.

Security: upstream Cutroom's API is unauthenticated by default. Keep it bound to localhost or a private network. Do not expose it directly to the public internet. ALVARETH_CUTROOM_ALLOW_REMOTE=true is accepted only when ALVARETH_CUTROOM_API_TOKEN is also set, and the remote endpoint must be an authenticated reverse proxy that enforces that bearer token. Setting the variable does not add authentication to upstream Cutroom itself.

Cutroom face detection is designed for real faces. It may not track anime/VTuber avatars reliably. When a match is returned, the bot labels it CANDIDATE only when confidence is at least 0.5 and at least one second was judged. This is not identity verification. Animated avatars remain UNKNOWN unless independently confirmed.

If the optional sidecar fails, the bot falls back to Gemini unless ALVARETH_CUTROOM_REQUIRED=true.

## Configuration

Copy the relevant variables from .env.example:

    GEMINI_API_KEY=
    ALVARETH_VIDEO_ANALYSIS_MODEL=gemini-3.8-flash
    ALVARETH_VIDEO_ANALYSIS_MAX_BYTES=262144000
    ALVARETH_VIDEO_ANALYSIS_MAX_DURATION_SECONDS=1800
    ALVARETH_VIDEO_ANALYSIS_TIMEOUT_MS=1200000
    ALVARETH_VIDEO_ANALYSIS_FILE_TIMEOUT_MS=600000
    ALVARETH_VIDEO_ANALYSIS_MAX_OUTPUT_BYTES=524288000
    ALVARETH_VIDEO_ANALYSIS_RETENTION_HOURS=24
    ALVARETH_VIDEO_ANALYSIS_TMPDIR=
    FFPROBE_BINARY=ffprobe

    ALVARETH_CUTROOM_API_URL=
    ALVARETH_CUTROOM_API_TOKEN=
    ALVARETH_CUTROOM_ALLOW_REMOTE=false
    ALVARETH_CUTROOM_REQUIRED=false
    ALVARETH_CUTROOM_TIMEOUT_MS=2700000

The API key is never shown in bot replies or included in analysis ZIP files. The next plain-text message is treated as the key only for the owner who opened the prompt, in that private chat, for five minutes. Bot logs redact the submitted message. WhatsApp itself retains the sent message until you delete it, so remove the key message from the chat after confirmation. Use .analisis apikey status to check configuration, .analisis apikey clear to remove the locally stored key, or .analisis apikey cancel to cancel an open prompt. Clearing the local key does not remove GEMINI_API_KEY from the server environment.

The defaults cap source videos at 250 MiB and 30 minutes. Output ZIPs are capped at 500 MiB. ffprobe is optional; if unavailable, duration metadata is omitted and duration-based preflight cannot run. The source video is stored under ALVARETH_VIDEO_ANALYSIS_TMPDIR or ~/.alvareth-bot-data/video-analysis. The bot removes stale analysis directories older than the retention window when a new analysis session starts. .analisis cancel removes the current session when no job is running.

Do not commit .env, API keys, video sources, or generated analysis artifacts.

## Artifact contract

The ZIP includes:
- analysis-result.json
- transcript.json
- speaker-map.json
- characters.json
- highlights.json
- scenes.json
- captions-draft.srt
- analysis-report.md
- skills-clip-editorial-brief.md
- manifest.json

The source video is deliberately excluded from the ZIP. It remains in the bot's temporary analysis directory until cleanup.

The transcript uses the Skills-Clip-compatible base fields. Every aligned machine word is ASR_RAW. When only segment-level transcript is available, words remains empty and the raw segments are retained under unresolved_words; the SRT uses segment ranges, not fabricated word timestamps. The default verification policy is human-listen-required.

Speaker diarization labels are not people. Face matches remain CANDIDATE or UNKNOWN; the bot never promotes an AI guess to VERIFIED or USER_CONFIRMED. A human must review source audio/video before final captions or identity claims.

## Operational limits

- The first selected analysis action currently runs the complete analysis and caches it. Later menu actions reuse the cached result.
- Gemini API usage, video upload limits, model availability and processing time depend on the Google AI account.
- Cutroom model download, GPU/CPU capacity, pyannote access, and real-video quality depend on the separately deployed service.
- A successful API response does not prove transcript correctness, speaker identity, highlight quality or editorial suitability.
- The bot prepares a handoff package only. Skills-Clip or a human editor must review artifacts and create the actual edit/render plan.

## Regression tests

Run the focused test suite:

    npm run test:video-analysis

The GitHub Actions JavaScript syntax workflow also runs the focused tests without calling external model APIs. Live Gemini, Cutroom inference, WhatsApp button behavior and media delivery still require testing with the deployment's own credentials and sample footage.
