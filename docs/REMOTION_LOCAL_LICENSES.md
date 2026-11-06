# Local media dependency and skill audit — 2026-11-06

| Component | Evidence / license | Decision |
| --- | --- | --- |
| VoxCPM2 code | OpenBMB/VoxCPM, pinned 4b8dd4440d33396b3f429201f8af0529b4d2c601, LICENSE Apache-2.0 | Python adapter uses verified from_pretrained/generate and upstream StableTSAligner |
| VoxCPM2 weights | https://huggingface.co/openbmb/VoxCPM2/raw/main/README.md — Apache-2.0; Indonesian listed | Operator downloads a local snapshot; record revision before deployment |
| stable-ts | https://github.com/jianfch/stable-ts/blob/main/LICENSE — MIT | Optional, pre-downloaded Whisper checkpoint; no implicit online model loading |
| Whisper | https://github.com/openai/whisper/blob/main/LICENSE — MIT | Optional local alignment model, not hosted transcription |
| Remotion 4.0.540 | https://www.remotion.dev/docs/license — custom license | Preserved user-selected engine. It is NOT universally free/open-source; eligibility depends on actual use/team. No paid hosted rendering integrated |
| FFmpeg | https://ffmpeg.org/legal.html — LGPL/GPL depending on build | Use system FFmpeg; inspect distribution/build license, especially H.264/x264 |
| React / ReactDOM | Package LICENSE — MIT | Existing pinned 19.2.0 preserved |
| Procedural SFX | Original repository code, GPL-3.0-or-later | No external recordings/sample packs downloaded |
| ComfyUI/models | Each graph/custom node/model has separate terms | Disabled without operator-reviewed exact workflow SHA-256; no model installed or license inferred |
| remotion-dev/skills | Official active project; inspected current package 4.0.541, 95 commits on retrieved page; root did not expose a standalone license | Existing 4.0.540 pack preserved; no blind refresh or assertion that pack is MIT. Several upstream examples suggest hosted assets; project-local policy overrides them |
| gitethanwoo/video-editing | MIT, 166eed9b1f391af5201a37057924593bf8f413d4 (2026-07-28); small 4-commit project | Selected 3 readable editorial references, preserved LICENSE, installed local adapter skill; no scripts executed/imported |

Review outcome: editorial principles add output QA and clear source/output/scene timing. Upstream analysis includes optional Gemini and Apple-specific transcription; these are excluded. find-broll duplicates optional source search and introduces external sourcing, so it is not installed. No secret collection, shell execution or hidden instructions found in the three selected reference texts. This is a scoped review, not a security certification of entire upstream repositories.

ChatGPT is used manually outside the bot to author the storyboard JSON; there is no ChatGPT API call, Ollama process, model download, or LLM runtime dependency in the bot. Skills guide coding agents and do not guarantee professional quality. Runtime behavior must be implemented in schema/compiler/renderer and verified in output.
