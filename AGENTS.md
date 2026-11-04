# Instructions for AI Agents — Alvareth Bot

**Read these files before editing code:**
1. `AI_CONTEXT.md` — architecture, constraints, recurring pitfalls.
2. `README.md` — setup and runtime behavior.
3. `docs/AI_CHANGELOG.md` — prior fixes, test status and mistakes to avoid.

## Rules for every task

- Inspect current source and call sites before editing. Treat documentation as context, not proof that code still behaves that way.
- **Default workflow for this repository: make requested fixes directly on `main`**. Do not create a feature branch or PR unless the user explicitly asks for one. Confirm the current `main` state before writing, preserve unrelated changes, and commit each coherent fix directly to `main`.
- Fix root causes. When behavior is shared by plugins, inspect common layers such as `handler.js` and `lib/simple.js` before adding one-off workarounds.
- For quoted media in any plugin, use `getQuotedMediaInfo(m)` and `downloadQuotedMedia(m, conn)` from `lib/simple.js` (or improve those shared helpers). Do not classify replies from `m.quoted.mimetype` alone; check the normalized media message type and preserve the raw Baileys payload/wrapper context.
- Preserve existing features, command formats, permission checks, message quoting, branding and persistent data unless the request explicitly authorizes a change.
- Never commit or reveal secrets, `.env`, WhatsApp session data, runtime databases, backups, or logs containing credentials.
- Avoid infinite retries. Validate API status and payload shape; distinguish “no results” from provider/network errors and use an independent fallback when appropriate.
- Run `npm test` and relevant targeted tests. Check GitHub Actions and report exactly what was and was not tested. Syntax checks alone do not prove a live WhatsApp/API flow works.
- **Every meaningful change must update `docs/AI_CHANGELOG.md` in the same direct-to-`main` change sequence.** Include date, symptom/request, root cause, files changed, fix, tests/results and any unverified behavior. Also add a one-line summary under “Pembaruan terbaru” in `AI_CONTEXT.md`. Record failed approaches and regression lessons so future agents do not repeat them.
- Update the architecture/gotcha section in `AI_CONTEXT.md` when a lasting behavior, safety constraint, or recurring pitfall changes. Keep that file concise; detailed history belongs in the changelog.
- Before finishing, review the diff for unrelated changes, secrets, deletions, and data loss risk. Do not claim a fix is complete until the relevant checks have actually run.

## Safe workflow

1. Read the three files above and inspect branch/status, relevant source, dependencies and tests.
2. State the likely cause briefly, then implement the smallest durable fix that preserves compatibility.
3. Add/update regression tests where practical.
4. Update both AI documentation files in the same branch/PR.
5. Run checks; inspect their results.
6. Open a PR with summary, root cause, test results, and remaining limitations.
7. Report links and verification honestly. Do not say a VPS was deployed unless a configured deployment actually ran.


## Remotion Agent Skills & prompt-only product rule

- The Remotion renderer is pinned to version 4.0.540. Install the complete official Remotion Agent Skills pack locally with npm run skills:remotion; it installs the 13 skills from remotion-dev/skills into the project agent-skill directory.
- Always load remotion-best-practices as the router. For composition work, load remotion-markup; additionally load remotion-captions, remotion-multimedia, remotion-render, remotion-studio, remotion-saas, remotion-maps, remotion-interactivity, remotion-license, or remotion-upgrade when the task calls for them.
- LightJurnal Video Studio is prompt-only for creative decisions. Do not add user-facing controls for scene duration, background color, palette, FPS, aspect ratio, music mood, transitions, or individual scene construction. Infer these from the natural-language prompt and content. A generated storyboard may be shown as a read-only explanation of the AI's decisions.
- The current renderer creates deterministic motion graphics with typography, layouts, geometric motifs, procedural music and selected sound cues. Do not describe it as stock footage, photorealistic video generation, 3D footage, or spoken voice-over unless those end-to-end capabilities are implemented and tested.
- Keep all model credentials in server environment variables. Never send them to LightJurnal or store them in project/job metadata.
