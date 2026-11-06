> Current runtime (2026-11-06): storyboard JSON is authored manually by any external AI model selected by the operator; no LLM planner runs in the bot. The bot parses, normalizes, compiles, validates, and renders JSON. Do not reintroduce a planner or LLM call into the bot unless explicitly requested. See [../prompt-remotion.md](../prompt-remotion.md) for the authoritative input contract and [../docs/REMOTION_WHATSAPP_LINUX.md](../docs/REMOTION_WHATSAPP_LINUX.md) for setup. Sections describing in-bot planning below are historical design guidance, not current runtime guarantees. Voice-over now defaults to Edge TTS online with word-boundary timing; VoxCPM2 is optional.

# Video Studio — AI Prompt Understanding & Remotion Planning Contract

> **Purpose:** This document tells an AI coding agent how to design and implement the prompt-understanding layer for LightJurnal Video Studio. Read this before changing Video Studio prompt, storyboard, scene schema, or Remotion rendering code.
>
>
> **Current implementation:** `video-studio/api.js`, `validate.js`, `queue.js`, `renderer.js`, `audio-assets.js`, and `remotion/Composition.jsx`. The current UI is in the separate repository `lightevil96-svg/lightjurnal-site`, file `video-studio.js`.

## 1. Product goal

A user should be able to describe a video in ordinary language (Indonesian or English). The AI must understand the intended message and audience, turn the request into a coherent production plan, then produce a validated structured project that the Remotion renderer can execute.

Do not treat the user's prompt as a request to merely split text into slides. The output is a short-form video production plan: narrative, scene purpose, visual direction, motion, pacing, transitions, sound design, and (when implemented) voice-over.

The AI is a **planner and translator**, not the renderer. Remotion performs deterministic rendering from a validated project. Keep language understanding outside the Remotion composition; never ask Remotion to interpret prose at render time.

## 2. Required pipeline

Implement the workflow as explicit stages with typed outputs. Each stage should be inspectable and testable.

1. **Prompt intake**
   - Accept raw prompt, requested language, platform/aspect ratio, target duration, optional reference assets, and user preferences.
   - Preserve the user's core intent. Do not silently change topic, claims, target audience, brand names, product appearance, or CTA.
   - If essential information is missing, use sensible defaults and disclose them in the plan. Ask a question only when proceeding would materially change the requested result.

2. **Intent extraction**
   - Extract: topic, communication goal, audience, audience knowledge level, tone, style, platform, aspect ratio, duration, language, CTA, factual claims, required entities, prohibited content, and reference assets.
   - Distinguish explicit user instructions from AI assumptions. Keep assumptions in a separate array.
   - Detect likely video category: educational, explainer, product ad, story, announcement, tutorial, trading/finance explainer, or other. Category selects a planning strategy, not a hard-coded visual template.

3. **Creative brief**
   - Write one-sentence core message.
   - Define hook, narrative arc, key takeaways, emotional progression, and ending/CTA.
   - For educational/factual content, separate verified facts from creative illustration. Do not invent statistics, quotations, medical claims, financial promises, or citations. Mark claims that need sources as `needs_research`; do not present them as verified.

4. **Storyboard**
   - Divide the requested duration into scenes. Each scene must have a distinct narrative purpose; avoid repetitive title cards.
   - For each scene specify: narration/voice-over text (if voice-over is enabled), on-screen text, visual subject, composition, action, camera movement, motion timing, transition in/out, scene duration, and sound cue.
   - Hook quickly. Give each scene enough time to read. Keep on-screen text concise and avoid putting the entire narration on screen.
   - Scene durations must be chosen dynamically from narration length, reading time, visual action, and emotional beats. When the user requests a total duration, distribute time naturally across scenes. Current server safeguards: maximum 20 seconds per scene, 60 scenes, and 300 seconds total.

5. **Audio direction**
   - Select one background-music mood based on the story (currently supported: `cinematic`, `upbeat`, `calm`, `none`).
   - Define sound effects as timed cues tied to visible events/transitions, not random sounds on every scene.
   - Specify voice-over separately from music and SFX. Never claim TTS is implemented until an actual TTS provider, generated audio asset, timing alignment, and render integration exist.
   - Mix guidance: voice-over should remain intelligible; music should sit below narration; SFX should be brief and not mask speech. Include fade-in/fade-out and ducking instructions in the plan, even if the current renderer cannot yet implement all of them.
   - Current generated music/SFX assets are original procedural WAV files produced by `audio-assets.js`; they are not semantic, per-prompt music composition. Current composition loops one of the three music moods and plays a repeating scene SFX selection. Do not describe this as fully adaptive sound design.

6. **Remotion plan generation**
   - Translate the storyboard into a JSON project that conforms to the server schema. Never emit arbitrary JSX, JavaScript, shell commands, URLs, or executable code from the LLM.
   - The model must select from an allowlisted set of Remotion scene types, motion presets, transition presets, and sound cue IDs. The renderer maps those IDs to trusted components/assets.
   - If a requested visual cannot be represented by the available renderer, mark it as unsupported or as a future asset requirement. Do not pretend text-only graphics are 3D footage or stock video.
   - Build a deterministic compiler/adapter from AI plan JSON to the validated render payload. Keep provider-specific response formats out of `Composition.jsx`.

7. **Validation and preview**
   - Validate JSON schema, allowed enums, text length, scene count/durations, asset paths, audio IDs, aspect ratio, FPS, total duration, and resource limits before queueing.
   - Reject unknown component names, remote asset URLs, arbitrary file paths, scripts, and unsupported properties.
   - Return structured validation errors with JSON paths so the UI can show exactly what needs correction.
   - Show the generated brief/storyboard for user review before rendering. Permit scene-level edits and regeneration without rewriting unaffected scenes.

8. **Render and feedback**
   - Queue only a validated, normalized project.
   - Store the original prompt, normalized intent, storyboard, compiled project, and render metadata as separate versioned records (never store API secrets in project data).
   - On failure, report the failing stage and actionable details. Do not silently rewrite the user's prompt.
   - A render result should be checked for expected duration, dimensions, video stream, audio stream when audio was requested, and non-zero output size.

## 3. Structured data contract

Use JSON-only output from the prompt-planning model. Validate it with a strict schema (prefer a maintained schema validator such as Ajv if dependency policy permits). Suggested planning envelope:

```json
{
  "schemaVersion": 1,
  "sourcePrompt": "Buat video edukasi 30 detik tentang bahaya kurang tidur...",
  "intent": {
    "language": "id",
    "category": "educational",
    "topic": "bahaya kurang tidur",
    "goal": "menjelaskan dampak dan memberi langkah pencegahan",
    "audience": "remaja",
    "tone": ["engaging", "credible"],
    "style": ["cinematic", "3d_illustration"],
    "platform": "reels",
    "aspectRatio": "9:16",
    "targetDurationSeconds": 30,
    "cta": "mulai perbaiki pola tidur",
    "assumptions": []
  },
  "creativeBrief": {
    "coreMessage": "Tidur cukup membantu tubuh dan otak bekerja optimal.",
    "hook": "Pernah sulit fokus setelah begadang?",
    "narrativeArc": ["hook", "problem", "explanation", "solution", "cta"],
    "claims": [
      { "text": "Contoh klaim faktual", "status": "needs_research", "sourceRefs": [] }
    ]
  },
  "audio": {
    "musicMood": "calm",
    "musicLevel": 0.18,
    "voiceOver": { "enabled": false, "text": "", "voice": null },
    "mixNotes": "Musik lembut; sisakan ruang untuk narasi.",
    "soundCues": [
      { "atScene": 0, "cue": "whoosh", "purpose": "opening transition" }
    ]
  },
  "scenes": [
    {
      "id": "scene-01",
      "purpose": "hook",
      "durationSeconds": 5,
      "visual": {
        "type": "typography",
        "subject": "jam digital menunjukkan pukul 02.00",
        "description": "Latar gelap, jam menjadi fokus utama.",
        "composition": "center",
        "camera": "slow_push_in"
      },
      "motion": { "preset": "fade_up", "intensity": 0.7, "start": 0, "duration": 18 },
      "onScreenText": "Masih terjaga pukul 02.00?",
      "voiceOverText": "Masih sering begadang sampai larut?",
      "transitionIn": "fade",
      "transitionOut": "whoosh",
      "soundCue": "whoosh",
      "assetRequirements": []
    }
  ],
  "render": {
    "fps": 30,
    "aspectRatio": "9:16",
    "musicStyle": "calm",
    "soundEffects": true
  },
  "unsupportedRequests": []
}
```

This is a **planning envelope**, not the current `validateVideoProject()` input schema. Build an explicit compiler that converts this envelope to the current render payload. Do not pass this envelope directly to the current renderer.

## 4. Current Remotion compatibility boundary

The current server validator accepts:
- `title`, `mode`, `ratio` (`9:16`, `16:9`, `1:1`), `fps` (24/25/30)
- `scenes[]` with text, variable duration (1–20 sec), background/accent colors, layout, motif, motion, transition, narration metadata, and allowlisted sound cue
- `musicStyle` (`cinematic`, `upbeat`, `calm`, `none`) and `soundEffects` boolean
- Total maximum 60 scenes / 300 seconds.

Current Remotion composition supports animated typography, entrance motion, scene sequences, procedural background music, and a limited repeating set of SFX. It does **not** yet support AI-generated visuals, uploaded images/video, arbitrary camera/3D animation, per-scene custom audio cues, generated voice-over, precise audio ducking, or an editable keyframe timeline.

Therefore, in the first implementation, the compiler must degrade gracefully:
- Map supported visual descriptions to typography + background + supported motion.
- Preserve full storyboard descriptions in project metadata for future renderers.
- Put unsupported requirements in `unsupportedRequests` and explain them in the UI.
- Never silently claim unsupported features were rendered.

## 5. Prompt interpretation rules

- Interpret the entire prompt, not just keywords. Resolve references such as "buat lebih dramatis", "seperti scene sebelumnya", and "jangan ubah produk" using the current project context.
- Respect negative instructions (no music, no text overlays, no extra people/hands, keep exact product/logo, no camera shake, etc.) as hard constraints.
- Preserve exact user-provided wording when requested; otherwise improve clarity without changing meaning.
- Infer a coherent visual style, but keep it consistent across scenes: palette, typography, lighting, camera language, motion tempo, and sound identity.
- Avoid over-editing: every animation must have a narrative purpose. Prefer a few intentional motions over constant movement.
- Match audio to the content and emotion. Do not choose upbeat music for a serious warning or loud SFX under dialogue.
- For product ads, preserve product identity and exact visible attributes; do not invent certifications, discounts, price, or performance claims.
- For trading/finance videos, do not invent profit claims, performance data, or guarantees. Distinguish educational examples from real results.
- Keep captions readable on mobile and within safe margins for the target platform.
- Avoid copyrighted song requests; use licensed, user-provided, public-domain, or original generated audio only.

## 6. Recommended module boundaries

Suggested future modules (names are recommendations, not existing files):
- `video-studio/prompt/parse.js`: prompt intake and provider-neutral orchestration.
- `video-studio/prompt/providers/*.js`: isolated LLM provider adapters.
- `video-studio/prompt/schema.js`: strict JSON schema for the planning envelope.
- `video-studio/prompt/normalize.js`: normalize intent, defaults, and assumptions.
- `video-studio/prompt/storyboard.js`: scene planning and duration allocation.
- `video-studio/prompt/compile-remotion.js`: safe mapping to the current renderer schema.
- `video-studio/prompt/validate-plan.js`: validation of AI planning output.
- `video-studio/prompt/revision.js`: apply revision instructions to selected scenes while preserving locked content.

Do not add these files or an LLM dependency merely because this document names them. First inspect existing provider integrations, configuration conventions, secrets handling, tests, and deployment constraints. Keep the AI provider replaceable and credentials in environment variables only.

## 7. Acceptance criteria

A prompt-engine implementation is not complete until tests demonstrate:
1. Indonesian and English prompts produce valid, stable structured plans.
2. Different intents (education, ad, explainer, story) produce meaningfully different narrative structures.
3. Negative constraints are preserved and tested.
4. Scene durations sum to the requested duration and stay within server limits.
5. Every generated component, motion, transition, and audio cue is allowlisted.
6. Unsupported visual/audio requests are surfaced honestly.
7. The compiler output passes the existing server validator.
8. A user can revise one scene without changing locked/unchanged scenes.
9. Prompt injection inside user text or reference content cannot override system constraints or cause code execution.
10. A real render test verifies duration, resolution, and audio tracks where requested.

## 8. Instructions for the next AI coding agent

When asked to implement this feature:
1. Read this file completely, then `AI_CONTEXT.md`, `AGENTS.md`, `video-studio/validate.js`, `video-studio/api.js`, `video-studio/renderer.js`, `video-studio/audio-assets.js`, `video-studio/remotion/Composition.jsx`, the queue, and the LightJurnal UI repository's `video-studio.js`.
2. Inspect existing AI/provider integrations and environment-variable conventions before choosing a model/provider. Do not hard-code a provider or assume an API key exists.
3. Implement a provider-neutral prompt planner, strict schema validation, storyboard preview, and safe compiler as separate stages.
4. Keep current manual project creation and API compatibility working.
5. Add unit tests for parsing, normalization, constraints, compilation, and regression cases. Add a small deterministic fixture prompt set in Indonesian and English.
6. Update this document, `AI_CONTEXT.md`, and `docs/AI_CHANGELOG.md` as implementation progresses. Clearly mark implemented vs planned capabilities.
7. Do not claim prompt understanding, voice-over, or adaptive sound design is implemented until the corresponding end-to-end path is verified.

## 9. Current status summary

| Capability | Status |
| --- | --- |
| Manual text-scene project creation | Implemented |
| Remotion typography animation | Implemented |
| Procedural background music moods | Implemented in code; runtime render not yet verified |
| Scene sound effects | Implemented in code; runtime render not yet verified |
| External-AI-authored storyboard JSON intake | Implemented; no LLM call is made by the bot |
| AI storyboard generation inside the bot | Not implemented by design; the AI model is chosen and used separately by the operator |
| JSON storyboard to safe Remotion project compiler | Implemented |
| Local VoxCPM2 voice-over / TTS | Implemented in code; runtime model quality must be tested on the target host |
| Uploaded image/video assets | Not implemented |
| Preview/edit storyboard before render | Not implemented |


## 10. Current external-AI-authored JSON workflow (2026-11-06)

The WhatsApp owner workflow is now:

1. The operator gives the user's brief to any external AI model and asks it to follow the repository-root `prompt-remotion.md`.
2. The external AI model returns exactly one JSON object with `schemaVersion: 1`, `sourcePrompt`, and `scenes[]`.
3. The owner pastes the JSON using `.remotion generate` or `.remotion <JSON>`.
4. `video-studio/prompt/storyboard.js` parses and normalizes the supplied JSON. It rejects plain-language briefs and never calls Ollama, an AI API, or another inference service.
5. `video-studio/prompt/compile.js` maps the normalized plan to the allowlisted Remotion payload and calls `validateVideoProject()`.
6. The single-worker queue prepares local VoxCPM2 narration when configured, optional reviewed ComfyUI footage/music, and renders the deterministic Remotion composition.
7. The completed MP4 is verified and returned to WhatsApp.

The current production path is the owner-only WhatsApp plugin. No public storyboard-planning API is part of this main-branch workflow.

The current renderer remains a deterministic motion-graphics composition. True generated character footage requires an enabled, reviewed ComfyUI workflow; character identity is not guaranteed. Word-level subtitle timing uses local alignment when available; otherwise runtime estimates caption timing from measured WAV duration and syllable/punctuation weights. See `prompt-remotion.md` for all exact field limits and allowed enums.
