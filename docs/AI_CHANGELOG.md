## 2026-11-08 — Make `.render` percentage progress terminal-only

- **Root cause:** `createRenderProgressReporter()` called the WhatsApp reply helper for every progress update, and `.render status` also formatted the percentage for chat output.
- **Fix:** moved progress reporting into `lib/render-script.js`; every changed percentage/stage is logged to the server terminal and the latest progress remains available internally for session state. The reporter has no WhatsApp connection or message-sending dependency.
- **WhatsApp behavior:** removed automatic percentage/progress messages. `.render status` now returns a plain message without a percentage; the ZIP acknowledgement explains that live progress is visible only in the server terminal. The final rendered video is still delivered normally.
- **Regression coverage:** added a unit test for terminal logger output and session-state updates; retained the FFmpeg timestamp-to-percentage test.
- **Verification:** pending GitHub Actions and live TokoPanel/WhatsApp validation.

## 2026-11-08 — Remove repository preview, add render progress, and harden updater restart safety

- **WhatsApp replies:** added a central outgoing-message sanitizer that removes the bot repository URL and matching external-ad preview from text, captions, and send options. Removed the unused bot preview-thumbnail helper; unrelated link previews remain available.
- **Render status:** FFmpeg stderr timestamps are parsed against the output duration declared in the render script (including the Claude package's DUR=6.5 and -t $DUR). The bot now reports progress in 10% steps, records the latest stage, and supports .render status.
- **Restart safety:** active render jobs are counted globally within the worker. Manual and automatic updates are deferred while a render is running, preventing an updater restart from killing FFmpeg mid-job.
- **Updater transport:** GitHub codeload archives are read as a guarded stream and the entire download is retried when the response body ends with a socket error such as UND_ERR_SOCKET; oversized update archives remain rejected.
- **Verification:** pending GitHub Actions and live WhatsApp/TokoPanel testing. Progress is based on FFmpeg output timestamps; WhatsApp upload is reported as a separate final stage.

## 2026-11-08 — Remove fixed compressed ZIP size ceiling

- Removed the hard-coded 50 MB limit from .render ZIP metadata checks, WhatsApp media download, and archive validation.
- ZIP packages can now exceed 50 MB; the effective upload ceiling is the WhatsApp transport and available server memory/storage.
- Retained ZIP-bomb protections: maximum 200 entries, 100 MB per extracted file, and 250 MB total extracted content. Existing path traversal and symbolic-link rejection remain enabled.
- Added a regression test proving that an archive slightly larger than 50 MB is accepted by the extraction path.
- Verification: pending GitHub Actions and a live WhatsApp/TokoPanel test.
## 2026-11-08 — Fix ZIP document event detection and session matching

- **Observed issue:** WhatsApp accepted pack.zip as a document, but the bot gave no reply after the upload. The earlier handler returned silently when the serialized message type or session key did not match its narrow assumptions.
- **Fix:** added lib/render-message.js to read document payloads from both the serialized message and the original raw Baileys payload, including ephemeral/view-once/document-caption wrappers. Session keys now normalize phone-number aliases and device suffixes before lookup.
- **Diagnostics and user feedback:** ZIP uploads with no active matching session now receive a clear reply instead of being silently ignored. Added safe server logs for ZIP event type, filename, MIME type, and whether a session was found; no full phone/JID is logged.
- **Regression coverage:** tests cover wrapped document messages, direct serializer fallback, and stable session keys across device suffix/phone-number formats.
- **Verification:** pending GitHub Actions after this commit. Live WhatsApp/TokoPanel upload test still required.

## 2026-11-07 — Owner-only WhatsApp .render ZIP package workflow

- **Request:** replace the one-file .sh upload step with the ZIP package supplied by Claude, while keeping the existing video → .render interaction.
- **Package inspection:** the supplied pack.zip contains one pack/render.sh, the required pack/assets/ PNG overlays/mask/border, Poppins-Bold.ttf, optional gen_assets.py, a Windows-only render.bat, and usage notes. The shell script uses relative assets/ paths and defaults to the input filename 378541.mp4; extracting only the shell script would break the render.
- **Implementation:** .render now accepts a .zip document in the same sender/chat session, extracts the full directory structure with the existing JSZip dependency, locates exactly one render.sh, places the replied video beside it as 378541.mp4, passes that path as $1, executes Bash from the script's own directory, discovers jumpscare_short.mp4, and sends the result. render.bat and gen_assets.py are not executed; the included PNG assets are already generated.
- **Archive safeguards:** ZIP download 50 MB; at most 200 entries; 100 MB per extracted file; 250 MB total extracted content. Rejects absolute/traversal paths, backslash paths, duplicate names, symlinks, special file types, and ambiguous/missing render.sh. Existing 300 MB input, 500 MB output, 30-minute process timeout, and 15-minute pending session remain.
- **Security:** the archive and script still come from the super-owner session, but Bash executes render.sh under the bot's OS account. Private per-job directories, minimal child environment, path validation and resource limits are not an OS sandbox; only trusted ZIP packages may be run.
- **Files:** plugins/owner/render.js, lib/render-script.js, tests/render-script.test.js, README.md, AI_CONTEXT.md, docs/AI_CHANGELOG.md. No new dependency is required; JSZip was already declared in package.json.
- **Verification:** Render script regression passed 12/12 on commit `85202dac460e16ad04201d9fea21928fb20a6d75` (run `42393587378`); JavaScript syntax checks passed on the same commit (run `42393587374`). The first regression run exposed a missing byte formatter in the total-extraction-limit error path; the formatter was added and all 12 tests passed on rerun. The supplied ZIP was extracted locally and its exact `render.sh` was smoke-tested with a synthetic 1280×720 H.264/AAC video, producing a 1080×1920 H.264/AAC MP4 of approximately 6.5 seconds. Automated extraction tests inject a ZIP-reader fixture; real JSZip parsing of the uploaded archive, the user's original video, live WhatsApp upload/download, and rendering on the target TokoPanel server remain unverified.
- **Regression lesson:** render packages may contain relative assets and a wrapper directory. Preserve the archive tree, execute only the single intended render.sh from its parent directory, and do not execute Windows or optional asset-generation scripts automatically.

## 2026-11-07 — Owner-only WhatsApp .render script workflow

- **Request:** simplify video rendering to the exact two-step interaction: reply to a sent video with `.render`, then upload the `.sh` script when prompted.
- **Implementation:** added `plugins/owner/render.js` with a sender/chat-bound 15-minute pending session. It downloads the replied video using the shared quoted-media helpers, accepts a shell-script document from the same owner session, creates a private job directory, supplies the legacy `378541.mp4` filename plus `input.mp4`/`video.mp4` aliases and the input path as `$1`, runs Bash, discovers the generated video, and sends it with the shared WhatsApp file sender. `.render cancel` removes a waiting session.
- **Safety limits:** super-owner command gate; script upload must match the same chat and sender; video 300 MB, script 256 KB, output 500 MB, 30-minute process timeout; bounded stdout/stderr; child process receives only PATH/HOME/TMP/LANG variables. The process still runs under the bot's OS account and is not an OS sandbox, so only trusted owner-provided scripts may be used.
- **Files:** `plugins/owner/render.js`, `lib/render-script.js`, `tests/render-script.test.js`, `package.json`, `.github/workflows/render-script-regression.yml`, `README.md`, `AI_CONTEXT.md`.
- **Verification:** `Render script regression` passed on final commit `72b603436ace2d60688c7cb572e94976dd700bd1` (run `42388545232`); repository-wide JavaScript syntax also passed on that commit (run `42388545241`). Existing media delivery, downloads, clip, updater, social downloader, sticker, and TikTok regression workflows passed on the immediately preceding feature commit `3229a93d3f7f9f0a7981f2b4dc82df34b82f5473`; the follow-up changed only the two WhatsApp prompt line breaks and verification notes. Full `npm test`, live WhatsApp media download/delivery, FFmpeg availability on the target server, and the exact Claude-generated script are not verified in this environment.
- **Regression lesson:** never execute an uploaded script from arbitrary users. Keep the session bound to the initiating owner and chat, use an isolated working directory with a minimal child environment, impose a hard timeout, and do not describe this as an OS-level sandbox.

## 2026-11-07 — Instagram and X downloader media-type fixes

- **Request:** repair Instagram downloads that failed across GraphQL/package/third-party providers, and fix X posts containing photos that were incorrectly reported as missing videos.
- **Root cause:** Instagram's current GraphQL operation and external providers were returning empty responses, HTTP 401/403, or HTTP 500; the existing X plugin was explicitly video-only and parsed only SaveTwitter MP4 links.
- **Changes:** Instagram now tries the maintained local yt-dlp extractor first for public Reels, photo/video posts, and carousel entries, validates actual image/video file signatures, and keeps the existing GraphQL/API/embed routes as bounded fallbacks. X now uses FxTwitter v2, FxTwitter legacy, and VXTwitter metadata sources; normalizes photo/video/GIF media, restricts fetched media URLs to X's own CDN, validates downloaded bytes, and sends each item using its actual image/video type. The previous SaveTwitter MP4 route remains as a last-resort video fallback. Added regression coverage for photo-only, video, mixed media, tracking parameters, and external-URL rejection.
- **Files:** plugins/downloader/ig.js, plugins/downloader/twitter.js, lib/scrape/youtube.js, lib/scrape/twitter.js, tests/social-downloaders.test.js, package.json, .github/workflows/social-downloader-regression.yml, AI_CONTEXT.md.
- **Verification:** Social downloader regression passed on final source commit `5bf43babbadb8ec2b7ff6cb48c18791854474b2e` (8/8 tests covering URL parsing, FxTwitter v2/v1 photo/video parsing, VXTwitter photo-only and media URL fallback, CDN host rejection, plugin send branches, and the retained SaveTwitter fallback). The full JavaScript syntax workflow also passed on that commit. The existing YouTube Clip progress regression passed on `415321d63dc535a19ce3d6ee77ec9ce5aa59e05b` after the shared yt-dlp helper changed; subsequent commits only adjusted X downloader code and documentation. The first workflow attempt caught an escaped-regex syntax error, which was corrected before the successful runs. Live Instagram/X provider access, the user's TokoPanel environment, and WhatsApp media delivery are not verified here.
- **Regression lesson:** do not assume every X status is a video. Preserve provider media types and verify the downloaded file signature before choosing the WhatsApp payload. For Instagram, keep a maintained local extractor ahead of brittle GraphQL document IDs and third-party API fallbacks; never treat a successful HTTP status as proof that a media file was returned.

## 2026-11-07 — TikTok downloader: photo actions, slideshow, and selectable video quality

- **Request:** automatically process TikTok links and provide clear actions for photo posts, one-video slideshow rendering with the original post audio, and selectable output resolutions for video posts.
- **Root cause:** the existing AutoDL router already recognized TikTok links, but multi-photo posts were sent as an album immediately and only exposed per-photo conversion. There was no one-video slideshow workflow or post-download quality menu. Video normalization could use stream-copy remuxing, so the output resolution could not be selected consistently.
- **Changes:** photo posts now send a preview followed by a three-option menu: send all original photos, open a per-photo video picker, or create one slideshow MP4. Slideshow supports 1/2/3/5/10-second presets and custom per-photo durations (1–60 seconds each; 300-second total cap), with the TikTok post's audio looped to cover the slideshow when available. Video posts are FFmpeg re-encoded at the highest source resolution by default; the follow-up quality menu offers the source resolution and lower standard tiers only, and selected resolutions are rendered without upscaling. Added bounded photo count/size checks and unit tests for resolution tiers, scaling, and slide-duration validation.
- **Files:** plugins/downloader/tiktok.js, lib/tiktok-workflow.js, tests/tiktok-workflow.test.js, package.json, .github/workflows/tiktok-regression.yml, AI_CONTEXT.md.
- **AutoDL behavior:** private chats continue to auto-download TikTok links by default. Group chats retain the existing opt-in requirement (.enable autodl); the central router and other platform downloaders were not changed.
- **Verification:** TikTok regression workflow passed (run 42339797738); repository-wide JavaScript syntax, updater, downloads, media delivery, YouTube Clip progress, and sticker regression workflows also passed on commit b65399117249d14a6a3191f577ef237299f109cd. A local FFmpeg smoke test rendered two sample images into one 720x1280 H.264/AAC MP4 with 1-second and 2-second slide durations plus looped audio. Full npm test, live TikTok provider responses, FFmpeg rendering on the user's host, and WhatsApp interactive-menu delivery remain unverified.
- **Regression lesson:** never upscale a lower-quality TikTok source to advertise a higher resolution; derive the menu from the verified source dimensions, and re-render each selected quality through FFmpeg. Keep all slideshow images and the optional original audio in the same managed ALVARETH_TIKTOK_TMPDIR job directory so cleanup remains bounded.

## 2026-11-07 — Remove heavy video and Hermes features

- **Request:** remove the owner-only `.remotion`, `.hermes`, and `.edit` features to reduce the bot's runtime and dependency footprint while preserving unrelated commands.
- **Root cause:** the video studio initialized a render queue and local model/service integration; video editing maintained a separate processing queue; Hermes added a child-process maintenance bridge. The WhatsApp handler also intercepted messages for active Remotion and edit prompt sessions.
- **Changes:** removed the three command plugins, session-routing hooks, video-studio/video-edit runtimes, Hermes bridge, dedicated npm dependencies/scripts, related tests/workflows/bootstrap scripts/docs, feature-specific environment variables, and video-production agent skills. Updated README/AI guidance and narrowed Disk Manager cleanup to WhatsApp temporary media only.
- **Follow-up cleanup:** removed the remaining broken `.claude/skills/remotion-*` symlinks, the `.edit`-specific blur-background skill, and the obsolete VoxCPM2 test fixture that referenced the deleted video runtime.
- **Verification:** seven GitHub Actions workflows on the removal commit passed: JavaScript syntax, media delivery, downloads, Disk Manager, updater, YouTube clip progress, and sticker regression. No live WhatsApp/TokoPanel test is claimed.
- **Not verified / outside repository:** this change does not uninstall separately provisioned Hermes CLI files, VoxCPM2 model weights, Python virtual environments, Ollama binaries, or other files already stored on the VPS. Those require separate cleanup on the server after confirming their paths.
- **Regression lesson:** removing a plugin alone is insufficient when `handler.js` has a pre-plugin prompt-session hook; remove the hook and its tests/configuration together. Keep FFmpeg because other retained commands still use media processing.

## 2026-11-07 — Add owner-only Hermes Agent maintenance bridge

- **Request:** let the Alvareth owner audit, troubleshoot, and prepare safe code-maintenance changes from WhatsApp.
- **Architecture:** added `plugins/owner/hermes.js` and `lib/hermes-agent.js`. The bridge invokes the locally installed Nous Research Hermes CLI through the existing Baileys connection; it does not start another WhatsApp gateway and adds no npm dependency.
- **Commands:** `.hermes`, `status`, `setup`, `help`, `audit`, `ask`, `patch`, `pending`, `apply`, `undo`, `discard`, `verify`, and `reset`.
- **Safety:** super-owner-only checks, one concurrent Hermes task, no shell spawn, allowlisted child environment, no inherited Alvareth credentials, file/clarify tools by default (web/search are opt-in), and a temporary `HERMES_WRITE_SAFE_ROOT`. Hermes receives prompts through a private query file and returns structured stream-json events. The bridge is not an OS-level read sandbox; a dedicated OS account/container is required for hard isolation.
- **Patch workflow:** proposals are path-validated and stored pending owner approval. Applying is a separate explicit command that rejects unsafe paths, symlinks, binary/mode/rename/delete changes, package manifests, and dirty target files; it creates backups, checks `git apply --check`, and syntax-checks JavaScript. Failed syntax checks are rolled back. Undo refuses when patch context no longer matches. No automatic commit, push, or deploy.
- **Regression coverage:** added `tests/hermes-agent.test.js`, `npm run test:hermes`, and a dedicated GitHub Actions workflow; `npm test` includes the Hermes suite, and the full repository test workflow now triggers on Hermes source/test changes.
- **CI correction:** the first targeted run exposed an escaped-newline error in the fake Hermes CLI fixture; changed it to emit line breaks with `String.fromCharCode(10)`. This was a test-harness issue, not a production bridge defect.
- **Not verified:** Hermes CLI installation/configuration on the production VPS, model/provider credentials or inference, live WhatsApp command delivery, and production patch application. These require the owner's server environment.

## 2026-11-06 — Owner-only WhatsApp Disk Manager

- **Request:** provide a way to inspect and safely reclaim storage when the bot consumes substantial disk space.
- **Implementation:** added `.disk` / `.disk scan` for filesystem and top-level directory usage; `.disk clean` creates a five-minute preview; `.disk confirm` deletes only ordinary files older than 24 hours from the dedicated WhatsApp temporary-media directory and Remotion generated-assets directory; `.disk cancel` discards the preview.
- **Safety:** owner-only at both plugin metadata and handler level. The cleaner rejects filesystem roots and paths containing the project/data root, skips symlinks and recent files, revalidates candidate paths at deletion time, and never traverses arbitrary directories. WhatsApp sessions, databases, configuration, model weights, node_modules, logs, backups, and MP4 renders are not cleanup targets.
- **Files:** `plugins/owner/disk.js`, `lib/disk-cleaner.js`, `tests/disk-cleaner.test.js`, and `package.json`.
- **Tests:** `Disk Manager regression` passed on commit `24e22b4` (syntax checks plus safe cleanup boundary tests); repository-wide JavaScript syntax workflow is still running. The new test is also included in `npm test`.
- **Not verified:** actual 15 GB disk composition, VPS disk quota, live WhatsApp command delivery, and production cleanup behavior. The report only scans the bot working directory; filesystem totals include other data on the same mount.
- **Operational note:** disk scans use asynchronous `df`/`du` subprocesses so they do not block the WhatsApp event loop. After deployment/restart, run `.disk scan`, then `.disk clean` and review the preview before sending `.disk confirm`. This feature deliberately will not promise to reclaim the full 15 GB because only known disposable temporary files are eligible.

## 2026-11-06 — Remove Ollama and move storyboard authoring to ChatGPT

- **Request:** remove the local Ollama planner; the owner will ask ChatGPT to author a production-ready storyboard and paste it into .remotion.
- **Architecture:** planVideoPrompt() no longer makes HTTP requests. It accepts only a JSON object with schemaVersion: 1, sourcePrompt, and scenes; plain-language input is rejected with a link to prompt-remotion.md.
- **WhatsApp:** menu, input session, guide, and services text now describe ChatGPT JSON intake. Ollama health checks and readiness rows are removed. Input allowance is 24,000 characters.
- **Provisioning:** Ollama/Qwen install, service manager, environment settings, archive extractor, and model download were removed from the Linux bootstrap and WhatsApp installer. VoxCPM2, ComfyUI optional workflow checks, and server hardware diagnostics are preserved.
- **Stability:** scene duration fitting no longer compresses narration/reading below its estimated minimum; too-short target durations and narration longer than 20 seconds per scene fail clearly.
- **Documentation:** added repository-root prompt-remotion.md and updated README, AI_CONTEXT, environment example, Linux setup, skill policy, license audit, and prompt-engineering contract.
- **Verification status:** source changes and regression tests are committed to main. GitHub Actions is the source for test/render status; no successful production VPS deployment, live VoxCPM2 synthesis, ComfyUI generation, or live WhatsApp delivery is claimed.

## 2026-11-06 — ComfyUI readiness requires reviewed workflow bytes

- **Symptom:** a ComfyUI workflow path could appear configured merely because a file existed, even though its SHA-256 had not been approved; a reference-image workflow could also appear ready without a compatible video graph.
- **Root cause:** provider readiness checked file existence but did not reuse the runtime's exact-byte SHA-256/model-policy validator or verify the reference placeholder.
- **Fix:** readiness now validates each configured API workflow with `validateReviewedWorkflow`; video/image/music workflows stay unavailable until their exact bytes are approved. Character reference additionally requires both reviewed image and video workflows and the `{{REFERENCE_IMAGE}}` placeholder in the video graph. The ComfyUI live health check remains separate.
- **Files:** `video-studio/whatsapp.js`, `plugins/owner/remotion.js`, `tests/remotion-whatsapp.test.js`, `README.md`, `docs/REMOTION_WHATSAPP_LINUX.md`, `AI_CONTEXT.md`.
- **Tests:** readiness regressions for unapproved hashes, missing video workflow, and missing reference placeholder passed in GitHub Actions on commit `8f54ee1`: JavaScript syntax checks, Video Studio regression suite, mock Python voice-service contract, JSX compilation, and real fixture MP4 render/decode. Real ComfyUI inference, model compatibility, live VoxCPM2 inference, VPS render, and WhatsApp delivery remain unverified.

## 2026-11-06 — Explicit local service start and VoxCPM2 loading diagnostics

- **Symptom:** `.remotion services` correctly stayed status-only, so an installed VoxCPM2 adapter remained stopped until narration was requested. A VoxCPM2 process that had already bound its HTTP port but was still loading returned HTTP 503; the readiness path could report it as not ready immediately instead of waiting. A failed detached process could also leave an unhelpful generic status without its exit code/log path.
- **Root cause:** there was no explicit owner command to warm up one local service; `inspectVoxCPM` waited only when the port was unreachable, not when the service was reachable-but-loading; status-only diagnostics did not include a previous managed-process failure.
- **Fix:** added `.remotion services start voice` and `.remotion services start planner` as opt-in single-service startup commands; kept bare `.remotion services` observational. VoxCPM2 readiness now waits through its loading response, detached process failures stop polling early, and status output includes the private service log path/exit code when available. Added a direct loopback ComfyUI `/system_stats` check and clarified that the core installer does not install ComfyUI/workflows.
- **Files:** `video-studio/local-services.js`, `plugins/owner/remotion.js`, `tests/video-studio-local.test.js`, `tests/remotion-whatsapp.test.js`, `README.md`, `docs/REMOTION_WHATSAPP_LINUX.md`, `AI_CONTEXT.md`.
- **Tests:** regressions for VoxCPM2 already-listening/loading readiness, managed-process failure diagnostics, and explicit service command parsing passed in GitHub Actions on commit `88019e1`: JavaScript syntax checks, Video Studio regression suite, mock Python voice-service contract, JSX compilation, and real fixture MP4 render/decode. Live VoxCPM2 inference, ComfyUI model/workflow execution, VPS render, and WhatsApp delivery remain unverified.
- **Operational boundary:** no hosted AI, WAN, ElevenLabs, stock provider, or forced music was introduced. ComfyUI footage/image/music remain inactive until a local reviewed workflow and compatible model are installed and configured.

## 2026-11-06 — Owner-only forced update with local conflict backups

- Added `.update force` for explicit synchronization when an upstream-changed file conflicts with local edits.
- Before overwriting or deleting conflicting files, the updater copies each original file into a timestamped backup directory under `ALVARETH_DATA_DIR/update-backups/` and writes a manifest with original path, mode, reason, and SHA-256.
- Forced updates still process only paths present in the GitHub commit comparison. `.env`, WhatsApp sessions, databases, `node_modules`, unsafe symlinks, and unrelated local files remain protected.
- Backup creation is mandatory and must complete before any project file is changed. If backup storage is inside the project, it must be under an updater-protected data path; otherwise the force operation aborts.
- Normal `.update` behavior remains conservative and unchanged: conflicting local files are preserved.
## 2026-11-06 — Owner WhatsApp installer for local Ollama/Qwen and VoxCPM2

- **Gap found:** a rootless Linux bootstrap script already existed, but it was only documented as a shell command. No WhatsApp action invoked it. `.remotion services` was intentionally status-only; it did not provision binaries, Python packages, or model weights.
- **WhatsApp controls:** added owner-only `.remotion install`, `.remotion install cpu`, and `.remotion install status`; added an installer row to the menu. GPU mode checks visible NVIDIA hardware; CPU mode requires an explicit command. Installation runs detached in the background and reports completion/failure back to the originating chat.
- **Provisioning:** the command invokes the existing rootless script with `--with-models`, which installs uv/Python 3.11, the official Ollama Linux binary, PyTorch and the pinned OpenBMB VoxCPM2 adapter, then downloads the configured Ollama planner model and VoxCPM2 weights. FFmpeg/FFprobe, Chromium OS libraries, npm dependencies, ComfyUI and optional media workflows are not installed by this script.
- **Safety:** installer subprocess receives only an allowlisted runtime/download environment, not WhatsApp owner numbers, bot tokens, or API keys. Added a persistent lock, PID, exit-code state, private log, and stale-lock handling. GPU absence now fails before package installation unless CPU mode is explicitly requested.
- **Diagnostics:** `.remotion services` now distinguishes missing Ollama binary, missing VoxCPM Python virtualenv, missing model weights, and a merely stopped local adapter. Added parser, installer-state, allowlist and owner-gate regression tests.
- **Hardware boundary:** VoxCPM2 2B requires substantial RAM/VRAM and disk. CPU is supported but may be very slow. Actual target-server RAM/VRAM, disk capacity, download network, real synthesis and WhatsApp MP4 delivery still require VPS verification.
## 2026-11-06 — Video Studio dibuat WhatsApp-only; remote API dan Cloudflare Tunnel dihapus

- **Keputusan produk:** Video Studio hanya digunakan dari WhatsApp oleh owner. Alur yang dipertahankan adalah prompt WhatsApp → Ollama/Qwen lokal → storyboard/compiler → queue → VoxCPM2 lokal → opsional ComfyUI lokal → Remotion/FFmpeg → MP4 dikirim ke chat asal.
- **Penghapusan:** melepas video-studio/api.js, video-studio/tunnel.js, video-studio/CLOUDFLARE-TUNNEL.md, dan tes khusus cloudflared. server.js tidak lagi memasang route /api/video-studio atau menjalankan connector tunnel; health-check hosting /, /health, /ping tetap tersedia jika PORT digunakan.
- **Konfigurasi:** menghapus VIDEO_STUDIO_API_KEY, VIDEO_STUDIO_ALLOWED_ORIGINS, VIDEO_STUDIO_TUNNEL_TOKEN, VIDEO_STUDIO_TUNNEL_TOKEN_FILE, CLOUDFLARED_BIN, dan VIDEO_STUDIO_TUNNEL dari .env.example. PORT sekarang didokumentasikan hanya untuk health-check hosting.
- **Keamanan dan operasi:** tidak perlu Cloudflare Zero Trust, public hostname, reverse proxy, browser API key, tunnel token, atau proses cloudflared. Plugin owner-only .remotion tetap menjadi satu-satunya antarmuka produksi.
- **Catatan migrasi:** variabel lama di .env server tidak lagi dibaca oleh kode dan boleh dihapus; token file lama ~/.alvareth-bot-data/video-studio/tunnel-token, API key lama ~/.alvareth-bot-data/video-studio/api-key, dan binary ~/.alvareth-bot-data/bin/cloudflared dapat dihapus manual. DNS/tunnel resource pada akun Cloudflare tidak dapat dihapus dari commit GitHub dan harus dihapus terpisah bila memang ingin dibersihkan.
- **CI correction:** workflow awal masih memanggil syntax-check untuk api.js/tunnel.js yang sudah dihapus; workflow diperbarui agar hanya memeriksa modul WhatsApp/local-service yang aktif dan tidak menjalankan tes cloudflared. Menambahkan syntax-check server.js.
- **Verifikasi:** tes render/WhatsApp live tetap hanya dapat dibuktikan di server pengguna.

## 2026-11-06 — Local Remotion pipeline and verified integration contracts

- Request: continue feat/remotion-whatsapp-linux without hosted AI, implement VoxCPM2 and synchronized SFX.
- Root causes: hosted planner/TTS fallbacks remained; SFX used speech time instead of actual scene start; validator dropped media configuration and capped voice tracks at 30; plugin relied only on outer permission gate.
- Fix: loopback Ollama, pinned local Python VoxCPM2 wrapper with optional local alignment, fail-clear narration policy, event SFX, audio metadata preservation, explicit owner check/session isolation, output probe/full-decode gate, local workflow review hashes. Removed quota-based stock module and obsolete media configuration; preserved unrelated bot features.
- Files: video-studio/{prompt,media,engine,services,remotion}, plugins/owner/remotion.js, tests, scripts/remotion-smoke.js, CI, .env.example, project skills and Linux/license/audit docs.
- Tests: full npm test passed after dependency installation, JSX bundle passed, Python syntax and three mock HTTP tests passed. Actual WAV/FFmpeg contract and output-gate tests run; no simulated inference is described as real VoxCPM2 speech.
- Limits: local render blocked by environment os.networkInterfaces error; real Ollama/VoxCPM2/WhatsApp services absent. CI fixture render added; see REMOTION_AUDIT_2026-11-06.md for updated evidence. No VPS deployed.
- Regression lessons: never infer runtime features from skill presence; retain all media metadata through validation; never replace missing narration provider silently; separate model inference, transport mocks, renderer fixture and production acceptance.

## 2026-11-05 — Remotion WhatsApp owner-only prompt-to-video

- **Permintaan:** mengganti generator video lama dengan workflow Remotion native Linux yang dapat dijalankan dari WhatsApp melalui `.remotion`, dilengkapi menu interaktif dan pembatasan owner.
- **Perubahan:** membuat plugin `plugins/owner/remotion.js` dengan menu native-flow dan fallback teks, prompt session, storyboard planner, antrean render, notifikasi tahap/progres, riwayat, status, pemeriksaan provider, pengiriman ulang, dan pengiriman MP4 memakai uploader disk-streaming yang sudah ada. Prompt session dihubungkan sebelum loop plugin normal dan hanya menerima pesan teks dari owner yang memulai sesi.
- **Penghapusan sistem lama:** `plugins/ai/aivideo.js` (FreeTheAI) dihapus; variabel FREETHEAI di `.env.example` dan pemeriksaan sintaks lama di `package.json` dibuang.
- **Kualitas kreatif:** planner sekarang menyusun visual bible dan character bible; validator/compiler mempertahankan data tersebut. Jika image workflow ComfyUI dikonfigurasi, adapter membuat satu character reference image per job, mengunggahnya ke ComfyUI, lalu meneruskannya ke image-to-video workflow melalui placeholder {{REFERENCE_IMAGE}}. Identitas lintas klip tetap perlu diverifikasi dan tidak dijamin identik.
- **Skills dan dokumentasi:** menambahkan `alvareth-ai-video-production`, panduan deployment Linux, dan dokumentasi perintah WhatsApp; mempertahankan LightJurnal Video Studio API.
- **Tes:** ditambahkan `tests/remotion-whatsapp.test.js` dan regresi character/visual bible di `tests/video-studio.test.js`. Tes pada branch ini belum dijalankan di Linux/VPS; status CI, dependency install, tombol WhatsApp live, provider API, dan render MP4 produksi masih harus diverifikasi.
- **Pelajaran regresi:** jangan mengklaim karakter konsisten, voice-over AI, footage AI, atau musik AI aktif hanya karena ada skill atau workflow file. Periksa konfigurasi provider dan hasil render nyata; ComfyUI, ElevenLabs, dan Pexels bersifat opsional.
- **Referensi:** branch `feat/remotion-whatsapp-linux`.

## 2026-11-04 — Updater mendukung lebih dari 300 file berubah

- **Permintaan/gejala:** perintah `.update` membatalkan sinkronisasi dengan pesan “Ada 300 atau lebih file berubah sejak baseline”, meskipun daftar perubahan lebih besar dari batas tersebut.
- **Akar penyebab:** GitHub REST Compare API membatasi daftar file yang dikembalikan hingga 300. Updater juga menerapkan batas 300 yang sama pada parser `git diff` cadangan, sehingga jalur cadangan tidak dapat menyelesaikan kasus tersebut.
- **Perubahan:** `plugins/owner/update.js` kini beralih otomatis ke `git diff --name-status -z` pada repository bare sementara ketika respons REST mencapai 300 file, sehingga daftar lengkap dapat diperoleh tanpa mengubah checkout bot. Parser Git mendukung hingga 20.000 entri; di atas batas pengaman itu proses tetap dibatalkan. Batas output Git dinaikkan menjadi 20 MiB dengan penghentian aman jika terlampaui. Pemeriksaan ancestor, validasi path, perlindungan file lokal/runtime, baseline hash, dan daftar perubahan tetap dipertahankan.
- **Tes:** ditambahkan regresi untuk 301 file, batas 20.001 file, serta fallback dari respons REST 300 file ke diff lengkap 347 file. Hasil workflow dan `npm test` menunggu verifikasi setelah commit.
- **Belum diverifikasi:** pembaruan live pada instalasi TokoPanel belum dijalankan; tes harus lulus dan owner perlu menjalankan `.update` ulang dari bot aktif.
- **Referensi:** commit kode `40bdd4dfb9e45a5b8130cc7f400a916743f36536`; commit tes `28893b101bc718f11c1a911bddfb7a035813c083`.
- **Pelajaran regresi:** batas 300 milik GitHub REST bukan batas jumlah file proyek. Jangan menerima daftar REST yang mencapai batas itu sebagai lengkap; ambil diff penuh dari Git read-only sebelum menulis file apa pun.

## 2026-11-04 — Dedicated Cloudflare Tunnel for LightJurnal Video Studio

- **Permintaan/gejala:** LightJurnal Video Studio tidak dapat terhubung langsung ke Alvareth; server log menunjukkan `cloudflared` binary tidak ditemukan. Quick Tunnel lama menghasilkan URL sementara, sedangkan hostname produksi belum memiliki route yang stabil.
- **Akar masalah:** `video-studio/tunnel.js` hanya mencari `./bin/cloudflared`, tidak mendeteksi binary dari PATH atau memasang binary otomatis, dan hanya menjalankan Quick Tunnel. Tidak ada named tunnel token flow yang persisten untuk hostname produksi.
- **Cloudflare:** membuat remotely-managed tunnel `lightjurnal-video-studio`, mengatur ingress `video.lightjurnal.my.id` → `http://127.0.0.1:2132` dengan fallback 404, dan membuat DNS CNAME proxied `video.lightjurnal.my.id` → tunnel UUID. Tunnel SSH lama `chromebook-lightjurnal`, domain utama, dan DNS record yang sudah ada tidak diubah.
- **Perubahan kode:** `video-studio/tunnel.js` sekarang membaca token dari `VIDEO_STUDIO_TUNNEL_TOKEN` atau file privat di data directory, mendeteksi binary dari konfigurasi/lokasi lokal/PATH, serta mengunduh rilis resmi cloudflared untuk Linux x64/ARM64 dengan verifikasi SHA-256 dari GitHub Releases. Named tunnel dijalankan memakai `--token-file` agar token tidak muncul pada argumen proses, dan reconnect memakai exponential backoff terbatas. Menambahkan regression test untuk pemetaan platform dan dokumentasi setup.
- **Frontend:** LightJurnal memakai default API URL `https://video.lightjurnal.my.id`, otomatis mengganti URL Quick Tunnel lama yang tersimpan, dan tetap meminta API key hanya satu kali pada sesi browser.
- **Belum diverifikasi:** konektor Cloudflare belum bisa menjadi Healthy sampai pemilik menambahkan token tunnel ke environment Pterodactyl (atau mengunggah token file privat) dan me-restart bot. Akses shell/Pterodactyl tidak tersedia dari koneksi ini; tidak mengklaim binary telah terpasang di host atau render MP4 live telah diuji. GitHub Actions JavaScript syntax checks dan Video Studio regression workflow selesai dengan status `success`; Video Studio workflow juga berhasil mengompilasi entrypoint JSX Remotion dan menjalankan regression tests. LightJurnal quality checks dan GitHub Pages deployment selesai dengan status `success`. Hasil CI ini memvalidasi kode/build, bukan konektor tunnel live.

## 2026-11-04 — Automatic self-update tanpa perintah .update

- **Permintaan:** Alvareth harus memeriksa dan menerapkan pembaruan GitHub sendiri tanpa owner mengetik `.update`.
- **Akar masalah:** updater aman sudah tersedia di `plugins/owner/update.js`, tetapi hanya dipanggil oleh command owner. `lib/auto-update.js` yang lama memakai jalur PM2 terpisah dan tidak dihubungkan ke lifecycle worker; konfigurasi PM2 juga tidak sesuai dengan supervisor cluster internal `index.js`.
- **Perubahan:** `lib/auto-update.js` kini menjadi scheduler yang memanggil handler updater yang sama dengan pesan log sintetis. `main.js` memulai scheduler setelah plugin dimuat. Pemeriksaan pertama berjalan 90 detik setelah startup, lalu setiap `AUTO_UPDATE_INTERVAL_MINUTES` (default 10). Jalur otomatis menghormati `AUTO_UPDATE_ENABLED=false`, mencegah overlap dengan command manual, dan memakai worker supervisor untuk restart setelah file/dependency berubah.
- **Keamanan:** tidak membuat updater kedua; kebijakan baseline/hash/conflict, perlindungan .env, sesi, database, data runtime, dan file lokal tetap berasal dari updater owner yang sudah ada. Tidak memerlukan PM2. `.update` tetap tersedia sebagai fallback manual.
- **Tes:** menambahkan tes untuk pemanggilan updater yang sama, log-only reply, lock command manual, pencegahan overlap, flag disable, dan updater plugin yang belum tersedia. GitHub Actions updater regression menjalankan tes transport + scheduler.
- **Belum diverifikasi:** bot live di Pterodactyl/WhatsApp, akses GitHub dari jaringan hosting, instalasi dependency nyata, dan restart worker setelah update pada server pengguna. CI bukan bukti deployment VPS.
- **Pelajaran regresi:** jangan membuat auto-updater kedua yang menulis file atau mengasumsikan PM2. Panggil mesin update yang sama dari worker setelah plugin dimuat; biarkan supervisor yang sudah ada mengelola restart.

## 2026-11-04 — Optional AI voice-over, word-timed captions, and Pexels footage

- Added an optional ElevenLabs TTS pipeline using the `/with-timestamps` endpoint. Character alignment is converted to timed word groups; scene durations are aligned to speech when the alignment fits the renderer's limits.
- Added a Pexels video search/download pipeline. The planner now emits concise English `stockSearchQuery` values for scenes where real-world footage improves the story. Downloaded assets are stored under the Remotion public directory, selected for the target aspect ratio, and credited on-screen and in job metadata.
- Remotion now layers stock footage under designed typography, plays voice-over tracks, displays word-highlighted captions, and ducks background music when narration exists.
- Added optional server environment variables for ElevenLabs and Pexels. Missing keys produce explicit job warnings and the renderer falls back to motion graphics without blocking the video.
- Added stage indicators for media preparation, voice generation, footage search, and rendering; added focused unit tests for alignment grouping, scene-aligned chunking, footage selection, asset-path validation, and media metadata.
- **Verification boundary:** CI can verify syntax, JSX compilation, and deterministic unit tests. It cannot prove that the user's provider keys are valid, that the Pexels catalogue returns suitable footage for every topic, or that the final MP4 renders correctly on the Pterodactyl VPS. A live provider/render test remains required.

## 2026-11-04 — Remotion JSX compile and focused regression checks passed

- **CI result:** Video Studio regression workflow passed JavaScript module syntax checks, compiled video-studio/remotion/index.jsx with esbuild (including Composition.jsx), and passed every test in tests/video-studio.test.js.
- **Coverage:** validated prompt normalization, variable scene duration, explicit requested duration, safe compilation, unsupported enum/color rejection, legacy project compatibility, and renderer limits.
- **Remaining verification:** esbuild proves JSX syntax and module graph compilation with Remotion/React treated as external packages. It is not a full Remotion webpack bundle or MP4 render. A real render still needs to run on the configured Pterodactyl/Chromium/FFmpeg environment.
- **Skills:** all 13 official Remotion Agent Skills and the project-specific remotion-professional-editor skill are present under .agents/skills.

## 2026-11-04 — Remotion skills installed and regression checks green

- **Skills installed:** the official remotion-dev/skills collection was installed by the GitHub Actions installer into .agents/skills. The repository contains 13 official skills plus the project-specific remotion-professional-editor skill (14 skill directories total).
- **Regression tests:** the focused Video Studio workflow passed its JavaScript module checks and all tests in tests/video-studio.test.js after the JSON parser export fix. The same workflow passed again after the Remotion composition polish. The latest workflow also compiles the Remotion JSX entrypoint with esbuild.
- **Frontend checks:** LightJurnal quality checks and the Pages build/deployment completed successfully for the prompt-only Video Studio revision.
- **Important verification boundary:** these checks do not prove that the live Pterodactyl instance has installed the latest dependencies, configured a working AI text-model credential, or successfully rendered a real MP4. The Remotion JSX bundle and an end-to-end render still need to be verified on the deployment runtime.

## 2026-11-04 — Remotion composition polish

- **Temuan review:** the new AI plan could choose fade, wipe, slide, zoom, or cut, but the renderer only implemented wipe; light-background detection also recognized only a few exact hex values, which could cause low-contrast text on other pale colors.
- **Perbaikan:** Composition.jsx now implements slide and zoom entrances, respects cut/fade/wipe behavior, calculates light/dark text contrast from relative luminance, and uses more suitable type scaling for landscape/square output. The outro no longer forces a generic “SELESAI” label when no CTA was supplied.
- **Tes:** targeted Node regression tests and JavaScript syntax checks passed on the prior code commit. This JSX composition change still requires a Remotion bundle/MP4 render check on the project runtime.
- **Batasan:** no new footage or spoken TTS was added; current output remains motion graphics with procedural music and selected SFX.

## 2026-11-04 — Video Studio test fix: export JSON parser

- **Temuan CI:** focused Video Studio regression workflow passed all JavaScript syntax checks but failed before test execution because tests imported parseJsonResponse while planner.js kept it private.
- **Akar masalah:** the parser was intentionally used internally but was also directly covered by a unit test; its function declaration was not exported.
- **Perbaikan:** exported parseJsonResponse from video-studio/prompt/planner.js so the parser can be tested without calling an external AI provider.
- **Tes:** rerun Video Studio regression workflow after this commit. The first run failed at module instantiation; do not treat it as a passing test. Full test result remains pending.
- **Pelajaran:** test helper visibility must match test imports; verify focused workflow logs rather than relying only on repository-wide syntax checks.

## 2026-11-04 — Video Studio prompt-only AI Creative Director

- Permintaan: membuat hasil Remotion lebih natural dan profesional, menghapus pengaturan kreatif manual, serta menjadikan prompt sebagai satu-satunya input untuk menentukan pacing, warna, scene, motion, transisi, rasio, FPS, dan audio.
- Akar masalah: LightJurnal sebelumnya membagi teks per baris menjadi scene dengan durasi seragam, warna latar seragam, dan beberapa pengaturan kreatif manual. Backend hanya memvalidasi payload teks sederhana; AI prompt interpreter dan storyboard compiler belum ada. Komposisi Remotion masih berupa typography dengan gerakan yang terbatas.
- Perubahan backend: menambahkan video-studio/prompt/planner.js untuk prompt-to-storyboard JSON, provider OpenAI-compatible yang dikonfigurasi di server, dan fallback best-effort ke API-Faa GPT-prompt. Menambahkan video-studio/prompt/compile.js sebagai adapter aman dari storyboard ke schema Remotion. POST /api/video-studio/plan menghasilkan storyboard; POST /jobs menerima plan yang sudah dikompilasi. Validasi mendukung durasi dinamis, maksimal 60 scene, 20 detik per scene, dan 300 detik total.
- Perubahan visual: Composition.jsx sekarang memiliki layout hero/editorial/split/stat/quote/steps/outro, motif geometris bergerak, beberapa preset motion, progress scene, musik fade-in/fade-out, dan sound cue yang dipilih per scene alih-alih SFX acak pada setiap scene.
- Skills: menambahkan npm run skills:remotion untuk memasang 13 official Remotion Agent Skills dari remotion-dev/skills, beserta panduan pemilihan skill di video-studio/SKILLS.md.
- Kompatibilitas: payload manual lama tetap didukung oleh endpoint jobs; API key LightJurnal tetap terpisah dari kredensial model AI. Prompt, plan, dan metadata pekerjaan tidak menyimpan API key.
- Batasan jujur: narration baru disimpan sebagai naskah dan belum disintesis menjadi suara. Pencarian stock footage, AI-generated video per scene, upload media, 3D/photorealistic footage, dan timeline drag-and-drop belum tersedia. Hasil renderer saat ini berupa motion graphics dengan musik prosedural dan SFX terpilih.
- Tes: menambahkan unit tests untuk normalisasi storyboard, variasi durasi berdasarkan panjang narasi, parsing JSON, durasi eksplisit, validasi compiler, enum allowlist, dan kompatibilitas payload lama. Hasil runtime test/CI belum dijalankan pada saat commit ini; render MP4 live, API AI provider, Chromium/Pterodactyl, dan koneksi browser tetap perlu diverifikasi.
- Skills: versi official Remotion skills yang dituju 4.0.540, sesuai versi Remotion pada package.json. Instalasi aktual perlu dijalankan pada checkout lokal dengan npm run skills:remotion.

## 2026-11-04 — Spesifikasi AI Prompt Understanding untuk Video Studio

- **Permintaan:** dokumentasikan di repository bagaimana AI berikutnya harus memahami prompt pengguna dan menerjemahkannya menjadi storyboard serta proyek Remotion, agar AI coding agent lain dapat membaca GitHub dan melanjutkan implementasi.
- **Perubahan:** menambahkan `video-studio/PROMPT_ENGINEERING.md` sebagai kontrak implementasi. Isinya mencakup pipeline prompt intake → intent extraction → creative brief → storyboard → audio direction → JSON planning envelope → safe Remotion compiler → validation → render; contoh JSON; aturan prompt; batas kompatibilitas renderer sekarang; struktur modul yang disarankan; acceptance criteria; dan instruksi untuk AI agent berikutnya. Memperbarui `AI_CONTEXT.md` agar panduan ini wajib dibaca.
- **Status:** dokumentasi/specification only. Tidak menambahkan AI provider, prompt interpreter, storyboard generator, TTS, atau klaim fitur tersebut sudah berjalan.
- **Tes:** memeriksa isi file terkait dan memastikan tautan dokumentasi masuk ke AI_CONTEXT. Belum ada runtime/test AI karena implementasi AI belum dibuat.
- **Belum diverifikasi:** implementasi prompt engine end-to-end, integrasi provider AI, preview storyboard, dan render hasil prompt AI.

## 2026-11-04 — Penyempurnaan kontrol scene dan antrean Video Studio

- **Permintaan/gejala:** tahap pertama perlu membedakan mode Simple dan Professional, menjaga polling antrean saat halaman dibuka ulang, serta membatasi riwayat dan file render parsial.
- **Akar penyebab:** UI awal hanya mengirim durasi default yang sama dan polling belum dimulai ulang untuk pekerjaan aktif yang sudah ada; antrean belum memangkas riwayat terminal.
- **Perubahan:** mode Professional kini menyediakan pengaturan durasi dan warna latar scene; UI mempertahankan token sesi saat koneksi ulang dan melanjutkan polling antrean aktif. Worker membatasi riwayat ke 100 pekerjaan dan menghapus output parsial saat render gagal. Environment example juga mendokumentasikan PORT untuk alokasi Pterodactyl.
- **Tes:** GitHub Actions JavaScript syntax checks lulus pada commit `d558398`; tes validasi proyek lokal lulus 4/4. LightJurnal quality checks dan GitHub Pages deployment lulus pada commit `39ff451`. Perbaikan UI/queue belum diuji terhadap API VPS. Render Remotion sebenarnya tetap menunggu instalasi dependency dan runtime server.
- **Belum diverifikasi:** koneksi HTTPS publik, browser Chromium pada container Pterodactyl, dan render MP4 live.
- **Pelajaran regresi:** UI mode Professional harus menampilkan kontrol yang benar-benar memengaruhi payload, bukan hanya label mode; polling harus pulih setelah reload.

## 2026-11-04 — Fondasi remote Remotion Video Studio untuk LightJurnal

- **Permintaan/gejala:** pengguna ingin LightJurnal menjadi panel kendali, sementara Alvareth-Bot yang sudah berjalan di Pterodactyl menerima perintah dan mengerjakan rendering video.
- **Akar penyebab:** belum ada API render pada server HTTP opsional Alvareth-Bot dan belum ada halaman Video Studio pada LightJurnal.
- **Perubahan:** menambahkan API Bearer-token dengan allowlist CORS, validasi payload proyek, antrean render persisten satu worker, komposisi Remotion motion-typography, endpoint status/unduh, dan dokumentasi konfigurasi. LightJurnal mendapat navigasi dan UI Simple/Professional untuk membuat proyek teks, memantau antrean, preview, dan unduh.
- **Tes:** pemeriksaan sintaks Node.js untuk modul backend/UI dan `node --test tests/video-studio.test.js` lulus 4/4 di lingkungan kerja. Belum menjalankan `npm install`, render MP4 sesungguhnya, workflow GitHub Actions, atau pengujian Pterodactyl/HTTPS.
- **Belum diverifikasi:** dependency Remotion harus dipasang pada server; server HTTP harus berjalan dengan `PORT`; reverse proxy HTTPS, API key, CORS dari domain, browser Chromium, dan ruang disk VPS perlu dikonfigurasi. Upload gambar/video/audio, timeline drag-and-drop, serta kirim hasil melalui WhatsApp belum termasuk tahap pertama.
- **Pelajaran regresi:** jangan memindahkan atau mengubah sesi/database bot. Data render harus tetap di direktori runtime di luar checkout; jangan pernah menaruh API key di frontend atau repository.

## 2026-11-03 — Fix candidate undefined pada finalisasi kualitas tertinggi

- **Gejala:** uji .clip nyata menemukan format 720p melalui metadata, tetapi kedua kandidat (136+251 HTTPS dan 232+251 HLS) gagal pada tahap FFmpeg dengan candidate is not defined. Fallback Qbyte hanya menyediakan 360p dan benar dibatalkan karena lebih rendah dari 720p.
- **Akar masalah:** helper downloadValidatedClipFormat memanggil finalize(inputPath, candidate), tetapi callback finalisasi strategi utama hanya mendeklarasikan parameter inputPath. Callback lalu membaca candidate.video untuk menentukan codec, dimensi, dan opsi stream-copy/encode sehingga terjadi ReferenceError.
- **Perbaikan:** callback kini menerima kedua argumen: async (inputPath, candidate) => { ... }. Format tertinggi tetap satu-satunya yang diunduh; maksimal satu alternatif pada resolusi yang sama tetap menjadi batas retry. Tidak mengaktifkan kembali lima metode download berurutan dan tidak mengizinkan fallback ke resolusi lebih rendah.
- **Regresi:** tambah tes yang memastikan callback finalisasi menerima kandidat terpilih dan menggunakan metadata video kandidat tersebut.
- **Validasi:** GitHub Actions npm run test:clip lulus 32/32, termasuk tes regresi callback finalizer (run 41636334551); pemeriksaan sintaks JavaScript seluruh repo juga lulus (run 41636334438). Live download YouTube dan upload WhatsApp pada TokoPanel tetap perlu diuji.

## 2026-11-03 — .clip memindai metadata dahulu dan hanya mengunduh kualitas tertinggi

- **Gejala/permintaan:** log menunjukkan lima metode downloader dijalankan berurutan meskipun metode pertama sudah menghasilkan 720p. Setiap metode mengulang download/crop/FFmpeg; API Qbyte bahkan mengunduh video 497,7 MB dan audio 258,5 MB untuk hasil 360p. Pengguna meminta sistem melihat semua kualitas lebih dahulu dan hanya mengambil kualitas tertinggi tanpa mengunduh semua kandidat.
- **Akar masalah:** pipeline lama membandingkan kualitas setelah setiap metode menghasilkan file. Inventaris metadata yt-dlp sudah tersedia, tetapi empat strategi yt-dlp dan satu fallback Qbyte tetap dijalankan untuk membandingkan output yang sudah diunduh.
- **Perubahan:** .clip kini memindai seluruh format dari profil YouTube yang tersedia menggunakan --dump-single-json --skip-download, mencatat semua resolusi unik, lalu memilih stream dengan resolusi/piksel tertinggi, FPS, protokol, dan bitrate. Hanya satu metode yt-dlp yang mengunduh dan memotong segmen terpilih. Jika stream tertinggi tidak valid, maksimal satu alternatif pada dimensi/resolusi yang sama boleh dicoba; sistem tidak turun berurutan ke 720p/480p/360p untuk membandingkan hasil.
- **Fallback:** Qbyte hanya dipanggil satu kali jika yt-dlp gagal. Qbyte memeriksa metadata dahulu dan hanya mengunduh satu pasangan video/audio terbaik; fallback di bawah resolusi yang sebelumnya ditemukan yt-dlp dibatalkan. Ukuran sumber dibatasi default 256 MiB per stream, dapat diubah melalui ALVARETH_CLIP_QBYTE_MAX_SOURCE_BYTES.
- **Optimasi FFmpeg:** jika video sumber sudah H.264 dan dimensi kompatibel, video di-stream-copy alih-alih di-encode ulang. Audio hanya di-encode ke AAC bila codec sumber tidak kompatibel dengan MP4.
- **Tes:** GitHub Actions npm run test:clip lulus 31/31 (run 41634506716); pemeriksaan sintaks JavaScript seluruh repo lulus (run 41634506676). Tes mencakup inventaris metadata-only, pemilihan satu resolusi tertinggi, satu alternatif pada resolusi sama, fallback Qbyte satu pasangan, validasi stream video, dan fixture FFprobe nyata.
- **Belum diverifikasi:** uji live download YouTube dan pengiriman video ke WhatsApp melalui TokoPanel harus dilakukan setelah bot direstart. Metadata tidak menjamin stream dapat diunduh; bila format tertinggi ditolak YouTube, sistem akan mencoba satu alternatif pada resolusi sama lalu melaporkan kegagalan, bukan mengunduh semua resolusi.

## 2026-11-03 — Semua ukuran video `.clip` dan `.download` dikirim sebagai video

- **Permintaan:** jangan mengubah video berukuran besar menjadi dokumen. Aturan harus sama pada `.clip` dan `.download`.
- **Perubahan:** helper bersama mengklasifikasikan semua MIME `video/*` dan ekstensi video umum (MP4, M4V, MOV, MKV, WebM, AVI, MPEG/MPG, 3GP, FLV, WMV, TS/M2TS, OGV, dan lainnya) sebagai payload `video`, tanpa ambang 64 MiB. `.clip` tidak lagi menambahkan caption dokumen atau menampilkan status sukses dokumen. `.download` tidak lagi memerlukan `forceVideo` khusus MP4. File nonvideo tetap memakai payload dokumen. Variabel `ALVARETH_WA_INLINE_VIDEO_MAX_BYTES` dihapus dari contoh konfigurasi/dokumentasi.
- **Perilaku gagal:** jika WhatsApp/provider menolak payload video karena ukuran atau container, bot melaporkan kegagalan dan mempertahankan file sumber. Tidak ada fallback otomatis ke dokumen.
- **Tes:** GitHub Actions `npm run test:media` 18/18 lulus (run 41627217911), termasuk MP4 besar, WebM besar, MKV, PDF, dan temporary storage; `npm run test:clip` 30/30 lulus (run 41627217972); download-browser regression lulus (run 41627217800); repository-wide JavaScript syntax checks lulus (run 41627217816). Pengiriman live video besar ke WhatsApp masih perlu diverifikasi.

## 2026-11-03 — Paksa MP4 pada `.download` dikirim sebagai video

- **Gejala:** file MP4 181,6 MB yang dipilih dari `.download` dikirim sebagai dokumen karena helper bersama memakai ambang video inline default 64 MiB.
- **Perubahan:** `.download` kini mengirim opsi `forceVideo` khusus untuk file berekstensi `.mp4`; helper `lib/whatsapp-file-sender.js` mengabaikan ambang 64 MiB hanya ketika opsi tersebut aktif dan ekstensi file `.mp4`. File MP4 dari `.download` menggunakan payload `video`, sedangkan file lain tetap dokumen. `.clip` tidak mengaktifkan override ini sehingga kebijakan sebelumnya (MP4 besar sebagai dokumen) tetap sama. Perbaikan temporary storage global tetap berlaku untuk keduanya.
- **Tes:** GitHub Actions `npm run test:media` 17/17 lulus (run 41626225894), termasuk tes MP4 70 MiB dengan `forceVideo: true`; JavaScript syntax checks lulus (run 41626225846) dan download-browser regression lulus (run 41626225965). Tes mock memverifikasi payload video, bukan pengiriman live WhatsApp.
- **Batasan:** video MP4 berukuran sangat besar tetap tunduk pada batas endpoint video WhatsApp/provider. Jika ditolak, bot tidak mengubahnya otomatis menjadi dokumen; file sumber tetap tersimpan untuk dicoba ulang atau diproses dengan kebijakan lain.

## 2026-11-03 — Alihkan temporary storage Baileys dari tmpfs Pterodactyl

- **Gejala:** upload dokumen MP4 181,6 MB ditolak oleh preflight karena os.tmpdir() hanya menyediakan 100,0 MB, sementara estimasi kebutuhan Baileys 233,9 MB. File sumber tetap tersimpan.
- **Akar penyebab:** Baileys menulis file sementara saat menyiapkan/enkripsi media keluar. Pada Pterodactyl Wings, /tmp container secara default adalah tmpfs 100 MiB yang memakai memori host dan terpisah dari disk server. Node.js memakai /tmp jika TMPDIR tidak diatur.
- **Perubahan:** lib/whatsapp-temp-dir.js menyiapkan dan menguji direktori writable di storage server; default <ALVARETH_DATA_DIR atau ~/.alvareth-bot-data>/tmp, dapat dioverride dengan ALVARETH_WA_TMPDIR. lib/whatsapp-temp-bootstrap.js dijalankan setelah dotenv/config tetapi sebelum import Baileys di main.js, lalu mengatur TMPDIR. Jika override tidak valid, bot mencoba direktori data default. lib/whatsapp-file-sender.js mencatat lokasi temp aktual. Tes regresi mencakup default, override, dan fallback; README, .env.example, serta workflow diperbarui.
- **Tes:** GitHub Actions `npm run test:media` 16/16 lulus (run 41624768802), termasuk uji default, override, fallback, dan urutan import bootstrap sebelum Baileys. JavaScript syntax checks lulus (run 41624768781); download-browser regression (run 41624533274) dan YouTube Clip progress regression (run 41624533073) juga lulus. Workflow sticker terpisah gagal saat instalasi dependency native `canvas` karena `pixman-1` tidak tersedia; tes sticker tidak sempat dijalankan dan kegagalan itu tidak terkait patch ini. Tidak ada pengiriman WhatsApp live.
- **Batasan:** perubahan ini memindahkan file sementara dari tmpfs /tmp ke storage server Pterodactyl; tidak menambah kuota disk server dan tidak mengubah batas file WhatsApp. Disk server tetap harus memiliki ruang kosong sesuai kebutuhan file dan proses enkripsi. Pengiriman live di TokoPanel/WhatsApp masih perlu diverifikasi.
- **Pelajaran regresi:** jangan hanya menaikkan batas ukuran file atau menonaktifkan preflight saat os.tmpdir() adalah tmpfs 100 MiB. Periksa TMPDIR, filesystem aktual, serta kuota disk container sebelum mengubah batas upload.

## 2026-11-03 — Audit dan perbaikan pengiriman `.clip` / `.download` ke WhatsApp

- **Gejala screenshot:** terminal menemukan sumber sekitar 417,6 MB dan format 1920×1080 60 FPS; bot kemudian menyatakan `.clip` gagal, sementara file tetap tersedia di server dan bisa diambil melalui panel. `.download` menampilkan browser folder, tetapi jalur pemilihan/pengiriman belum memberikan hasil yang konsisten.
- **Akar masalah yang dapat dibuktikan dari source:** `downloadYoutubeClip()` menerima `maxOutputBytes` default 0; `fitClipForWhatsApp()` hanya mengompres jika nilai itu >0, sedangkan plugin `.clip` tidak memberikan batas tersebut. Maka file besar dipertahankan pada kualitas asli. Plugin sebelumnya selalu mencoba media `video` dahulu, baru fallback ke `document` untuk semua error; untuk file besar ini salah memilih endpoint di awal dan fallback dapat membuat duplikasi bila status percobaan pertama ambigu. `.download` mengirim dokumen melalui jalur terpisah tanpa konfigurasi `mediaUploadTimeoutMs`, tanpa preflight kapasitas temp, dan tanpa antrean upload bersama. Baileys `@itsliaaa/baileys@0.3.18-final` memang menerima `{ url: localPath }` sebagai media disk-streaming dan opsi `mediaUploadTimeoutMs`; proses enkripsi Baileys menulis file sementara di `os.tmpdir()` sebelum upload. Helper lama `conn.sendFile()` di `lib/simple.js` membaca file penuh ke RAM, sehingga tidak digunakan untuk video besar.
- **Perbaikan:** tambah `lib/whatsapp-file-sender.js`, dipakai oleh `.clip` dan `.download`. Helper memeriksa file/path/symlink/izin baca/MIME/ukuran, memeriksa ruang `os.tmpdir()` (perkiraan 1,2× untuk dokumen, 2,2× untuk video inline), menggunakan `{ url: absolutePath }`, menetapkan `mediaUploadTimeoutMs` default 30 menit, dan menyerialisasi upload per socket (satu aktif; maksimal 3 antrean). MP4/M4V sampai 64 MiB default dikirim sebagai video inline; MP4 yang lebih besar dan container lain (MOV/MKV/WebM/AVI) dikirim sebagai dokumen sejak awal untuk mempertahankan kualitas asli dan menghindari percobaan ganda. Batas bot default 2 GiB−10 MiB, dapat dikonfigurasi. Tidak ada retry otomatis setelah error upload ambigu; file sumber tidak dihapus.
- **Error & retention:** error ENOSPC/ENOENT/EACCES/HTTP 413/HTTP 428/timeout/ECONNRESET mendapat diagnosis yang lebih jelas. `.clip` membedakan kegagalan download/crop/validasi/upload; jika upload gagal setelah file final disimpan, file tetap ada di `downloads/clip` dan pengguna dapat mencoba `.download`. Folder kerja sementara tetap dibersihkan. Keberhasilan hanya dicatat setelah `conn.sendMessage` selesai dan mengembalikan ID pesan; ini bukan bukti read receipt/delivered receipt.
- **Router `.download`:** tambah `lib/interactive-command.js`; `handler.js` meng-unwarp ephemeral/view-once/document-caption/device-sent wrappers sebelum mengambil list/button/native-flow ID. Ini memastikan pilihan daftar tetap menjadi command `.download` saat dibungkus WhatsApp.
- **File diubah:** `plugins/downloader/clip.js`, `plugins/downloader/download.js`, `handler.js`, `lib/whatsapp-file-sender.js`, `lib/interactive-command.js`, `tests/whatsapp-file-sender.test.js`, `tests/interactive-command.test.js`, `tests/clip-policy.test.js`, `package.json`, `.env.example`, `.github/workflows/media-delivery-regression.yml`, `README.md`, `AI_CONTEXT.md`.
- **Tes yang benar-benar dijalankan di GitHub Actions:** media-delivery regression 9/9 sebelum penambahan tes klasifikasi; setelah itu `npm run test:media` 12/12 lulus (workflow 41620068450); `npm run test:download` 4/4 lulus (workflow 41620068403). `npm run test:clip` 30/30 lulus (workflow 41620068611); repository-wide Node syntax checks lulus; download-browser regression lulus. Tidak ada tes yang mengirim file ke akun WhatsApp live.
- **Deployment:** setelah commit main tersedia, TokoPanel harus menarik perubahan sesuai metode deployment proyek, lalu restart bot. Uji `.clip` dengan klip kecil terlebih dahulu, lalu MP4 >64 MiB; periksa log `[CLIP]`, `[WA-FILE]`, dan `[DOWNLOAD]`. Bila upload gagal, file tetap tersedia dan detail error menunjukkan apakah penyebabnya ruang temp, koneksi, timeout, atau batas ukuran.
- **Batasan:** WhatsApp/hosting dapat menerapkan batas lebih rendah dari batas internal 2 GiB−10 MiB; upload file ratusan MB tetap membutuhkan bandwidth dan ruang temp yang cukup. Resolusi `sendMessage` + ID pesan menandakan pipeline Baileys selesai/relay, bukan konfirmasi penerima membaca. Uji live TokoPanel dan pengiriman aktual masih belum dilakukan.

## 2026-11-03 — .clip: hentikan retry upload saat storage ENOSPC

- **Gejala:** klip 181,6 MB selesai dibuat dan tersimpan di `downloads/clip`, tetapi upload WhatsApp gagal dengan `ENOSPC: no space left on device, write`.
- **Akar masalah yang terlihat:** kegagalan terjadi pada tahap upload media, bukan download YouTube. Jalur lama mencoba upload ulang file yang sama sebagai dokumen setelah upload video gagal; ketika penyebabnya ruang disk habis, percobaan kedua dapat mengulang kegagalan dan memperburuk tekanan storage.
- **Perbaikan:** `plugins/downloader/clip.js` mengenali ENOSPC termasuk error bersarang, membaca kapasitas tersedia pada direktori temp Node (`TMPDIR` atau `os.tmpdir()`) untuk diagnostik terminal, dan tidak mengulang upload sebagai dokumen untuk error ini. File hasil final tetap dipertahankan di `downloads/clip`; bot memberi instruksi mengosongkan ruang temporary/server lalu mengambil ulang melalui `.download`. Fallback dokumen tetap aktif untuk kegagalan video non-ENOSPC.
- **Tes regresi:** ditambahkan klasifikasi ENOSPC bersarang, pembeda error lain, dan pemeriksaan bahwa jalur ENOSPC tidak menjalankan fallback dokumen serta file hasil tidak dihapus. Tes lokal/CI dan pengiriman live WhatsApp belum dijalankan pada server pengguna.
- **Batasan:** perubahan ini mencegah retry sia-sia dan kehilangan hasil download, tetapi tidak menambah kapasitas disk server. Untuk mengirim file 181,6 MB, ruang temporary pada container/host tetap harus tersedia; setelah ruang dibebaskan, gunakan `.download` dan pilih file di `downloads/clip`.

## 2026-11-03 — File manager WhatsApp `.download` dan penyimpanan hasil clip

- **Permintaan:** sediakan browser folder di chat dengan daftar interaktif, navigasi masuk/naik halaman, dan kirim file ketika dipilih.
- **Desain/implementasi:** `plugins/downloader/download.js` memakai list message WhatsApp (sesuai dokumentasi fork Baileys, list message hanya didukung di chat pribadi); pemanggilan dari grup ditolak dengan arahan ke chat pribadi. Row ID berisi command `.download` yang dikenali oleh normalisasi `listResponseMessage.singleSelectReply.selectedRowId` di `handler.js`; folder membuka subfolder, tombol kembali naik satu tingkat, dan pilihan file mengirim dokumen ke chat asal. Fitur owner-only.
- **Batas keamanan:** root dibatasi ke `ALVARETH_DOWNLOAD_DIR` (default `./downloads`); path traversal dan symlink ditolak, dotfiles disembunyikan, hanya file/folder biasa ditampilkan, daftar dipaginasi, dan ukuran file divalidasi sebelum upload. Tidak ada endpoint web atau akses ke root filesystem.
- **Integrasi `.clip`:** hasil final dipindahkan ke `downloads/clip` (atau subfolder `clip` di `ALVARETH_DOWNLOAD_DIR`) dan file kerja kandidat tetap dibersihkan. File clip yang sudah terkirim kini bisa dikirim ulang dengan `.download`.
- **Tes:** `tests/download-browser.test.js` mencakup encoding path Unicode, urutan folder/file, dotfile/symlink, traversal, dan ukuran; `npm test` menjalankan tes ini melalui `npm run test:download`. GitHub Actions syntax check tetap menjadi pemeriksaan terpisah; tes Node dan interaksi live WhatsApp belum dijalankan di server pengguna.
- **Koreksi analisis screenshot `.clip`:** screenshot susulan memperlihatkan command `2:03:15 2:09:54`, yang merupakan rentang valid (2 jam 3 menit 15 detik sampai 2 jam 9 menit 54 detik). Interpretasi sebelumnya atas screenshot terpotong sebagai `2:09.34` keliru; jangan menganggap command pengguna salah atau memakai diagnosis timestamp itu untuk menjelaskan kegagalan run tersebut. Perbaikan validasi dan pengamanan socket tetap berguna, tetapi penyebab kegagalan run sebelumnya harus ditentukan dari log proses lengkap.
- **Belum diverifikasi:** payload list interaktif pada fork Baileys yang terpasang, pengiriman file besar, serta perilaku file manager setelah restart TokoPanel.
## 2026-11-03 — Perbaikan validasi timestamp .clip dan pelaporan saat socket WhatsApp tertutup

- **Gejala pada screenshot:** perintah `.clip` diikuti stack Baileys `auth-utils.js` dengan HTTP 428 `Precondition Required` / `Connection Closed`. Stack menunjukkan kegagalan ketika Baileys mencoba mengirim pesan (`sendMessage` → `getSyncDevices`) pada koneksi yang sudah tertutup; percobaan laporan error fallback juga gagal pada socket yang sama.
- **Temuan input:** teks command yang tampak pada screenshot berakhir dengan `2:03:15 2:09.34`. Parser menerima `2:09.34` sebagai 2 menit 9,34 detik, bukan 2 jam 9 menit 34 detik. Karena `2:03:15` lebih besar dari `2:09.34`, rentang ditolak sebelum downloader berjalan. Jika maksudnya dua jam lebih, format yang benar adalah `2:03:15 2:09:34`. Screenshot tidak memperlihatkan log kegagalan downloader yang mendahului pesan ini, jadi tidak ada bukti bahwa yt-dlp/FFmpeg menjadi sumber error awal.
- **Akar masalah yang dapat dipastikan:** jalur validasi/penanganan error `.clip` tetap memanggil `conn.sendMessage` tanpa menangani kondisi socket tertutup; `handler.js` lalu mencoba mengirim laporan dan fallback lagi, sehingga 428 menutupi pesan validasi atau error fitur yang sebenarnya.
- **Perbaikan:** `plugins/downloader/clip.js` memakai pengiriman balasan yang aman, memeriksa `conn.ws.readyState`, menangkap kegagalan notifikasi agar tidak menimpa error proses, serta menampilkan timestamp awal/akhir yang diparse dan contoh format `HH:MM:SS` ketika rentang tidak valid. `handler.js` melewati laporan WhatsApp jika socket sudah tertutup dan tidak mengulang fallback untuk 428/Connection Closed.
- **Tes regresi:** `tests/clip-policy.test.js` memeriksa petunjuk timestamp dan memastikan plugin/global error reporter tidak mengulang pengiriman pada socket tertutup. Tes `npm run test:clip` dan workflow CI harus tetap dijalankan.
- **Batasan:** patch ini memperbaiki validasi dan penanganan notifikasi pada socket mati; tidak menghidupkan ulang koneksi WhatsApp dan tidak membuktikan ekstraksi YouTube berhasil. Setelah socket reconnect, ulangi command dengan timestamp yang benar. Jika masih gagal, ambil log terminal dari `[CLIP:<job>]` sejak tahap pertama hingga error downloader.
- **Pelajaran untuk fitur lain:** HTTP 428 `Connection Closed` dari Baileys sering merupakan error sekunder saat bot membalas, bukan akar masalah fitur. Pisahkan error operasi utama dari error notifikasi; jangan retry pengiriman pesan melalui socket yang sudah tertutup.
## 2026-11-03 — Fix .update gagal membaca commit terbaru GitHub HTTP 403

- Gejala: .update di WhatsApp membatalkan update pada 'Membaca commit terbaru gagal: HTTP 403'. Limit GitHub REST API tanpa autentikasi atau penolakan server dapat menyebabkannya; screenshot tidak menunjukkan header pembeda.
- Perbaikan: token GitHub opsional dari ALVARETH_GITHUB_TOKEN/GITHUB_TOKEN; API membaca header retry-after dan x-ratelimit-reset. Apabila REST 403/429/5xx, fallback read-only Git ls-remote/ Git fetch/ Git diff di bare repository terisolasi untuk menemukan SHA terbaru dan daftar perubahan.
- Keamanan: tetap wajib memvalidasi ancestry SHA, baseline file, hash lokal, filter file protected. Tidak memakai git reset --hard, tidak mengubah checkout lokal, tidak menaruh token pada log, dan membersihkan temp.
- Bootstrap satu kali: karena updater lama sudah terblokir, pengguna perlu memasang versi terbaru plugins/owner/update.js lewat TokoPanel Files, restart, lalu .update lagi. State baseline update-state-v1.json wajib tetap ada.
- Pengujian: 4/4 tests/update-transport.test.js lulus pada workflow 41558270979 menggunakan Git repo dummy lokal, termasuk operasi rename/add/delete/modify; syntax juga lulus. Uji langsung TokoPanel masih diperlukan.

## 2026-11-03 — Fix YouTube anti-bot verification and Qbyte 502 on .clip

- **Evidence from live TokoPanel:** video `iKLqlb_oX60` repeatedly returned `Sign in to confirm you're not a bot` from yt-dlp for default and `web_safari` player clients. API Qbyte returned HTTP 502. These are access/provider failures, not MP4 encoding or available resolution. No amount of picking 1080p will succeed unless at least one provider can supply the actual stream.
- **Authentication:** added optional `YTDLP_COOKIES_FILE` absolute path or automatic detection of `/home/container/.alvareth-bot-data/youtube-cookies.txt` (working directory must be /home/container). Both metadata and video/audio yt-dlp processes receive `--cookies` pointing to a private file. Cookie files must be Netscape/Mozilla format and readable. Code never logs contents or exports cookies to WhatsApp/GitHub.
- **Security:** added `.alvareth-bot-data/`, `youtube-cookies.txt`, and `*.cookies.txt` to gitignore; instruct the owner to apply restricted permissions and keep session exports private. The owner must supply a legitimate session; the code cannot fabricate authentication or guarantee that YouTube will accept a server IP.
- **No redundant login requests:** classify verification errors and skip the remaining yt-dlp methods once access is denied, while still trying Qbyte. Metadata format inventory is cached for the current clip job and shared among the four yt-dlp strategies rather than downloaded four times.
- **Provider resilience:** Qbyte HTTP 502/503/504 receives one extra attempt after a brief delay. Permanent HTTP errors still fail without extra calls. The WhatsApp error for auth failures now tells the owner exactly which private server setting to check without exposing secrets.
- **Testing:** added real Node tests using a dummy Netscape cookie file, invalid/missing cookie paths, login error classification, rate-limit retry behavior, and inventory reuse. GitHub Actions regression and JavaScript syntax check are the source-level verification; live YouTube and WhatsApp download still require a configured, accepted session.

## 2026-11-03 — Hotfix 1080p terdeteksi tetapi file hasil tidak memiliki track video

- **Bukti pengguna:** TokoPanel mengiklankan 1920x1080/24 FPS melalui yt-dlp (format 616+140), namun saat memasuki tahap FFmpeg muncul `stream map 0:v:0 matches no streams`. Alhasil metode yang tampak berhasil berikutnya hanya menghasilkan 360p. Ini membuktikan metadata 1080p belum menjamin bahwa file 1080p benar-benar berhasil diunduh.
- **Perbaikan:** setiap strategi sekarang mencoba beberapa format/codec video HD secara berurutan. Setelah yt-dlp selesai, FFprobe wajib menemukan dimensi video yang setidaknya 90% dari resolusi format yang dijanjikan. File audio-only, klip yang turun resolusinya, dan hasil yang hampir seluruhnya hitam ditolak agar alternatif HD berikutnya dicoba.
- **Metode tambahan:** `yt-dlp-isolated-tracks` mengunduh ID video sendiri, memverifikasi track gambar lebih dahulu, lalu mengunduh/mengecek ID audio terpisah sebelum mux. Ini menghindari ketergantungan pada intermediate gabungan yang sebelumnya bisa tidak memuat video.
- **Kompatibilitas kontainer:** metode yt-dlp lain sekarang menggunakan MKV sebagai intermediate (untuk VP9/AV1 + audio lintas codec) sebelum encoding H.264 CRF18/AAC MP4. FFmpeg menggunakan pemetaan video/audio eksplisit.
- **Seleksi final:** lima kandidat metode dinilai berdasarkan resolusi, FPS, dan bitrate nyata. Hasil inferior segera dibersihkan dari disk untuk menjaga ruang sementara. Qbyte juga mencoba berbagai ID video dengan validasi sumber. Caption memberi peringatan jika sumber mengiklankan HD tetapi server hanya bisa memperoleh SD.
- **Risiko yang belum terselesaikan:** akses YouTube dapat membatasi stream 1080p berdasarkan profil/client/IP/PO Token. Tanpa akses ke sumber yang benar-benar dapat diunduh, bot tidak dapat memaksa 1080p. Semua retry tetap tanpa batas waktu aplikasi atas permintaan sebelumnya; sumber yang macet dapat menunggu tanpa akhir.
- **Pengujian:** unit/mocks menguji transisi metadata 1080p → audio-only → pilihan 1080p valid, metadata 1080p tetapi video nyata 360p, validasi penolakan audio-only, dan pemeriksaan format multi-metode. GitHub Actions sekarang memasang FFmpeg untuk menjalankan tes fixture media nyata. Uji live YouTube dan WhatsApp pada server pengguna belum dilakukan.

## 2026-11-03 — Periksa semua metode dan kirim kandidat .clip dengan kualitas tertinggi

- **Gejala/permintaan:** output .clip berhenti di 360p; pengguna meminta setiap metode memeriksa kualitas tertinggi yang tersedia dan memilih metode terbaik.
- **Akar kelemahan alur lama:** tiga strategi yt-dlp memakai selector generik dan pipeline berhenti pada metode pertama yang berhasil. Qbyte hanya dicoba jika seluruh strategi yt-dlp gagal, sehingga format lebih tinggi dari provider lain tidak pernah dibandingkan.
- **Inventaris per metode:** setiap strategi yt-dlp menjalankan --dump-single-json, membaca semua format video/audio, dan memilih format ID video berdasarkan jumlah piksel, tinggi/lebar, FPS, bitrate, lalu ukuran. Audio terbaik dipilih terpisah jika video tidak membawa audio. Perintah download menggunakan format ID yang dipilih dan mencatat format aktual sebelum download. Qbyte mengurutkan inventarisnya sendiri dengan metrik yang sama.
- **Profil YouTube:** probe memeriksa profil default dan web_safari HLS. Jika YTDLP_POT_PROVIDER_URL tersedia, probe juga mencoba mweb melalui plugin bgutil PO Token Provider. Profil terbaik dipakai kembali pada perintah download. --remote-components ejs:github diaktifkan agar solver JavaScript eksternal tersedia; bila komponen GitHub gagal, probe/download mencoba fallback tanpa komponen remote.
- **Pemilihan metode:** semua empat metode dijalankan berurutan (3 strategi yt-dlp + Qbyte), setiap output lolos pemeriksaan FFprobe dan blackdetect, lalu kandidat dibandingkan berdasarkan luas piksel aktual, tinggi, lebar, FPS, bitrate, dan ukuran. Hanya kandidat terbaik dipertahankan untuk dikirim; direktori kandidat lain dibersihkan. Dampak: proses lebih lambat dan memakai bandwidth/ruang sementara lebih besar, tetapi tidak lagi berhenti pada hasil 360p pertama yang berhasil.
- **Batas penting:** bot tidak meng-upscale resolusi sumber. Jika seluruh inventaris dari profil/provider hanya menunjukkan 360p, YouTube mungkin memang hanya menyajikan 360p ke server atau membutuhkan PO Token. YTDLP_POT_PROVIDER_URL hanya bekerja jika plugin bgutil dan server provider telah dipasang/berjalan; server provider harus tetap di localhost/jaringan privat.
- **Tes:** regresi .clip dan pemeriksaan sintaks diperbarui untuk memeriksa format inventory, profil alternatif, pemilihan kandidat, dan fallback EJS. Uji jaringan YouTube serta upload WhatsApp langsung di TokoPanel belum dilakukan.

## 2026-11-02 — Perbaiki .clip yang terkirim sebagai layar hitam dengan audio saja

- **Gejala:** file MP4 yang dikirim terlihat seperti video, tetapi gambar hitam dan hanya musik/audio terdengar. Pemeriksaan lama hanya memeriksa signature/container MIME video; file tanpa stream video yang valid masih berpotensi lolos.
- **Akar masalah yang ditutup:** pemilih format Qbyte menerima format tanpa dimensi video selama codec video tidak bertuliskan none; pengunduh menerima file bertipe audio maupun video untuk label stream mana pun; pemeriksaan hasil klip tidak menolak ffprobe yang tidak menemukan video stream. Akibatnya stream audio/MP4 audio-only berpotensi lolos ke proses dan WhatsApp.
- **Validasi sumber:** pilihan video Qbyte sekarang wajib mempunyai tinggi/resolusi positif dan codec video bukan none; pilihan audio wajib mempunyai codec audio yang valid. Setelah file sumber diunduh, ffprobe memastikan label video benar-benar memiliki track video dan label audio benar-benar memiliki track audio.
- **Validasi hasil:** setiap klip wajib memiliki track video dengan dimensi yang valid. FFmpeg blackdetect memeriksa seluruh hasil dan menolak stream yang hampir seluruh durasi klipnya hitam (ambang 90%, dengan toleransi untuk intro/outro gelap). Jika satu metode menghasilkan audio-only atau gambar hampir seluruhnya hitam, metode tersebut gagal dan pipeline mencoba metode berikutnya; hasil tersebut tidak dikirim ke WhatsApp.
- **Kualitas:** tiga strategi yt-dlp memilih bestvideo+bestaudio/best dan memaksa urutan kualitas res,fps,br agar resolusi, FPS, dan bitrate diprioritaskan. Dokumentasi yt-dlp menjelaskan bahwa sort field disusun menurun dan --format-sort-force mengesampingkan prioritas hasvid/ie_pref saat memakai urutan custom. Jalur Qbyte memilih resolusi tertinggi, FPS tertinggi, bitrate tertinggi, lalu preferensi MP4. Jalur MP4 menggunakan H.264 CRF 18 dan AAC 192 kbps; caption menampilkan resolusi dan FPS hasil sebenarnya.
- **Pengiriman:** video MP4 akhir memiliki pemetaan track eksplisit 0:v:0 dan track audio opsional 0:a:0?, dengan yuv420p dan +faststart untuk kompatibilitas pemutar. Metode pertama kini juga melakukan finalisasi FFmpeg eksplisit alih-alih mengandalkan recode default yt-dlp.
- **Tes:** tests/clip-policy.test.js menambahkan pemeriksaan format video/audio, penolakan output tanpa video, deteksi klip hampir seluruhnya hitam, pemilihan kualitas tertinggi, dan pemetaan track. GitHub Actions regresi .clip lulus 14/14 (run 41491185274). Pemeriksaan sintaks JavaScript dijalankan pada run 41491185253. Filter blackdetect juga dicoba lokal dengan fixture sintetis video hitam+audio dan video berwarna; video hitam terdeteksi, video berwarna tidak ditandai.
- **Belum diverifikasi:** URL YouTube yang memicu masalah dan pengiriman WhatsApp live belum diuji dari TokoPanel. Setelah deploy/restart, uji ulang klip yang sama; jika gagal validasi, terminal akan menunjukkan metode dan alasan penolakannya, bukan mengirim layar hitam.

## 2026-11-02 — Hapus batas internal ukuran, durasi, dan timeout pada .clip

- **Permintaan/gejala:** log TokoPanel menunjukkan API Qbyte berhenti pada batas sumber 256 MB dan fallback yt-dlp berhenti setelah tidak ada output 90 detik. Pengguna meminta batas ukuran dan batas waktu internal dihapus.
- **Perubahan ukuran/durasi:** hapus batas sumber 256 MB video dan 96 MB audio dengan melewatkan `Infinity` ke stream Qbyte; hapus batas hasil akhir 45 MB dan opsi transcode paksa yang hanya bertujuan memenuhi batas tersebut; hapus batas durasi 15 menit dari plugin dan `downloadYoutubeClip`. Parser timestamp tetap menerima format `HH:MM:SS` untuk klip panjang.
- **Perubahan timeout khusus .clip:** tiga pemanggilan yt-dlp kini memakai `timeoutMs=0` dan tanpa `idleTimeoutMs`; helper hanya membuat hard timer bila nilai timeout positif. FFmpeg clip menerima timeout 0 dan tidak membuat timer. Metadata Qbyte dan unduhan video/audio mengatur Axios `timeout: 0`. Pemeriksaan Python yt-dlp dan unduhan skrip/binary setup tidak memasang timer/AbortSignal saat dipanggil oleh .clip. Flag `--socket-timeout 45` di tiga strategi clip dihapus; pemanggilan downloader YouTube lain tetap memakai nilai default lama.
- **Pengiriman file:** video dialirkan dari path lokal agar file besar tidak dimuat utuh ke RAM. Bila WhatsApp menolak pengiriman sebagai video, bot mencoba mengirim path yang sama sebagai dokumen. Batas/penolakan WhatsApp, YouTube, API pihak ketiga, dan kapasitas disk/hosting tidak dapat dihapus oleh kode bot.
- **Konsekuensi penting:** tanpa idle/hard timeout, proses/provider yang benar-benar macet dapat menunggu selamanya dan tidak otomatis melanjutkan ke fallback berikutnya. File besar/potongan panjang juga dapat memenuhi disk atau ditolak platform. Folder sementara tetap dibersihkan setelah handler selesai.
- **Tes:** ditambahkan `tests/clip-policy.test.js` untuk durasi panjang, penghapusan cap ukuran, dan tidak adanya deadline aplikasi; package script `test:clip` menjalankan 10 tes total. GitHub Actions YouTube Clip regression **success** (10/10 tes; run [41487205018](https://github.com/lightevil96-svg/Alvareth-Bot/actions/runs/41487205018)); JavaScript syntax checks **success** (run [41487205155](https://github.com/lightevil96-svg/Alvareth-Bot/actions/runs/41487205155)). Percobaan CI awal gagal karena tes baru mengimpor plugin yang memuat Axios sementara workflow tidak menginstal dependency; tes diperbaiki agar mengekstrak fungsi parser dari source dan memeriksa kebijakan tanpa mengimpor runtime, kemudian seluruh tes lulus.
- **Belum diverifikasi:** unduhan YouTube jaringan, upload file besar ke WhatsApp, dan perilaku live TokoPanel belum diuji. Perubahan baru aktif setelah source terbaru di server diterapkan dan bot direstart.

## 2026-11-02 — Hotfix .clip tidak berubah selama 6 menit setelah pesan progres

- **Bukti baru:** dua screenshot TokoPanel menampilkan command .clip dari URL YouTube /live/ dengan status WhatsApp masih Persiapan/validasi, metode 1/4 dan waktu 0m 0d. Penggunaan CPU terpantau sekitar 764% pada screenshot kedua; penyebab CPU belum dapat dipastikan dari screenshot. Pesan awal dan edit pertama terbukti terkirim, tetapi tidak ada pembaruan selanjutnya.
- **Akar masalah source:** format waktu hanya dihitung ketika pesan status dikirim; progres chat dipicu sepenuhnya oleh callback downloader. Bila yt-dlp diam saat menyiapkan metadata, tidak ada timer heartbeat dan pesan menjadi stale. Selain itu, tiga strategi yt-dlp memiliki timeout 30 menit sehingga fallback baru terjadi sangat lambat jika proses tidak menghasilkan progres.
- **Perbaikan:** plugins/downloader/clip-progress.js mengaktifkan heartbeat 15 detik saat start, menghitung elapsed aktual, dan menampilkan 30+ detik tanpa data tanpa membuat angka persen. Timer dibersihkan saat selesai/gagal. lib/scrape/youtube.js menambah opsi runYtDlp runOptions untuk idle timeout dan killTree yang dipakai hanya pada tiga metode clip. Silence 90 detik mematikan process group yt-dlp/FFmpeg di Linux dan memberi error yang diteruskan ke fallback; hard timeout setiap yt-dlp clip kini 6 menit. FFmpeg lokal runClipFfmpeg dibatasi 2 thread agar lebih sesuai untuk panel hosting bersama. Tidak ada perubahan perilaku default runYtDlp untuk downloader lain.
- **Pengujian nyata sesi ini:** uji parser/eksekusi fungsi yang diambil dari source GitHub dengan stub subprocess membuktikan timeout idle 90 detik menolak Promise, memanggil kill (-pid), membersihkan timer, dan stdout/stderr persen tetap bekerja. Uji helper heartbeat dengan timer/clock buatan berhasil mengedit pesan setelah 45 detik tanpa data dan mematikan timer saat akhir. Ditambah dua tes permanen di tests/clip-progress.test.js (total 8 tes). Node npm run test:clip, GitHub Actions, unduhan YouTube jaringan, dan WhatsApp/TokoPanel live **belum** dijalankan/terkonfirmasi.
- **Deploy:** perlu sumber GitHub terbaru pada server dan restart proses. Stop/Start setelah memastikan update akan membatalkan job lama yang memakai kode sebelumnya; jangan menganggap perubahan GitHub langsung memperbaiki job yang sedang berjalan. Pantau log [CLIP:<job>] dan status heartbeat chat.

## 2026-11-02 — Perbaikan menyeluruh jalur cache dan konversi fitur .s
- **Temuan cache:** pesan media yang disimpan dengan `JSON.parse(JSON.stringify(message))` mengubah Buffer/Uint8Array (mediaKey, fileEncSha256, fileSha256, thumbnail) menjadi objek JSON biasa. Ini dapat membuat `conn.loadMessage()` mengembalikan kunci media yang tidak dapat dipakai Baileys saat reply self-chat.
- **Perbaikan cache:** tambahkan `cloneMessageForMediaCache()` yang menyalin Buffer, typed arrays, ArrayBuffer, array, dan object secara rekursif dengan referensi siklik aman. Hanya pesan media yang memakai clone binary-safe; cache non-media tetap memakai serialisasi lama. Downloader memprioritaskan upload asli dari cache sebelum quoted thumbnail dan memilih source dengan binary mediaKey.
- **Perbaikan konversi:** `plugins/sticker/sticker-engine.js` memproses foto/video lokal tanpa upload publik/API stiker eksternal. Foto dikompres bertahap hingga batas statis 100 KB; video/GIF dibuat WebP animasi hingga batas 500 KB, target kompresi diberi ruang untuk metadata EXIF. Deteksi animasi membaca chunk RIFF WebP (ANIM/ANMF), bukan pencarian string bebas. Video dibatasi 10 detik, input 25 MB, proses FFmpeg dibatasi waktu dan output.
- **Tes yang ditambahkan/diperkuat:** pengujian clone binary, prioritas media asli, ukuran stiker foto/animasi, EXIF, dan output animasi. `npm test` memasukkan test media serta engine. Pemeriksaan parsing V8 untuk file terkait lolos; pipeline Sharp lokal menghasilkan WebP statis 850 byte dan pipeline FFmpeg 10 detik menghasilkan WebP animasi 477.334 byte (80 frame, di bawah target 480 KB). Tes integrasi penuh Node/WhatsApp dan deployment TokoPanel belum diverifikasi.
- **Diagnostik:** plugin `.s` menulis `[STICKER] Media terdeteksi`, `[STICKER] GAGAL` dengan tahap, dan detail error. Jika server masih menampilkan pesan generik lama, source stiker di runtime belum diperbarui ke commit terbaru.
- **Batasan:** hasil bergantung pada FFmpeg/Sharp dan ketersediaan media WhatsApp; konten yang tidak ada di cache/payload harus dikirim ulang.

## 2026-11-02 — Perbaikan .clip tidak merespons WhatsApp + progres persen nyata

- **Gejala:** .clip terus mencatat operasi di console TokoPanel, tetapi chat WhatsApp tetap diam hingga pekerjaan selesai/gagal; user meminta indikator progres di chat.
- **Akar masalah:** plugin clip sebelumnya hanya memakai createTerminalProgressReporter dan menunggu downloadYoutubeClip selesai sebelum mencoba mengirim hasil. Metode runYtDlp juga hanya mem-parse progres dari stderr, padahal persentase yt-dlp sering dicetak ke stdout.
- **Perubahan terisolasi:** plugins/downloader/clip-progress.js menangani pesan status awal, update satu pesan dengan payload Baileys {text,edit:key}, pembatasan pembaruan 4 detik, fallback teks berkala maksimum 8 kali bila edit ditolak, pesan selesai/gagal, sanitasi URL. plugins/downloader/clip.js sekarang memanggil progress.start() sebelum download, meneruskan callback onProgress ke terminal dan chat, memberi tahap sebelum upload, mengirim video dari path file lokal (fallback Buffer) untuk mengurangi RAM, menampilkan error secara langsung tanpa metadata GitHub, serta cleanup dalam finally. lib/scrape/youtube.js memproses persentase dari stdout dan stderr dengan buffer per stream termasuk baris akhir.
- **Kejujuran progres:** angka dalam chat adalah persentase fase yang dilaporkan yt-dlp/FFmpeg/kompresi, bukan angka keseluruhan. Persentase upload WhatsApp tidak tersedia di fork ini: chat menunjukkan tahap upload tanpa angka sampai pengiriman berhasil. Status akhir menjadi 100% setelah sendMessage selesai.
- **Pengujian:** 12 pemeriksaan mock alur .clip lolos (balasan awal, persen, edit, fallback teks, fallback Buffer, pesan error, cleanup, tanpa preview) di JavaScript isolate. Parser asli runYtDlp diujikan terhadap stdout/stderr terfragmentasi dan mengembalikan 80, 37.2, 100. Tes permanen: tests/clip-progress.test.js (6 kasus), npm run test:clip, workflow .github/workflows/clip-regression.yml. Keberhasilan tes Node CI dan pengiriman live TokoPanel belum dikonfirmasi.
- **Tidak diubah:** sistem downloader lainnya, mode perintah, target kualitas sumber, metode fallback, batas 45 MB dan 15 menit, database/sesi WhatsApp.

## 2026-11-02 — Perbaikan stiker .s tidak mengenali media reply dan balasan membawa kartu GitHub
- **Gejala:** WhatsApp self-chat memperlihatkan user membalas gambar dengan .s, tetapi bot mengirim “Balas gambar atau video dengan command .s” disertai kartu GitHub.
- **Akar masalah:** plugin stiker hanya memeriksa m.quoted/q.mimetype dan mengunduh melalui q.download(), walaupun contextInfo.quotedMessage dapat menyimpan media atau hanya ringkasan gambar. lib/simple.js juga sebelumnya tidak menyimpan pesan media milik sendiri (fromMe) dalam cache, sehingga original media tidak bisa ditemukan saat user mereply gambar yang dikirim dari akun terhubung.
- **Perbaikan:** plugin stiker menggunakan resolveQuotedMediaInfo() dan downloadQuotedMedia() dengan fallback untuk media yang dikirim langsung. lib/simple.js menambahkan pencarian contextInfo.stanzaId, membaca media asli dari conn.loadMessage, dan menyimpan foto/video yang diterima dari akun sendiri dalam cache yang dibatasi jumlah pesan per chat. Gagal mendeteksi media dan gagal mengunduh media memberi pesan berbeda; balasan .s memakai teks biasa, tanpa metadata tautan GitHub. Durasi video 10 detik dan pembuat stiker lama tetap dipertahankan.
- **Tes:** parser V8 lolos setelah hanya melepas deklarasi import/export pada file yang diperiksa. Enam kasus pembacaan konteks dan pemulihan media dari cache dijalankan pada potongan fungsi helper yang diambil dari GitHub dan lulus. Ditambahkan enam pengujian Node tests/quoted-media.test.js ke npm test, namun Node test dan uji WhatsApp live belum dapat dijalankan dari lingkungan ini karena checkout GitHub tidak tersedia. Periksa log [STICKER] Deteksi media setelah update server.
- **Batasan:** data media yang tidak ada di payload WhatsApp maupun cache lokal tetap tidak dapat dipulihkan; kirim ulang foto/video setelah bot menggunakan kode terbaru bila perlu.

## 2026-11-02 — AutoDL belum merespons link Facebook yang dikirim owner dari TokoPanel
- **Gejala:** log TokoPanel menerima `Type Msg: Conversation` dan link `https://www.facebook.com/share/r/...` dari nomor WhatsApp yang sama dengan nomor bot, tetapi tidak ada respons unduhan.
- **Akar masalah terverifikasi di source:** `handler.js` memakai syarat `!m.fromMe`; semua pesan yang dikirim dari akun WhatsApp milik bot, termasuk pesan manual owner, memiliki `fromMe === true`. `plugins/anu/_autodl.js` juga memblokir URL dari `fromMe` selain TikTok. Link Facebook `/share/r/` sudah dikenali oleh parser URL baru, sehingga blokir `fromMe` adalah salah satu penyebab kuat. Ada kemungkinan kedua: source GitHub terbaru belum terpasang di runtime TokoPanel.
- **Perbaikan:** `lib/auto-download.js` mengenali pesan teks mandiri dari owner (`conversation` / `extendedTextMessage` tanpa quoted), menjaga cache maksimal 2.000 ID pesan bot 10 menit; `lib/simple.js` membungkus `sendMessage` secara transparan untuk menandai ID pesan keluaran, tidak memodifikasi payload/kartu tautan. `handler.js` menerima link mandiri dari akun sendiri kecuali ID berasal dari bot, lalu mengirim ke plugin asli sesuai prefix dan izin. Router lama tetap menghindari duplikasi lewat `m.autoDownload`.
- **Diagnostik:** banner saat modul dimuat `[AUTODL] Router 2026-11-02/self-link-fix aktif`. Saat link dideteksi menampilkan platform/plugin dan indikator pesan akun sendiri; saat link mandiri dilewatkan, menampilkan alasan tanpa URL privat/token.
- **Tes:** menambah kasus `https://www.facebook.com/share/r/18wxGC4Qm/`, pesan owner `Conversation`/`ExtendedText`, penolakan quote/media caption, dan pengecualian bot-sent ID termasuk variasi JID/LID dalam `tests/auto-download.test.js`. Belum bisa menjalankan Node `npm test`, GitHub CI, API eksternal, atau uji WhatsApp live dari sesi ini. Kesesuaian sumber di GitHub diverifikasi setelah commit; keberhasilan unduh tetap harus diuji di TokoPanel.
- **Deployment:** commit GitHub tidak otomatis mengubah server jika bukan Git checkout atau startup bukan `npm start`; lakukan update source di TokoPanel dan restart. Uptime panel belum membuktikan versi bot yang sedang aktif. Jangan menjalankan `git pull` di kolom Console Pterodactyl biasa karena bukan terminal shell.

## 2026-11-02 — AutoDL otomatis mengenali URL dan memanggil downloader yang sesuai
- **Permintaan:** setiap pengguna cukup mengirim link, bot langsung memilih dan menjalankan downloader untuk layanan tersebut, tanpa command, tanpa menghapus atau mengganti fitur downloader yang sudah tersedia.
- **Akar masalah:** sakelar `chat.autodl` sudah ada dan `plugins/anu/_autodl.js` sebenarnya telah merutekan sejumlah link dengan menulis ulang `m.text`, tetapi chat privat tidak otomatis aktif secara default untuk semua layanan, sebagian jenis link/format belum divalidasi ketat, dan penggabungan router baru dengan router legacy berpotensi menggandakan unduhan. Router baru menggunakan routing terpusat yang tidak mengubah `m.text`.
- **Perubahan:** menambahkan `lib/auto-download.js` (parser satu URL, allowlist host+path per platform, tidak menerima URL sembarang), memanggil plugin aslinya melalui jalur izin, registrasi, limit, dan error handler di `handler.js`. `m.text` tetap teks asli agar `plugin.all`/`plugin.before` tidak berubah; hanya parser command pada plugin target memakai teks sintetik. Chat pribadi default aktif, grup harus mengaktifkan `.enable autodl`. Pesan bot sendiri, multi-URL, pesan ber-command, dan tautan tidak didukung diabaikan.
- **Layanan:** TikTok, Instagram, Facebook, X/Twitter, YouTube video/Shorts, YouTube Music audio, Pinterest, Spotify track, SoundCloud track, CapCut, MediaFire, Sfile.co, dan root repository GitHub (kecuali repo bot sendiri). Perintah .clip tetap mensyaratkan waktu mulai/akhir; .ytmp3 untuk YouTube video biasa tetap tersedia manual.
- **Beban dan duplikasi:** cache ID pesan router utama 5 menit maksimal 500, dua unduhan otomatis paralel dan antrean maksimal delapan dengan timeout tiga menit. Pada `plugins/anu/_autodl.js`, ditambahkan guard `m.autoDownload` supaya tidak memulai router kedua, menolak pesan berisi banyak URL, dan menggunakan `findAutoDownloadPrefix()` untuk memproses prefix regex tanpa mengambil karakter tak terlihat yang salah. Routing khusus lama (termasuk TikTok polos dari akun bot) dipertahankan untuk pesan yang tidak diambil router utama. TikTok downloader baru memprioritaskan URL terdeteksi ketimbang quoted text.
- **File:** `lib/auto-download.js`, `handler.js`, `plugins/anu/_autodl.js`, `plugins/downloader/tiktok.js`, `tests/auto-download.test.js`, `package.json`, README.md, AI_CONTEXT.md, docs/AI_CHANGELOG.md. Tidak mengganti penyedia download, API, atau tautan konten pengguna.
- **Tes:** 33 pemeriksaan routing dan prefix berbasis JavaScript isolate internal lulus sebelum helper dibuat, tetapi memakai shim URL untuk lingkungan tersebut. `npm test` kini menjalankan `node --test tests/auto-download.test.js`; tes Node (termasuk regresi router legacy), CI, downloader eksternal, serta pengiriman WhatsApp live belum diverifikasi dari sesi ini. Perlu diuji dari VPS/Pterodactyl setelah pull dan restart.
- **Batasan:** short-link/provider dan unduhan media tetap mengikuti kemampuan plugin asli; login, geo-block, rate-limit, layanan mati, atau konten privat tetap dapat gagal. Hindari menambahkan fallback API yang belum diuji atau melakukan auto-download semua URL.

## 2026-11-02 — Hilangkan tautan GitHub dari balasan dan menu
- **Permintaan:** hapus hanya tautan GitHub Alvareth Bot yang muncul saat bot membalas, karena dilaporkan membuat pengiriman pesan berat atau error. Jangan menghapus link YouTube, hasil downloader, atau fitur lain.
- **Temuan:** `config.js` masih memberi `global.adReply` metadata `externalAdReply` dengan `sourceUrl` GitHub; `plugins/main/menu.js` menyisipkan URL GitHub pada offer dan tombol Channel, serta menjadikan pesan menu gaya 2/detail sebagai link preview dengan thumbnail beresolusi tinggi. Helper `conn.reply` di `lib/simple.js` sudah tidak memaksakan preview global.
- **Perbaikan:** biarkan identitas bot dan URL repositori untuk permintaan eksplisit tetap ada; netralkan `global.adReply` menjadi `{ contextInfo: {} }`, atur `global.linkch` dari `WHATSAPP_CHANNEL_URL` agar fitur kanal tidak salah mengarah ke GitHub; hilangkan offer/tombol GitHub dari menu, dan kirim gambar menu dengan caption normal tanpa metadata link preview maupun proses upscaling thumbnail. Tautan lain tidak diubah; opsi menu dan audio tetap ada.
- **Tes:** pemeriksaan tekstual pada hasil perubahan: tidak ada referensi GitHub maupun `linkPreview` dalam menu, payload reply dan label fitur utama tetap ada. Belum menjalankan `npm test`, CI, atau uji pengiriman WhatsApp langsung pada VPS; semuanya perlu diverifikasi setelah pembaruan.
- **Regresi yang dihindari:** jangan mengaktifkan lagi `externalAdReply` global atau menyisipkan tautan GitHub pada setiap balasan. Link eksternal hanya ditampilkan bila relevan dengan perintah eksplisit.

## 2026-11-02 — Perbaikan deteksi media reply lintas plugin dan regresi .sw
- **Gejala:** pengguna me-reply media lalu mengirim .sw, tetapi bot menampilkan panduan umum seolah tidak ada foto/video yang direply.
- **Akar masalah:** plugins/owner/sw.js hanya mengklasifikasikan media melalui m.quoted.mimetype. Field MIME dapat tidak tersedia/terbawa pada hasil serialisasi untuk bentuk quoted tertentu, padahal payload Baileys masih menyimpan tipe pesan seperti imageMessage atau videoMessage. Jalur ini juga bergantung sepenuhnya pada m.quoted.download(), sehingga rentan ketika serializer tidak membangun objek quote secara utuh. Reply yang dibungkus ephemeralMessage/view-once perlu dibaca setelah wrapper dibuka.
- **Perbaikan bersama:** lib/simple.js menambahkan getQuotedMediaInfo(messageInfo) untuk mencari contextInfo.quotedMessage pada payload mentah/serialized, membuka wrapper pesan, lalu mengklasifikasikan media dari key tipe pesan dan mengambil MIME/caption bila tersedia. downloadQuotedMedia(messageInfo, conn) mencoba method serializer, kemudian conn.downloadM dengan node media asli sebagai fallback. Ini menjadi jalur bersama untuk fitur/plugin lain, bukan solusi khusus .sw.
- **Perbaikan plugin:** plugins/owner/sw.js menggunakan helper bersama; foto/video dikenali berdasarkan tipe pesan maupun MIME. Jika MIME hilang, video tetap masuk ke jalur video. Caption foto yang berisi sw URL mulai akhir juga dapat diparse sehingga pengguna tidak perlu mengirim ulang rentang yang sudah ada pada caption. Log diagnostik hanya mencatat tipe/MIME dan keberadaan payload, bukan isi media.
- **Dokumentasi pencegahan:** AGENTS.md dan bagian gotcha di AI_CONTEXT.md sekarang mewajibkan plugin memakai getQuotedMediaInfo()/downloadQuotedMedia(), bukan pemeriksaan m.quoted.mimetype saja. Tambahkan kasus baru ke helper bersama bila ada format wrapper lain; jangan membuat parser reply media lokal di tiap plugin.
- **Tes:** package.json memasukkan lib/simple.js serta plugins/owner/sw.js ke npm test; workflow CI memeriksa sintaks seluruh file JavaScript. Pada saat catatan dibuat, workflow untuk commit akhir sedang menunggu/berjalan. Belum dilakukan uji reply foto/video live di WhatsApp atau unduhan media pada server.
- **Batasan:** helper membaca struktur yang tersedia pada payload Baileys; jika WhatsApp tidak menyertakan contextInfo.quotedMessage sama sekali, plugin tidak dapat memulihkan media reply. Periksa log [SW] Reply media terdeteksi untuk membedakan payload quote hilang, tipe pesan tidak dikenal, dan kegagalan download.
- **Pelajaran regresi:** untuk fitur berbasis reply, cek dahulu m.rawMessage.message, m.quoted, m.quoted.mtype, m.quoted.mediaType, dan contextInfo.quotedMessage; klasifikasi berdasarkan tipe media, bukan MIME saja. Uji setidaknya foto/video biasa, media bercaption, view-once, ephemeral, dan pesan self-chat sebelum menyimpulkan bahwa Baileys tidak menerima reply.
## 2026-11-02 — Fitur `.sw` untuk unggah WhatsApp Status
- **Permintaan:** reply video dengan `.sw` untuk langsung mengunggahnya ke Status; reply foto dengan `.sw`, lalu gunakan `.sw URL_YOUTUBE waktu_mulai waktu_akhir` untuk menambahkan potongan musik.
- **Implementasi:** menambahkan `plugins/owner/sw.js` (owner-only). Video reply dikirim ke `status@broadcast`. Foto disimpan sementara per chat + pengirim (TTL 10 menit), lalu audio YouTube dicoba melalui yt-dlp dan fallback provider yang sudah ada; FFmpeg menggabungkan foto menjadi MP4 dengan bagian audio yang diminta. Status dikirim menggunakan `statusJidList` dari kontak pribadi yang tersedia di `conn.chats`, tanpa mengikutkan grup atau JID akun sendiri.
- **Validasi/pembersihan:** menerima URL YouTube, memvalidasi timestamp dan urutannya, membatasi durasi musik/video Status hingga 90 detik, membatasi ukuran media, memeriksa durasi video bila ffprobe tersedia, dan membersihkan direktori sementara setelah pengiriman atau kegagalan. Tidak menambah dependency.
- **Tes:** `package.json` diperbarui agar `npm test` menyertakan syntax check plugin baru. Pemeriksaan sintaks lokal, CI, pengunduhan YouTube, FFmpeg, serta upload Status WhatsApp live belum dijalankan pada saat commit ini.
- **Batasan:** daftar penerima mengikuti kontak pribadi yang telah dimuat di cache `conn.chats`; cakupannya bergantung pada sinkronisasi/cache Baileys. Foto dengan musik diposting sebagai video MP4 statis, bukan fitur musik-native pada editor Status WhatsApp. Fitur perlu diuji di sesi WhatsApp/TokoPanel aktif.
- **Pelajaran:** untuk status broadcast, `statusJidList` harus diisi dengan JID audiens; jangan mengirim seluruh entri cache karena dapat mencakup grup/channel. Simpan foto pending dengan key pengirim + chat agar tidak tertukar antar pengguna.

## 2026-11-02 — Progres YouTube Clip khusus terminal
- **Permintaan:** indikator proses `.clip` harus terlihat real-time di terminal server saja, bukan sebagai pesan progres di chat WhatsApp.
- **Akar penyebab:** reporter terminal sudah tersedia, tetapi plugin masih mengirim pesan status berjalan ke WhatsApp. Reporter juga mempertahankan persentase lintas fase sehingga progres transfer/encoder berikutnya dapat terlihat tidak bergerak ketika persentasenya kembali ke angka kecil.
- **Perubahan:** `plugins/downloader/clip.js` menghapus pesan status sementara di WhatsApp; chat tetap menerima hasil akhir atau pesan kegagalan. Reporter terminal per-ID job kini mereset progress bar saat sumber transfer/encoder berubah, persentase kembali turun (misalnya unduhan video lalu audio), atau metode fallback/percobaan kompresi baru dimulai. Log tetap memuat tahap, persentase nyata, kecepatan/ETA bila tersedia, fallback, validasi, pengiriman, dan cleanup. Lama pengiriman WhatsApp dicatat, tetapi persentase upload tidak dibuat-buat karena `sendMessage` pada jalur ini tidak menyediakan callback progres. Matcher transfer mencari tag `[download]`/`[ffmpeg]` di mana pun dalam baris, sehingga awalan `[qbyte]` pada log fallback tetap masuk ke progress bar yang benar.
- **Tes:** parsing V8 terhadap `lib/scrape/youtube.js` dan `plugins/downloader/clip.js` (import/export ESM dilepas untuk pemeriksaan) lulus; GitHub Actions job `syntax` lulus pada commit `072200442c0556ce27c365e228dc0e87751682f2` (run `41437723061`). `npm test` tidak dapat dijalankan dari checkout lokal karena container gagal mengakses GitHub saat clone. Belum dilakukan unduhan YouTube atau pengiriman WhatsApp live dari Pterodactyl.
- **Belum diverifikasi:** tampilan log aktual pada terminal hosting serta durasi upload media pada jaringan server.
- **Pelajaran regresi:** setiap fase transfer yang dimulai ulang harus mendapatkan progress bar baru; jangan mengirim pembaruan progres berulang ke chat bila pengguna meminta pemantauan terminal saja.

## 2026-11-02 — Indikator progres YouTube Clip khusus terminal
- **Permintaan:** tampilkan apa yang sedang dilakukan .clip dan progres sebenarnya secara real-time, tetapi indikator hanya terlihat di terminal/log Pterodactyl, bukan sebagai pesan progres di chat WhatsApp.
- **Akar penyebab:** plugin sebelumnya hanya mencatat callback progres pada batas 0%/100%; runYtDlp() juga memakai pola pemisah baris dan regex [download] yang terlalu ter-escape sehingga baris progres yt-dlp tidak terurai dengan benar. Runner FFmpeg belum meneruskan informasi out_time/speed, dan fallback Qbyte belum melaporkan kemajuan transfer stream.
- **Perubahan:** setiap permintaan memperoleh ID job unik agar log beberapa pengguna dapat dibedakan. Plugin .clip sekarang menampilkan tahap validasi, nama metode/fallback, bar progres transfer, kualitas dan ukuran hasil, proses kirim, durasi total, serta cleanup hanya lewat console.log/console.error. Parser yt-dlp diperbaiki untuk memisahkan CR/LF dan membaca persentase [download]. Runner FFmpeg menggunakan -progress pipe:1 -nostats ketika callback tersedia, lalu menghitung persentase berdasarkan out_time dan menampilkan speed. Unduhan stream Qbyte mencatat bytes diterima, persentase jika Content-Length tersedia, kecepatan rata-rata, dan ETA. Output progres di-throttle agar tidak membanjiri terminal. Pesan awal, hasil akhir, dan pengiriman video WhatsApp tetap dipertahankan; tidak ada pembaruan progres real-time yang dikirim ke chat.
- **Batasan:** conn.sendMessage() pada jalur pengiriman media tidak menyediakan callback persentase upload yang digunakan fitur ini, sehingga terminal hanya menampilkan bahwa pengiriman dimulai dan mencatat sukses/gagal setelah hasilnya kembali. Untuk transfer provider tanpa Content-Length, terminal menampilkan bytes diterima dan kecepatan tanpa mengarang persentase/ETA.
- **Tes:** pemeriksaan sintaks JavaScript pada lib/scrape/youtube.js dan plugins/downloader/clip.js melalui parser V8 berhasil setelah import/export ESM dilepas untuk keperluan parsing. npm test tidak dapat dijalankan dari checkout lokal karena koneksi container ke GitHub gagal; workflow GitHub Actions perlu dipantau. Unduhan YouTube, encoding FFmpeg, dan pengiriman media belum diuji langsung di Pterodactyl.
- **Commit kode berturut-turut:** 34f5913bd502b65435c41314032a52e1feeb00a2, bede572cb262702e4239dd233d675fbdfcfbe84a, 774e3d324d56eb44a2d26304884289a53f9dcba3, 28facd573818bc02be8a0281b52d7e2473930380, 31854be34e071f653d3b7b2cf75b815db315bb2d, 91dd8d5e86ac4cc8b6206d35989238e6dd800777.
## 2026-11-02 — Prioritas kualitas tertinggi dan optimasi batas WhatsApp untuk YouTube Clip
- **Permintaan:** pastikan `.clip` memilih kualitas setinggi mungkin, dengan keberhasilan pengunduhan/pengiriman tetap diprioritaskan; jangan membatasi semua metode ke 720p atau fallback API ke 480p.
- **Akar penyebab:** metode pertama dan kedua sebelumnya membatasi stream sampai 720p, metode API terakhir memilih tepat/dekat 480p, dan hasil yang melampaui 45 MB langsung membuat metode gagal walaupun masih dapat dikompresi agar bisa dikirim.
- **Perubahan:** jalur yt-dlp utama sekarang meminta kombinasi video+audio terbaik dan mengurutkan resolusi/FPS. Jalur YouTube Clipper juga memilih stream video/audio terbaik tanpa filter MP4 yang berpotensi menurunkan resolusi, lalu mengodekan output H.264/AAC. Jalur Clippy memilih MP4 terbaik yang tersedia tanpa batas 720p. API Qbyte memakai `pickBestVideo()` (resolusi, FPS, kontainer, bitrate), bukan target 480p. Setelah setiap metode berhasil menghasilkan video valid, helper `fitClipForWhatsApp()` mempertahankan file asli bila ukurannya ≤45 MB; bila lebih besar, helper menghitung anggaran bitrate dari durasi, memilih batas resolusi yang sesuai, lalu mencoba empat tingkat bitrate H.264/AAC sebelum metode dinyatakan gagal.
- **Urutan akhir:** (1) yt-dlp section + keyframe, (2) YouTube Clipper dengan source stream terbaik + FFmpeg, (3) YouTube Clippy/FFmpeg untuk stream MP4 terbaik, (4) Qbyte API dengan format video/audio terbaik + FFmpeg. Metode Qbyte tetap menjadi sumber ekstraksi berbeda, best-effort.
- **Batas kualitas:** bila sumber terbaik sudah ≤45 MB, file asli tidak di-encode ulang. Bila melebihi batas, kompresi dapat menurunkan bitrate/resolusi untuk menjaga ukuran dan kompatibilitas WhatsApp. Klip 15 menit yang harus muat ≤45 MB tidak mungkin selalu mempertahankan kualitas asli; tidak ada cara menjamin kualitas tertinggi sekaligus ukuran tetap tersebut.
- **Tes:** kedua file JavaScript akan diperiksa sintaksnya; workflow GitHub Actions `JavaScript syntax checks` harus dipantau. Belum ada uji unduhan YouTube live atau uji FFmpeg/WhatsApp di Pterodactyl.
- **Commit kode:** `lib/scrape/youtube.js` — `555d079ce4370a1a96bab826577248ef9078e814` (kualitas tertinggi + transcode adaptif), `b325759318574dd367adcfe0bebd5673cd0972db` (urutan fallback kualitas).
## 2026-11-02 — Fallback bertingkat YouTube Clip
- **Permintaan:** gunakan pendekatan dari seluruh proyek clipper yang ditinjau; jika sebuah metode gagal, lanjut otomatis ke metode berikutnya, dan kirim pesan error hanya setelah semuanya gagal.
- **Evaluasi sumber:** `yt-dlp` tetap mesin utama. `youtube-clippy` memberi varian pemotongan melalui FFmpeg external downloader. `GatewayCortex/youtube-clipper` memberi pola encode H.264/AAC terpisah setelah segment download. `YoutubeToMp4Console` memakai `yt-dlp --download-sections` dan FFmpeg yang sama dengan jalur utama, serta memerlukan runtime .NET bila dijalankan sebagai aplikasi; karena itu tidak dijalankan sebagai proses terpisah. Tiga proyek wrapper tersebut bukan tiga penyedia ekstraksi independen.
- **Perubahan:** `lib/scrape/youtube.js` kini mencoba berurutan (1) yt-dlp section + keyframe, (2) FFmpeg external downloader, (3) section download lalu transcode FFmpeg terpisah, dan (4) API Qbyte sebagai sumber alternatif diikuti FFmpeg trim. Hasil setiap metode divalidasi sebagai video, ukuran hasil maksimal diperiksa sebelum menerima metode, file sementara metode gagal dibersihkan, dan setiap kegagalan dicatat secara ringkas. Jalur Qbyte membatasi sumber video 256 MB dan audio 96 MB.
- **Command:** format `.clip URL waktu_mulai waktu_akhir` tetap sama; batas durasi 15 menit dan batas kirim WhatsApp 45 MB tetap dipertahankan. Pesan status menjelaskan fallback terakhir dapat mengunduh sumber sementara sebelum memotong. Jika semua strategi gagal, `.clip` mengirim ringkasan semua penyebab kegagalan; kegagalan kirim WhatsApp tidak salah dilaporkan sebagai kegagalan downloader.
- **Commit implementasi:** `lib/scrape/youtube.js` — `3d67f79b44e41c9cde0031c0f0453b7ccd393295`; `plugins/downloader/clip.js` — `d48c97e2f6236f3c6ed2b1ea623f843e7dd69710`.
- **Tes:** parser JavaScript V8 berhasil mem-parsing kedua file setelah deklarasi import/export ESM dilepas untuk pemeriksaan sintaks. Workflow GitHub Actions pemeriksaan sintaks masih berstatus queued saat verifikasi terakhir; `npm test` belum dijalankan. Belum ada unduhan YouTube live, tes endpoint Qbyte, FFmpeg pada Pterodactyl, atau pengiriman WhatsApp yang diverifikasi.
- **Batasan:** tiga metode pertama tetap bergantung pada yt-dlp/FFmpeg sehingga tidak mengatasi semua kegagalan ekstraksi YouTube. API Qbyte merupakan layanan eksternal best-effort; metode terakhir dapat mengunduh seluruh sumber sementara, dibatasi ukuran per stream, dan dapat gagal karena kuota/timeout/provider. Gunakan hanya video yang dimiliki atau diizinkan untuk diunduh dan dipotong.
## 2026-10-31 — YouTube Clip command
- **Permintaan:** command `.clip` untuk mengambil rentang waktu tertentu dari video YouTube panjang.
- **Akar pendekatan:** downloader sebelumnya hanya menyediakan unduhan video penuh; fitur potong langsung lebih efisien memakai `yt-dlp --download-sections` yang membutuhkan FFmpeg. Opsi `--force-keyframes-at-cuts` dipakai untuk hasil potong lebih presisi.
- **Perubahan:** menambahkan `downloadYoutubeClip()` ke `lib/scrape/youtube.js`, memakai runner yt-dlp resmi yang sudah tersedia, memilih video maksimal 720p, menggabungkan/recode MP4, validasi file hasil, batas durasi 15 menit, dan folder output unik. Menambahkan `plugins/downloader/clip.js` untuk format `.clip URL MM:SS HH:MM:SS`, pengiriman video WhatsApp, batas 45 MB, dan cleanup file sementara. Menambahkan syntax check helper dan plugin ke `npm test`.
- **Contoh:** `.clip https://youtu.be/VIDEO_ID 25:00 27:00`.
- **Tes:** belum menjalankan `npm test`, unduhan YouTube live, FFmpeg, atau pengiriman WhatsApp pada server bot. Kode sudah dikomit langsung ke `main`.
- **Batasan:** runtime harus memiliki FFmpeg/ffprobe yang bisa dijalankan. YouTube dapat membatasi atau mengubah akses; video privat/berbayar/terbatas usia atau region mungkin gagal. Maksimal durasi clip 15 menit dan file 45 MB. Pengguna bertanggung jawab memastikan hak untuk mengunduh dan membagikan video.

## 2026-10-31 — Fitur AI Video Generator gratis
- **Permintaan:** menambahkan fitur generate video pada Alvareth Bot dengan sumber yang dapat digunakan gratis.
- **Pilihan sumber:** FreeTheAI Gateway; dokumentasinya menyediakan endpoint video task POST /v1/videos, polling GET /v1/videos/{id}, dan download MP4. Dokumentasi menyebut model gratis memakai ID fta/<provider>/<model>.
- **Perubahan:** menambahkan plugins/ai/aivideo.js dengan command .aivideo, .text2video, .img2video, dan .aivideomodels untuk menampilkan kandidat ID model video gratis; mendukung prompt teks dan foto yang direply, polling task sampai selesai, timeout 15 menit, validasi MIME/ukuran output, pesan error untuk kuota/akses, serta hanya mengizinkan model berawalan fta/ agar konfigurasi tidak tanpa sengaja memilih rute berbayar. Menambahkan FREETHEAI_API_KEY dan FREETHEAI_VIDEO_MODEL ke .env.example, serta syntax check ke npm test.
- **Tes:** belum menjalankan npm test atau uji API/WhatsApp langsung dari runtime bot. Perubahan kode sudah dikomit ke main.
- **Batasan:** harus mengisi API key dan ID model gratis yang benar-benar mendukung video. FreeTheAI mensyaratkan email terverifikasi dan daily check-in untuk model gratis; kuota, antrean, dukungan durasi/ukuran, dan ketersediaan model mengikuti provider. Tidak ada klaim unlimited atau jaminan output berhasil sebelum uji live.

## 2026-10-30 — Laporan error kompatibel dengan WhatsApp lama
- **Gejala:** setelah `.toreal` gagal, WhatsApp menampilkan pesan bertipe Buttons yang menyatakan versi klien tidak mendukungnya; detail penyebab API tidak sampai ke pengguna.
- **Akar penyebab:** `sendErrorReport()` mengirim native-flow `cta_copy` tanpa fallback bila pengiriman diterima server tetapi klien WhatsApp tidak mampu merendernya.
- **Perubahan:** `handler.js` kini selalu mengirim laporan teks biasa berisi plugin, command, jenis/pesan error, dan cuplikan stack yang sudah disamarkan. Jika pengiriman dengan quoted message gagal, dicoba sekali lagi tanpa quote.
- **Tes:** perubahan ditulis ke branch `main`; belum menjalankan `npm test` atau uji WhatsApp/TokoPanel.
- **Belum diverifikasi:** penyebab utama kegagalan API `.toreal` belum terlihat karena laporan error sebelumnya tidak kompatibel; perlu satu kali tes setelah restart dan kirim teks log yang diterima.
- **Pelajaran regresi:** diagnostik kritis harus memakai teks biasa sebagai format dasar; tombol interaktif hanya boleh menjadi peningkatan opsional, bukan satu-satunya jalur laporan.

## 2026-10-30 — Memperbaiki request API AI Image Converter yang menggantung
- **Gejala:** log mencapai tahap API setelah upload, tetapi tidak ada API_RESPONSE, hasil gambar, atau error yang terlihat.
- **Akar masalah yang diperbaiki:** plugin memakai opsi timeout pada node-fetch v3, padahal timeout harus dikendalikan melalui AbortSignal; request dapat menunggu tanpa batas dan tidak menghasilkan pesan kegagalan yang jelas.
- **Perubahan:** menambahkan fetchWithTimeout berbasis AbortController dengan timer yang dibersihkan; menerapkannya pada request konversi dan download URL hasil; mencatat durasi request, HTTP status, dan content-type; mendukung respons gambar biner, JSON berisi URL, serta URL teks; menampilkan cuplikan error bila format respons tidak dikenal.
- **Tes:** perubahan tersimpan di main. Pemeriksaan npm test dan uji API/WhatsApp langsung belum dijalankan dari TokoPanel.
- **Verifikasi berikutnya:** restart, coba .toreal, lalu baca log API_RESPONSE atau pesan timeout/error baru untuk membedakan API lambat, API gagal, dan format respons yang berbeda.
- **Referensi:** commit 125ce0067cd3332541b47637e1d64aee14a61fa1.

## 2026-10-30 — Perbaikan deteksi foto yang direply pada AI Image Converter
- **Gejala:** setelah plugin berhasil dimuat, command seperti .toreal tetap mengirim panduan penggunaan seolah-olah pengguna belum membalas foto.
- **Akar masalah:** deteksi media hanya mengandalkan properti hasil serialisasi m.quoted; pada sebagian payload/fork Baileys, metadata media kutipan tidak terbaca melalui jalur tersebut.
- **Perubahan:** ambil contextInfo.quotedMessage langsung dari m.rawMessage.message (dengan traversal wrapper WhatsApp), ekstrak imageMessage, validasi MIME, lalu unduh melalui conn.downloadM(imageMessage, 'image') sebagai fallback bila q.download() gagal/tidak menghasilkan buffer. Semua command dalam plugin image bersama memperoleh perbaikan yang sama.
- **Tes:** perubahan sudah dikomit ke main; pengujian syntax/runtime dan konversi live belum dijalankan dari TokoPanel.
- **Langkah verifikasi:** restart bot, reply foto dengan .toreal; log yang diharapkan berurutan [IMAGE:.toreal] START, DOWNLOAD, VALIDATE, UPLOAD, API, SEND, SUCCESS.
- **Referensi:** commit 39c4cd3d3fb9931afbaa966166ddd670c97558ec.

## 2026-10-30 — Memperbaiki plugin image gagal dimuat karena regex URL
- **Permintaan/gejala:** bot tersambung ke WhatsApp, tetapi command image seperti `.toreal` tidak merespons; log TokoPanel menunjukkan `Gagal memuat plugin 'image/tohitam.js': SyntaxError: Invalid regular expression flags`.
- **Akar penyebab:** dua regex literal validasi URL pada `plugins/image/tohitam.js` memiliki escape slash berlebih sehingga parser JavaScript membaca bagian setelah regex sebagai flag yang tidak valid. Karena seluruh command image didaftarkan melalui plugin bersama ini, satu SyntaxError menonaktifkan semua command dalam daftar tersebut.
- **Perubahan:** mengganti kedua regex URL dengan helper `isHttpUrl()` berbasis `URL` API; memperbaiki escape newline pada pesan bantuan; menambahkan pemeriksaan sintaks `plugins/image/tohitam.js` ke `npm test`.
- **Tes:** perubahan kode dan konfigurasi test tersimpan di `main`; pemeriksaan runtime WhatsApp/TokoPanel dan hasil `npm test` belum dijalankan dari lingkungan ini.
- **Belum diverifikasi:** apakah plugin berhasil dimuat setelah restart, apakah media reply dapat diunduh, serta apakah layanan upload Uguu dan API konversi FAA dapat diakses dari hosting.
- **Pelajaran regresi:** hindari escape slash berlapis pada regex literal yang ditulis melalui generator; gunakan `URL` API untuk validasi URL dan pastikan plugin bersama memiliki syntax check eksplisit.
- **Referensi:** commit kode `bb186ed103af44fd491f442a0bb84b2f2aa3a5d8`.

# AI Change Log — Alvareth Bot

## 2026-10-30 — Diagnostik command image yang tidak masuk ke plugin
- Screenshot runtime menunjukkan bot tersambung dan menerima teks `.toreal`, tetapi tidak ada log `[IMAGE]`; berarti proses belum terbukti mencapai handler plugin image.
- Menambahkan trace terbatas untuk command image konversi (`.toreal`, `.tohitam`, `.tochibi`, `.toghibli`) yang mencatat teks masuk, chat/sender, status fromMe/owner, prefix aktif, jumlah plugin, serta plugin kandidat yang command-nya cocok beserta status disabled/tipe fungsi.
- Tujuan trace: membedakan kegagalan parsing pesan, prefix matcher, plugin belum terdaftar/disabled, dan kegagalan setelah plugin dimulai. Tidak mencatat isi gambar atau kredensial.
- **Belum diuji live:** perlu satu percobaan setelah restart untuk mendapatkan baris `[COMMAND TRACE]`; jangan menyimpulkan perbaikan berhasil sebelum log `[IMAGE] ▶ Mulai` muncul.

## 2026-10-30 — Perbaikan router prefix command (termasuk kategori image)
- **Gejala:** setelah pengguna mengirim `.toreal` sebagai balasan foto di chat pribadi, bot tidak merespons dan log lifecycle `[IMAGE]` tidak muncul.
- **Akar penyebab yang ditemukan:** router command memanggil `RegExp.exec()` pada objek prefix yang dipakai bersama semua plugin, lalu memilih kandidat pertama hanya karena objek regex-nya ada—bukan karena prefix benar-benar cocok. Regex dengan flag global/sticky dapat mempertahankan `lastIndex` dan menyebabkan pencocokan command tidak konsisten; kondisi pemilihan kandidat juga tidak memverifikasi hasil match.
- **Perubahan:** `handler.js` sekarang mengkloning regex prefix untuk setiap pemeriksaan, menghapus flag stateful `g/y`, dan memilih hanya hasil yang benar-benar cocok. Ini memperbaiki routing command lintas kategori, bukan hanya `.toreal`.
- **Tes:** perubahan dikomit ke `main`; syntax check dan pengujian live WhatsApp/TokoPanel belum dijalankan dari lingkungan ini.
- **Belum diverifikasi:** apakah setelah command berhasil masuk ke plugin, unduhan gambar reply dan API konversi berhasil pada runtime TokoPanel; apakah kartu tautan GitHub yang pernah terlihat berasal dari payload menu atau konteks pesan lain.
- **Pelajaran regresi:** pengujian router harus mencakup banyak plugin yang berbagi regex prefix, regex berflag `g/y`, command dari chat pribadi/self-chat, dan command yang membalas media.

## 2026-10-30 — Indikator terminal kategori image
- **Perubahan:** `handler.js` sekarang mendeteksi plugin bertag `image` dan mencatat awal proses, handler yang sedang berjalan, status selesai/gagal, command/plugin, identitas pengirim yang disamarkan ke nomor lokal, dan durasi.
- **Tahap detail:** `plugins/image/tohitam.js` mencatat download gambar, validasi, upload, pemanggilan API AI, status HTTP, download hasil, pengiriman WhatsApp, dan total waktu proses.
- **Tujuan:** membedakan bot yang sedang bekerja dari proses yang berhenti/gagal, serta menunjukkan tahap terakhir sebelum error.
- **Batasan:** plugin image lain saat ini mendapat indikator lifecycle umum dari handler; rincian tahap internal tambahan baru dipasang di AI Image Converter. Log terminal tidak dapat membuktikan proses API eksternal masih aktif jika request sedang menunggu respons; timeout/error tetap menjadi indikator akhir.
- **Tes:** kode sudah disimpan ke `main`; pemeriksaan sintaks dan pengujian live TokoPanel/WhatsApp belum terkonfirmasi.
- **Tautan GitHub:** audit kode menemukan kebijakan preview terpusat di `lib/simple.js` saat ini membiarkan `conn.sendMessage` native dan tidak menyisipkan preview global. Karena itu jangan mengubahnya secara global; perlu uji ulang pada chat untuk memastikan sumber kartu GitHub di screenshot, lalu matikan hanya pada jalur pesan kategori image jika masih muncul.

## 2026-10-30 — AI Image Converter gagal mengenali gambar reply
- **Gejala dari screenshot:** perintah `.toreal` menerima pesan reply dan mengirim status proses, tetapi tidak menghasilkan gambar; bot justru menampilkan daftar command AI Image Converter.
- **Akar penyebab paling mungkin dari kode:** `plugins/image/tohitam.js` hanya memeriksa `q.mimetype` dan `q.msg.mimetype`. Pada beberapa struktur pesan/quoted wrapper Baileys, MIME gambar berada di nested `imageMessage`, sehingga foto yang sebenarnya valid salah dianggap bukan gambar dan handler mengirim menu bantuan. Catch lama juga membuang error asli sehingga penyebab API/upload tidak terlihat.
- **Perubahan:** deteksi gambar sekarang menelusuri wrapper ephemeral/view-once/quoted dan payload nested; signature file divalidasi dengan `file-type`; upload, API HTTP/JSON, dan hasil gambar diperiksa; timeout serta batas ukuran diterapkan. Error tidak lagi ditelan, tetapi dilempar ke handler utama agar laporan tombol Salin Log Error dapat dikirim.
- **Tes:** perubahan kode dan dokumentasi tersimpan di `main`; pemeriksaan sintaks GitHub Actions serta uji WhatsApp/TokoPanel belum terkonfirmasi pada saat pencatatan.
- **Belum diverifikasi:** struktur pesan aktual dari screenshot, ketersediaan API `api-faa.my.id`, layanan upload Uguu, dan keberhasilan tombol salin log pada klien WhatsApp.
- **Pelajaran regresi:** jangan menentukan jenis media reply hanya dari satu properti serializer; cek nested payload dan signature file, serta jangan menelan exception pada plugin.

## 2026-10-30 — Tombol salin log untuk error lintas fitur
- **Permintaan/gejala:** pengguna ingin setiap fitur yang mengalami error menampilkan pesan dengan tombol untuk menyalin log agar mudah dikirim untuk diagnosis.
- **Akar penyebab:** penanganan error sebelumnya hanya mengirim teks `format(e)` pada catch command; error dari `plugin.all`, `plugin.before`, dan lapisan handler tidak memiliki format laporan yang konsisten.
- **Perubahan:** `handler.js` memiliki `sendErrorReport()` bersama. Catch `plugin.all`, `plugin.before`, command plugin, dan outer handler memanggilnya. Pesan menggunakan tombol native WhatsApp `cta_copy` dengan isi stack/log, disertai fallback teks bila tombol gagal dikirim. Log dibatasi 12 KB, URL query disamarkan, dan pesan memberi peringatan agar log diperiksa sebelum dibagikan.
- **Tes:** belum menjalankan bot pada WhatsApp/TokoPanel; pemeriksaan sintaks dan pengujian interaksi tombol masih harus diverifikasi. Tombol salin memerlukan dukungan klien WhatsApp terhadap native-flow `cta_copy`.
- **Belum diverifikasi:** kompatibilitas tepat `nativeFlowInfo` pada fork Baileys `@itsliaaa/baileys@0.3.18-final`, perilaku di Android/iOS/Desktop, dan log untuk error sebelum objek pesan/chat terbentuk.
- **Pelajaran regresi:** error global tidak boleh membocorkan token, URL bertanda tangan, atau kredensial; setiap jalur catch harus tetap mencatat stack di server meskipun pesan WhatsApp gagal terkirim.

## 2026-10-30 — TikTok: fallback resolver tambahan
- Permintaan: tambah sumber unduhan alternatif dan menjaga hasil HD.
- Perubahan: menambahkan resolver SaveAPI opsional pada `plugins/downloader/tiktok.js`. Resolver hanya aktif bila `SAVEAPI_KEY` diatur dan baru dipanggil setelah kandidat TikWM gagal. Hasil diperiksa dengan ffprobe dan validasi frame; resolusi di bawah 720 piksel pada sisi terpanjang ditolak. Fallback yt-dlp juga kini melewati validasi resolusi dan frame.
- Tes: belum ada uji live dari TokoPanel atau panggilan API. Pemeriksaan sintaks lokal belum dijalankan; skrip `npm test` kini mencakup file downloader TikTok.
- Belum diverifikasi: API key/kredit, akses jaringan TokoPanel, dan ketersediaan varian HD pada setiap video.
- Referensi: commit `f46bdb947dac1b718bb7f7892b3a76eda94ce0c5`.


## 2026-10-30 — Diagnostik error TikTok lebih lengkap
- **Permintaan:** saat downloader gagal, tampilkan detail yang cukup lengkap agar AI/pengembang mudah menentukan sumber masalah.
- **Perubahan:** `plugins/downloader/tiktok.js` sekarang mempertahankan pesan error asli dan menambahkan status/statusText HTTP, endpoint provider tanpa query string (menghindari kebocoran token/URL bertanda tangan), cuplikan body respons, `code`, `errno`, `syscall`, `path`, dan `cause` bila tersedia. Ringkasan akhir menampilkan semua tahap yang gagal dalam baris terpisah; pesan WhatsApp juga menjelaskan bahwa stack/log lengkap tersedia di server.
- **Tujuan diagnostik:** membedakan provider menolak request (misalnya HTTP 503), URL/media tidak valid, file terpotong/rusak, kegagalan FFmpeg, masalah yt-dlp, dan masalah filesystem.
- **Tes:** commit dilakukan; syntax check, uji provider live, dan verifikasi tampilan WhatsApp/TokoPanel belum dilakukan.
- **Privasi:** query string endpoint tidak ditampilkan karena bisa memuat token atau URL CDN bertanda tangan.


## 2026-10-30 — Memperbaiki fallback multi-sumber untuk short link TikTok
- **Permintaan/gejala:** tautan `https://vt.tiktok.com/ZSgnCJAud/` gagal pada varian TikWM, embed tidak dapat menemukan ID dari URL yang belum ter-resolve, dan yt-dlp menghasilkan metadata/durasi tidak valid.
- **Akar penyebab dari kode:** `getTikTokFallbackSourceUrl()` mempertahankan URL vt/vm secara langsung sebelum mempertimbangkan `res.videoId`; akibatnya fallback resmi embed dan yt-dlp tetap menerima short link ketika redirect TokoPanel gagal. Fungsi embed juga hanya mengekstrak ID dari URL.
- **Perubahan:** `plugins/downloader/tiktok.js` sekarang membangun permalink kanonis `/@username/video/{id}` dari ID aweme/video provider untuk short link, dan meneruskan ID provider langsung ke extractor embed sebagai fallback tambahan. Jalur sumber tetap berlapis: kandidat TikWM HD/standard, TikTok embed/CDN resmi, lalu yt-dlp; watermark hanya pilihan terakhir dan tetap harus HD.
- **Tes:** perubahan kode dicatat di main; pemeriksaan sintaks dan uji unduhan live TokoPanel belum diverifikasi pada saat commit.
- **Belum diverifikasi:** apakah provider TikWM mengembalikan ID valid untuk tautan ini, apakah TikTok mengizinkan embed/CDN dari IP TokoPanel, dan resolusi maksimum video sumber.
- **Pelajaran:** jangan mengandalkan redirect vt/vm saja; bila metadata provider punya aweme ID, bentuk URL kanonis untuk extractor lain. Beberapa jalur extractor bukan jaminan semua video tersedia HD.


## 2026-10-30 — Perbaikan SyntaxError downloader TikTok
- **Gejala:** TokoPanel gagal memuat `plugins/downloader/tiktok.js` dengan `SyntaxError: Unexpected token 'throw'`, sehingga handler TikTok tidak aktif walaupun proses bot dan plugin lain tetap berjalan.
- **Akar penyebab:** pada jalur akhir `prepareBestTikTokVideo`, pernyataan `throw new Error(...)` untuk kondisi semua varian gagal tertulis dua kali berurutan pada baris yang sama. Parser menemukan token `throw` kedua di luar struktur pernyataan yang valid.
- **Perubahan:** menghapus duplikasi pernyataan `throw` dan mempertahankan satu error yang merangkum kegagalan semua varian. Tidak mengubah strategi kualitas maupun fallback.
- **Tes:** perbaikan langsung dilakukan pada `main`; pemeriksaan sintaks GitHub Actions perlu dipastikan selesai setelah commit ini.
- **Belum diverifikasi:** pemuatan plugin dan unduhan TikTok live di TokoPanel setelah restart.
- **Pelajaran regresi:** sebelum commit perubahan downloader, jalankan parser/syntax check untuk file plugin yang diubah; jangan hanya memeriksa diff visual.


## 2026-10-30 — Prioritaskan sumber TikTok HD sebelum watermark fallback
- **Permintaan/gejala:** unduhan TikTok berakhir pada 576×576 walaupun log menunjukkan varian HD dan Standard gagal.
- **Akar penyebab:** `prepareBestTikTokVideo()` menerima `wmplay` sebagai kandidat biasa. File watermark 576×576 lolos validasi kontainer/frame dan langsung dikirim, sehingga jalur embed TikTok dan yt-dlp yang berada setelah loop tidak pernah dijalankan.
- **Perubahan:** `plugins/downloader/tiktok.js` sekarang menunda kandidat watermark hingga jalur embed dan yt-dlp selesai; sumber embed, kandidat provider, dan watermark fallback harus memiliki sisi terpanjang minimal 720 piksel. Watermark fallback hanya diterima jika benar-benar memenuhi ambang tersebut. Tidak ada upscaling palsu.
- **Tes:** perubahan langsung di `main`; pemeriksaan sintaks/unduhan live TokoPanel belum dijalankan setelah commit.
- **Belum diverifikasi:** apakah embed dan yt-dlp bisa mengambil stream HD dari tautan pengguna pada IP/lingkungan TokoPanel. Sebagian video memang hanya tersedia dalam resolusi di bawah 720p.
- **Pelajaran:** jangan menyamakan file MP4 valid dengan file HD; periksa dimensi aktual dan jangan membiarkan fallback berkualitas rendah memutus jalur ekstraksi yang lebih baik.


## 2026-10-30 — Kebijakan perubahan langsung ke main
- **Permintaan:** pengguna meminta setiap perbaikan langsung diterapkan pada branch `main`, dan panduan AI harus mengikuti aturan tersebut.
- **Perubahan:** `AGENTS.md` dan `AI_CONTEXT.md` menetapkan direct-to-main sebagai alur baku; branch fitur/PR hanya dibuat jika diminta eksplisit. Perubahan harus tetap diperiksa dan dites sebelum commit. Jika branch protection/izin menolak push langsung, berhenti dan laporkan hambatan—jangan otomatis beralih ke PR.
- **Tes:** pemeriksaan isi dokumentasi; tidak ada perubahan kode runtime.
- **Pelajaran:** direct-to-main tidak berarti melewati pemeriksaan, tes, pencatatan changelog, atau perlindungan data.


Catatan ini adalah riwayat teknis untuk AI/developer berikutnya. **Tambahkan entri baru di bagian paling atas setiap kali ada perubahan bermakna**, dalam PR/commit yang sama dengan perubahan kode. Jangan mengubah hasil tes masa lalu agar terlihat sukses. Catat juga pendekatan gagal dan pelajaran regresinya.

Format entri baru:

```md
## YYYY-MM-DD — Judul singkat
- **Permintaan/gejala:** apa yang dilaporkan.
- **Akar penyebab:** hasil pemeriksaan, atau tulis “belum dipastikan”.
- **Perubahan:** file/fungsi dan perilaku yang diubah.
- **Tes:** perintah/workflow yang benar-benar dijalankan dan hasilnya.
- **Belum diverifikasi:** perilaku live, API pihak ketiga, atau risiko yang tersisa.
- **Referensi:** commit/PR/issue.
- **Pelajaran regresi:** hal yang harus diperiksa sebelum mengulang perubahan serupa.
```

---

## 2026-10-30 — Perintah .clean untuk file sementara
- **Permintaan/gejala:** pengguna tidak mengetahui kuota disk TokoPanel dan meminta cara membersihkan file yang tidak penting melalui command .clean.
- **Akar penyebab:** belum ada perintah cleanup terarah; menghapus semua file server secara umum berisiko menghilangkan sesi WhatsApp, database, backup, konfigurasi, atau unduhan yang masih diperlukan.
- **Perubahan:** menambahkan plugins/owner/clean.js. Command owner-only menghapus hanya direktori bernama alvareth-tiktok-* pada os.tmpdir() dan ALVARETH_TIKTOK_TMPDIR yang lebih tua dari 2 jam, menghitung perkiraan ruang yang dibebaskan, dan mencoba melaporkan ruang filesystem yang tersedia. Folder yang lebih baru dilewati agar job aktif tidak terganggu.
- **Tes:** belum dijalankan pada runtime TokoPanel; workflow sintaks perlu memverifikasi plugin baru.
- **Belum diverifikasi:** kecocokan direktori sementara aktual di panel, ketersediaan statfs, dan jumlah ruang yang bisa dibebaskan pada server.
- **Pelajaran regresi:** cleanup otomatis harus berbasis allowlist nama/path yang dikelola bot dan umur file; jangan menghapus seluruh tmp, downloads, sesi, database, backup, atau file pengguna.
- **Referensi:** branch feat/owner-clean-command-main.
## 2026-10-30 — TikTok ENOSPC dan direktori sementara tidak konsisten
- **Gejala:** unduhan TikTok gagal dengan `ENOSPC`; pesan menghentikan fallback agar disk tidak makin penuh.
- **Akar penyebab yang ditemukan di kode:** `ALVARETH_TIKTOK_TMPDIR` hanya dipakai jalur video utama. Render postingan foto dan fallback yt-dlp masih menulis ke `os.tmpdir()` atau `./downloads`, sehingga konfigurasi direktori sementara tidak konsisten. ENOSPC sendiri tetap berarti volume/kuota/inode yang dipakai proses benar-benar kehabisan resource; kode tidak dapat menambah kapasitas hosting.
- **Perubahan:** `plugins/downloader/tiktok.js` memakai satu helper direktori sementara untuk unduhan video dan render foto, membersihkan direktori TikTok usang saat membuat job baru, serta memeriksa ruang kosong minimum 64 MB sebelum memulai. `lib/scrape/youtube.js` menerima opsi `outputRoot` agar fallback yt-dlp TikTok menulis ke direktori yang sama dan dibersihkan bersama job.
- **Tes:** pemeriksaan sintaks file JavaScript dan workflow GitHub perlu dijalankan pada PR; tes unduhan live membutuhkan hosting TokoPanel dan ruang disk aktual.
- **Belum diverifikasi:** ruang disk, inode, dan kuota filesystem TokoPanel; keberhasilan tautan TikTok yang dilaporkan pengguna.
- **Pelajaran regresi:** setiap jalur fallback/render harus menggunakan direktori sementara yang sama, dan error ENOSPC harus menghentikan retry. Memindahkan tmpdir hanya membantu bila direktori target berada pada volume/kuota berbeda yang memang memiliki ruang kosong.
- **Referensi:** PR perbaikan ENOSPC TikTok.
  
## 2026-10-30 — Fondasi pembacaan media dari pesan yang direply
- **Gejala:** perintah berbasis media reply (contoh pada tangkapan layar: `.toreal`) dapat menerima pesan balasan tetapi gagal membaca media sumber; plugin memakai variasi `m.quoted`, `q.msg`, `q.mediaMessage`, dan `q.download()`.
- **Akar masalah yang ditangani:** serialisasi protobuf Baileys pada handler dapat menormalisasi atau membuang struktur nested di `message`, termasuk `contextInfo.quotedMessage` dan wrapper media WhatsApp.
- **Perubahan:** setelah `smsg()` dijalankan, `handler.js` memulihkan payload `message` asli dari event Baileys sebelum plugin dieksekusi dan menyimpan referensi `rawMessage` non-enumerable. Dengan demikian semua plugin yang menggunakan serializer/helper bersama menerima payload asli yang sama tanpa patch perintah satu per satu.
- **Tes:** belum menjalankan bot di TokoPanel/WhatsApp; perlu menjalankan `npm test` atau pemeriksaan sintaks setara lalu uji media nyata.
- **Belum diverifikasi:** unduhan live untuk image, video, audio, dokumen, stiker, ephemeral/view-once, serta variasi pesan grup dan chat pribadi.
- **Pelajaran regresi:** jangan mengandalkan hasil `proto.WebMessageInfo.fromObject()` sebagai satu-satunya sumber nested media untuk plugin; pertahankan event payload asli dan uji fitur yang mengonsumsi media reply.

## 2026-10-29 — Standarisasi panduan AI
- **Permintaan:** membuat panduan yang ringkas untuk AI baru, memuat batasan yang jelas dan mewajibkan dokumentasi perubahan.
- **Perubahan:** menambahkan `AGENTS.md`, merapikan `AI_CONTEXT.md`, dan membuat changelog ini.
- **Tes:** memeriksa file panduan serta tautan/rujukan yang akan ditambahkan ke README; tidak ada tes runtime aplikasi untuk perubahan dokumentasi.
- **Pelajaran regresi:** panduan AI harus menjadi bagian dari PR yang sama dengan kode; jangan mengandalkan ingatan percakapan atau status yang tidak diverifikasi.

## 2026-10-29 — Pencarian TikTok ketika TikWM mengembalikan HTTP 403
- **Gejala:** `.ttsearch anime edit 4k` gagal; TikWM GET dan POST sama-sama mengembalikan HTTP 403.
- **Akar penyebab:** jalur pencarian bergantung pada penyedia API yang ditolak; mengulang metode atau variasi kueri ke penyedia yang sama tidak menghilangkan pemblokiran.
- **Perubahan:** PR #13 menambahkan fallback hasil pencarian Bing dan Google, menormalisasi tautan video TikTok, menghentikan pengulangan TikWM setelah 403, dan menambah modul scraper ke pemeriksaan sintaks.
- **Tes:** GitHub Actions “JavaScript syntax checks” untuk commit PR #13 selesai dengan status `success`.
- **Belum diverifikasi:** hasil pencarian live dari jaringan TokoPanel dan keberhasilan pengiriman video di WhatsApp.
- **Referensi:** https://github.com/lightevil96-svg/Alvareth-Bot/pull/13
- **Pelajaran regresi:** HTTP 403 adalah kegagalan penyedia, bukan “hasil kosong”. Mesin pencari mungkin tidak mengindeks hasil yang dicari dan fallback eksternal tetap best-effort.

## 2026-10-29 — Updater: diagnosis dan retry jaringan
- **Gejala:** perintah `.update` berhenti dengan `fetch failed`.
- **Akar penyebab:** pesan tersebut menunjukkan kegagalan request jaringan; penyebab spesifik harus dibaca dari rantai error, bukan ditebak.
- **Perubahan:** PR #11 menambahkan retry terbatas untuk kegagalan jaringan/status server sementara dan detail penyebab error pada laporan.
- **Tes:** perubahan terintegrasi ke `main`; konektivitas dari TokoPanel tidak dapat diuji lewat pemeriksaan kode saja.
- **Belum diverifikasi:** pembaruan sukses di hosting pengguna.
- **Referensi:** https://github.com/lightevil96-svg/Alvareth-Bot/commit/d6476b268dcc1c7fe6ad3418cd901c3903469560
- **Pelajaran regresi:** jangan mengulang tanpa batas; pertahankan pemeriksaan perubahan lokal dan jalur aman updater.

## 2026-10-29 — Resolusi unduhan YouTube
- **Gejala:** pengguna memilih kualitas tertinggi, tetapi video yang diterima hanya 360p.
- **Perubahan:** PR #10 mengutamakan yt-dlp untuk target kualitas terbaik, memperhitungkan FPS saat pemilihan format, dan melaporkan resolusi/FPS berkas hasil.
- **Tes:** perubahan terintegrasi ke `main`; kualitas unduhan harus diverifikasi dari hasil berkas langsung karena ketersediaan format berbeda antarvideo.
- **Referensi:** https://github.com/lightevil96-svg/Alvareth-Bot/commit/3c15ec6a53029d7f5353be96114408c00edffa85
- **Pelajaran regresi:** jangan menampilkan kualitas yang diminta sebagai kualitas yang benar-benar didapat; inspeksi media hasil.

## 2026-10-22 — Fallback helper pesan lintas plugin
- **Gejala:** sebagian plugin gagal dengan `m.reply is not a function` atau `m.react is not a function`.
- **Perubahan:** fallback metode reply/react ditempatkan pada layer normalisasi pesan bersama di `handler.js`, bukan hanya ditambahkan ke satu plugin.
- **Tes:** kode pernah dicatat sebagai belum diverifikasi di sesi WhatsApp live; uji `.play`, `.tt` dan plugin lain yang memakai helper bila menyentuh layer ini.
- **Referensi:** commit `7d66ebf` (lihat riwayat Git untuk SHA lengkap).
- **Pelajaran regresi:** saat helper serializer hilang, cek `handler.js` dan `lib/simple.js` sebelum membuat perbaikan berulang di banyak plugin.

## 2026-10-22 — Perintah menu dan normalisasi pesan
- **Gejala:** `.menu` tidak selalu terdeteksi setelah serialisasi pesan.
- **Perubahan:** normalisasi routing, teks pesan dan fallback properti pesan ditambahkan pada handler.
- **Verifikasi yang tercatat:** pengguna mengonfirmasi `.menu` bekerja setelah perbaikan.
- **Pelajaran regresi:** jangan menghapus fallback normalisasi tanpa tes regresi untuk pesan teks, self-chat, dan respons tombol/list.


## 2026-11-04 — Video Studio API key bootstrap and Pterodactyl port
- **Gejala:** Pterodactyl Startup page tidak menyediakan `PORT` atau `CUSTOM_ENVIRONMENT_VARIABLES`, sehingga setup awal Video Studio tidak dapat mengikuti instruksi environment manual.
- **Perubahan:** HTTP server mendukung `SERVER_PORT` bawaan Pterodactyl. API Video Studio membuat API key acak 256-bit dan menyimpannya di direktori data persisten dengan izin file 0600 bila environment key tidak diatur.
- **Keamanan:** key tidak ditanam di source/repository; pengguna mengambil key dari file runtime privat dan memasukkannya ke session browser. CORS tetap membatasi origin LightJurnal.
- **Belum diverifikasi:** instalasi dependency Remotion, reverse proxy/HTTPS publik, autentikasi live, dan render MP4 di server Pterodactyl.

## 2026-11-06 — Remotion local service autostart and truthful readiness

- **Symptom:** `.remotion services` showed the default Ollama planner and VoxCPM2 endpoint as unconfigured, then reported both loopback services unreachable. The planner/voice adapters only attempted HTTP requests; they did not start an installed local service.
- **Root causes:** readiness treated explicit environment variables as the only configuration source even though the code already had defaults; no guarded process launcher existed for `ollama serve` or the VoxCPM2 Python adapter.
- **Fix:** add `video-studio/local-services.js` with loopback-only health probes, guarded autostart, duplicate-process protection, Ollama model-tag verification, VoxCPM2 model/venv checks, CUDA detection and actionable setup messages. Planner and voice-over start their default local service on demand. `.remotion services` now attempts startup and distinguishes unreachable service, missing model, missing virtualenv, and model loading.
- **Safety:** autostart does not install packages, download weights, pull models, expose ports, or use hosted AI. It is enabled by default only when the local executable, Python environment and model files already exist; set `VIDEO_STUDIO_LOCAL_SERVICES_AUTOSTART=false` to disable it. VoxCPM2 remains bound to 127.0.0.1.
- **Tests:** added pure config/health contract tests and updated readiness expectations; Video Studio CI syntax and regression workflow must be checked after this commit.
- **Not verified:** this GitHub environment cannot inspect or provision the user's VPS. Ollama binary/model, VoxCPM2 venv/weights, CUDA compatibility, service startup, WhatsApp delivery and a real narrated MP4 must still be verified on the target Linux server.
- **Follow-up CI fix:** the first regression run caught an undeclared Ollama base URL in the planner preflight and a transport error that lost the VoxCPM2 context. The planner now derives the endpoint and base from the same configured loopback URL; voice transport failures now report a VoxCPM2-specific diagnostic. The next CI run is the acceptance check.
- **Service process isolation:** Ollama and VoxCPM2 children now receive an explicit allowlist of runtime/model/CUDA variables instead of inheriting the bot's complete environment. WhatsApp numbers, API keys and unrelated bot credentials are not passed to local model processes. A regression test asserts this boundary.
- **2026-11-06 — Rootless Pterodactyl bootstrap:** added `scripts/setup-video-studio-linux.sh`. It installs the official Ollama archive and Astral uv under `$HOME/.local`, provisions Python 3.11 without Debian `ensurepip`, installs the pinned VoxCPM2 adapter dependencies, optionally downloads model weights, and reports CPU/GPU capability. The bot now auto-detects `~/.local/bin/ollama` and supports `VIDEO_STUDIO_OLLAMA_BIN`. CI checks shell syntax and config coverage. No apt/sudo/systemd required; actual hardware/runtime inference remains server-side verification.
- **Hardware guard:** rootless bootstrap no longer silently installs CPU-only PyTorch when the container has no visible NVIDIA GPU. VoxCPM2 upstream specifies CUDA 12.0+; CPU-only now requires explicit `VOXCPM_ALLOW_CPU=1` opt-in and is marked experimental. CUDA PyTorch selection uses uv's automatic backend unless a matching index URL is supplied.
- **Documentation precision:** clarified that VoxCPM2 CPU inference is supported but may be slow; CUDA 12.0+ applies to the NVIDIA acceleration path. The bootstrap still requires explicit CPU opt-in when no NVIDIA GPU is visible to avoid silently provisioning a potentially impractical CPU workload.
- **2026-11-06 — Bootstrap correction from live Pterodactyl logs:** replaced the obsolete Ollama `.tgz` URL with the current official `.tar.zst` package and added a safe streaming extractor using the isolated Python `zstandard` module. Replaced the uv `/bin/sh` installer with a standalone musl binary downloaded from the pinned GitHub Release, avoiding restricted-shell parsing. Added `--allow-cpu` so the user does not need an environment-variable prefix in the panel console; added RAM/cgroup diagnostics. CI syntax-checks the extractor and bootstrap.
- **Extractor hardening:** allow a harmless root directory entry in the official Ollama tar archive and validate symlink targets by their resolved destination, so safe relative links are supported while path traversal remains blocked. Removed obsolete Pterodactyl manual `python3 -m venv` instructions from service documentation.

- **2026-11-06 — Alvareth production-flow correction:** stopped the WhatsApp command from preloading Ollama and VoxCPM2 together. Ollama now starts only for planning; VoxCPM2 starts only when narration is needed, with a configurable cold-start wait. `.remotion services` is status-only to avoid loading large models just to inspect readiness. Added measured-duration fallback captions when the optional local aligner is absent. Corrected the API health contract to identify local VoxCPM2 and removed stale ElevenLabs/Pexels readiness checks. Planner instructions now match the implemented local ComfyUI + Remotion pipeline.
