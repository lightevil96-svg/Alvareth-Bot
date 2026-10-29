# Instructions for AI Agents — Alvareth Bot

**Read these files before editing code:**
1. `AI_CONTEXT.md` — architecture, constraints, recurring pitfalls.
2. `README.md` — setup and runtime behavior.
3. `docs/AI_CHANGELOG.md` — prior fixes, test status and mistakes to avoid.

## Rules for every task

- Inspect current source and call sites before editing. Treat documentation as context, not proof that code still behaves that way.
- Work on a dedicated branch and open a focused PR against `main`. Do not force-push, reset destructively, or silently overwrite user data.
- Fix root causes. When behavior is shared by plugins, inspect common layers such as `handler.js` and `lib/simple.js` before adding one-off workarounds.
- Preserve existing features, command formats, permission checks, message quoting, branding and persistent data unless the request explicitly authorizes a change.
- Never commit or reveal secrets, `.env`, WhatsApp session data, runtime databases, backups, or logs containing credentials.
- Avoid infinite retries. Validate API status and payload shape; distinguish “no results” from provider/network errors and use an independent fallback when appropriate.
- Run `npm test` and relevant targeted tests. Check GitHub Actions and report exactly what was and was not tested. Syntax checks alone do not prove a live WhatsApp/API flow works.
- **Every meaningful change must update `docs/AI_CHANGELOG.md` in the same PR.** Include date, symptom/request, root cause, files changed, fix, tests/results and any unverified behavior. Also add a one-line summary under “Pembaruan terbaru” in `AI_CONTEXT.md`. Record failed approaches and regression lessons so future agents do not repeat them.
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
