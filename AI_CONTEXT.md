# AI CONTEXT — Alvareth Bot

> Purpose: handoff notes for an AI or developer continuing maintenance of this repository.
> Repository: https://github.com/lightevil96-svg/Alvareth-Bot
> Main branch: `main`
> Last reviewed: 2026-10-23
>
> This document summarizes the state visible in the repository. It is not a guarantee that every feature works at runtime. Always inspect the current code and run checks before claiming a fix is verified.

## 1. Project identity and user priorities

- Project name shown to users: **Alvareth Bot**.
- Package name: `alvareth-bot`.
- Owner display name is configured by `OWNER_NAME` in `.env`; default/sample is `Light V`. Do not change it unless explicitly requested.
- WhatsApp bot built with Node.js ES modules, a Baileys fork (`baileys` resolves to `npm:@itsliaaa/baileys@0.3.18-final`), and a large plugin collection.
- Main runtime files: `index.js`, `main.js`, `handler.js`, `config.js`.
- User prefers comprehensive, direct fixes rather than tiny iterative edits. Communicate in Indonesian when talking to the user. Do not claim tests passed unless they were actually run.
- Preserve the existing plugin collection and working bot behavior. Avoid replacing or simplifying the SC wholesale.

## 2. Runtime and startup

- Package uses `"type": "module"`.
- Current `npm start` script: `node scripts/start-with-update.js`.
- `scripts/start-with-update.js` checks GitHub before launching `index.js`:
  1. Unless `AUTO_UPDATE_ENABLED=false`, it checks that the working directory is a Git checkout.
  2. It runs `git status --porcelain --untracked-files=no`; if tracked local modifications exist, it skips updating and starts the locally available version.
  3. Fetches `origin/${AUTO_UPDATE_BRANCH || 'main'}`.
  4. Counts commits ahead of the local HEAD and logs the changed file names.
  5. Uses `git merge --ff-only origin/<branch>`; no forced reset or hard reset.
  6. If `package.json` or `package-lock.json` changed, runs `npm install`.
  7. Starts `node index.js` as a child process with inherited terminal IO.
- If GitHub is unavailable or update fails, it logs the failure and attempts to start the local version. Review this fallback behavior if the user requests stricter fail-closed behavior.
- Startup updater needs a Git clone with a remote named `origin`, correct branch, network access, and Git installed. ZIP-only installations cannot auto-update.
- `index.js` starts a cluster worker that runs `main.js`. It handles worker messages such as `reset` and `uptime`.
- `main.js` creates the WhatsApp socket using Baileys, QR-based multi-device login, session directory `sessions/`, and lowdb database file `database.json`.
- `main.js` has reconnect logic, event handlers, and plugin loading. Inspect relevant code before changing socket lifecycle.
- Do not add a second competing auto-update loop without deciding whether startup-only update or background update is intended. `lib/auto-update.js` remains in the repository as a separate PM2/background updater module, but current `index.js` no longer imports it. It is not used by the current `npm start` startup path.

## 3. Important files and folders

- `index.js`: cluster supervisor and terminal message handling.
- `main.js`: WhatsApp socket/session, database initialization, reconnect behavior, plugin loading, event lifecycle.
- `handler.js`: incoming message processing, message normalization, command routing, plugin invocation, group/member handling.
- `config.js`: global bot metadata, labels, owner info, API configuration, menu styling, watermark, channel links.
- `plugins/`: extensive feature/plugin set. Do not replace the directory with a small sample.
- `lib/`: helpers, socket wrapper, store, print helpers, auto-update module, and other shared logic.
- `json/`: static JSON data used by game and other plugins.
- `media/`: image/audio assets. Gunakan aset beridentitas Alvareth Bot; file aset yang tidak dipakai dihapus setelah pemeriksaan referensi.
- `database.json`: lowdb runtime data; ignored by Git.
- `sessions/`: WhatsApp multi-file auth data; ignored by Git.
- `.env`: local secrets/runtime configuration; ignored by Git. Never read out, commit, or overwrite actual secrets.
- `.env.example`: sample configuration only; safe to edit/document but never treat it as the live .env.
- `scripts/start-with-update.js`: update-before-start launcher.
- `lib/auto-update.js`: legacy/separate PM2 periodic updater; not imported by the current launcher.
- `.github/workflows/javascript-syntax.yml`: syntax validation for JS files on push/PR.
- `.github/workflows/import-source.yml`: special ZIP import workflow triggered only when a push commit message is exactly `Start import from uploaded ZIP`; it extracts `Alvareth-Bot-updated.zip` and commits sanitized source. This is not a general SC upstream sync workflow.
- There is no active `.github/workflows/deploy.yml` in the current tree. README was corrected on 2026-10-23 to state that pushes do not deploy to a VPS automatically; the current workflows are the JavaScript syntax check and the special ZIP import workflow.

## 4. Environment and common commands

Environment variables documented in `.env.example`:
- `BOT_NUMBER`: WhatsApp bot number, international digits only.
- `OWNER_NUMBER`: owner WhatsApp number, digits only.
- `OWNER_NAME`: displayed owner name.
- `REPOSITORY_URL`: repository link used by menu/info features.
- `WHATSAPP_CHANNEL_URL`, `WHATSAPP_CHANNEL_ID`: optional channel information.
- `AUTO_UPDATE_ENABLED`: set to `false` to skip startup update.
- `AUTO_UPDATE_BRANCH`: defaults to `main`.
- `AUTO_UPDATE_INTERVAL_MINUTES`, `PM2_APP_NAME`: used by the separate `lib/auto-update.js` module, not the current startup launcher.

Commands:
- `npm install`: install project dependencies.
- `npm test`: checks syntax of `index.js`, `main.js`, `handler.js`, `lib/auto-update.js`, and `scripts/start-with-update.js`.
- `npm start`: check/fetch/apply fast-forward update if safe, then launch bot.
- `npm run dev`: Node watch mode for `index.js`; it bypasses the `npm start` updater path.
- For shortcut `b`, user was instructed to add this Bash alias to their own Chromebook shell: `alias b='cd ~/Alvareth-Bot && npm start'`. This is local machine configuration and is not installed by GitHub code. If needed, check `~/.bashrc` on the user's machine; never claim it was configured remotely.
- If using PM2, ensure only one bot instance is running. Do not start a duplicate process if the bot is already active under PM2 or another terminal.
- README says Node.js 22+, but the user's Chromebook environment previously used Node v20.20.2 and Debian 13 in Crostini. Validate actual installed Node version before diagnosing.
- User previously used a Dell Chromebook 3100 with ChromeOS Linux (Crostini), Debian 13 (trixie), and repository path `~/Alvareth-Bot`.

## 5. Persistent data and safety requirements

The current `.gitignore` excludes at least:
- `.env`, local env files, `node_modules/`
- `sessions/`, `session/`, `auth_info/`, `auth_info_baileys/`, `.baileys_auth_info/`, `baileys_auth_info/`
- `database/`, `database.json`, `data.json`, `lib/chat.json`
- temporary files and logs

Before modifying updater/deploy logic:
1. Never use `git reset --hard`, blanket deletion, or destructive sync to resolve conflicts unless the user explicitly authorizes it and data is backed up.
2. Preserve the actual `.env`, WhatsApp credentials/session folders, runtime database and user data.
3. Inspect `git status` before updating.
4. If tracked local modifications exist, stop and explain instead of overwriting them.
5. Git's ignore rules protect only ignored/untracked runtime data; they do not protect a runtime file that is tracked in Git.
6. The startup updater currently fast-forwards the entire commit history if possible. It logs only changed paths but does not cherry-pick individual files. If the user literally requires applying selected files only, implement a carefully designed allowlist or file-by-file update strategy and test it; do not describe current behavior as selective per-file checkout.
7. Startup updater currently runs `npm install` (not `npm ci`) if package manifests change. Review lockfile consistency and native dependency needs before changing this.
8. The updater falls back to launching the existing local version after a failed update. Check the log to know whether it really updated.

## 6. Known prior fixes and user-confirmed behavior

- The `.menu` command was debugged/fixed in `handler.js` and related menu handling. User explicitly confirmed `.menu` works. Do not remove message normalization/self-chat fallback logic without a regression test.
- `handler.js` includes diagnostic logging for menu/help messages with prefix `[DIAG menu-handler]` and `[DIAG menu-stop]`. Review whether these logs are still wanted before removing; avoid losing the useful fallback behavior.
- Group access/allowlist feature exists with private owner commands: `.groupaccess help/status/list/add/remove/on/off`. Earlier changes included logging IDs for groups not on the allowlist.
- Bot branding in terminal/menu/config has been changed to Alvareth Bot. Do not change owner display `Light V` without permission.
- WhatsApp login in current `main.js` is QR based, not pairing-code based.
- `plugins/tools/deploy.js` is a Vercel deployment plugin and is unrelated to the bot's GitHub auto-update.
- An earlier SC archive included a hard-coded Vercel token in a deploy plugin; the ZIP import workflow attempts to replace that token with `process.env.VERCEL_TOKEN`. Review secrets carefully, but never print secrets in chat.

## 7. GitHub workflows and deployment caveats

- Syntax workflow runs on push and pull request to `main`, using Node 20 and `node --check` on all JS files except `.git` and `node_modules`.
- ZIP import workflow only runs its extraction job when the commit message exactly matches `Start import from uploaded ZIP`.
- Do not tell the user that a VPS is auto-deployed after GitHub pushes unless an actual deploy workflow exists and its secrets/target are configured.
- The startup updater only updates the machine where `npm start` is run. It does not automatically update a separate VPS just because GitHub changes.
- A safe VPS deployment needs a verified deploy workflow, SSH secrets, server path, PM2 process name, dependency installation strategy, and explicit exclusions for persistent data. The repository README's deploy section should be reconciled with actual workflows.

## 8. Recommended continuation workflow for an AI

1. Read this file, `README.md`, `package.json`, `.gitignore`, and the exact relevant source files.
2. Fetch current branch state before editing. Do not rely only on this handoff note because code may have changed.
3. Explain the intended change briefly in Indonesian; for substantial changes, inspect dependencies and call sites before writing.
4. Prefer focused commits with clear messages, preserve existing code and all plugins.
5. Run `npm test`; ideally run `npm install` and the syntax workflow or tests when environment permits. Be transparent about tests not run.
6. Review the diff and ensure no secrets, session files, database data, or local env were committed.
7. For update/deploy changes, test both the no-update path and the update path, plus failure/network and dirty-worktree cases.
8. Never promise “100% understood” or “fully tested” from documentation alone; confirm behavior through actual inspection and tests.


## 9. Cross-plugin message-method compatibility fix (2026-10-22)

- A recurring runtime issue was observed: plugins such as `plugins/downloader/tiktok.js` and `plugins/downloader/play.js` call `m.react()` / `m.reply()`, but some serialized messages do not have these methods and throw `TypeError: m.react is not a function` or `m.reply is not a function`.
- A central compatibility fallback was added in `handler.js` immediately after `m = smsg(this, m) || m`. If methods are missing, it defines safe `m.reply()` and `m.react()` implementations using `conn.sendMessage()`, preserving the quoted message where possible. This is intended to fix the shared root cause across plugins rather than patching every plugin individually.
- Commit: `7d66ebf`.
- Next steps: run `npm test` locally and test at least `.play`, `.tt`, plus another plugin that uses `m.reply()` or `m.react()`. This commit is not runtime-verified in a live WhatsApp session yet.
- When a new plugin error appears, check whether it is another missing serializer helper (for example download/quoted helpers) before patching only the plugin. Extend the central compatibility layer only after confirming the expected method contract from `lib/simple.js`.


## 10. Menu audio and initial group allowlist defaults (2026-10-22)

- The menu's optional `media/tes.mp3` is now sent as a regular audio message with `mimetype: 'audio/mpeg'`; do not mark an MP3 buffer as `ptt: true` (WhatsApp voice notes require compatible voice-note encoding, typically Ogg/Opus). The menu should still be delivered if audio transmission fails. Commit: `16bfb17`.
- Fresh group-access settings now seed `allowedGroups` with `120363424686467256@g.us` and keep restriction enabled by default. The three allowlist fallback points in `handler.js` use the same initial allowlist. Commits: `81bbee7` and `458b0f4`.
- These defaults apply when group-access settings are first created or absent. An already-existing `database.json` may contain a persisted `settings.groupAccess`; existing saved settings take precedence. If that existing list is empty, use `.groupaccess add 120363424686467256@g.us` once rather than resetting the full database.
- These changes have been committed to GitHub, but neither audio playback nor fresh-install group gating has yet been verified in a live WhatsApp session.


## 11. Pinterest fallback and persistent user-data storage (2026-10-22)

- `plugins/search/pinterest.js` now reads `KYZZ_API_KEY` from `.env` (or `global.APIKeys[baseUrl]`), normalizes likely result fields, and tries the existing `global.APIs.nexray + /search/pinterest` endpoint if Kyzz v2 fails or returns no usable image URLs. It reports useful status-specific errors instead of only a generic failure. Commit: `8442500` (fallback) plus following integration commits.
- `.env.example` documents `KYZZ_API_KEY`, but the live `.env` is intentionally not committed or changed. A real key may be required by the Kyzz endpoint; if the primary service rejects requests, set a valid key in the user's local `.env`. Nexray fallback may still depend on external service availability. Live Pinterest API/WhatsApp delivery is not yet confirmed.
- Runtime storage was moved outside the Git working tree. By default, lowdb uses `~/.alvareth-bot-data/database.json`; backups are in `~/.alvareth-bot-data/backups/` (up to 10 startup snapshots). Set `ALVARETH_DATA_DIR` to override the root.
- WhatsApp session data now uses `~/.alvareth-bot-data/sessions/` by default; set `WA_SESSION_DIR` to override. On first startup, existing `./database.json` and `./sessions/` are copied to the new location without deleting the old copies. This keeps future Git updates away from these persistent files.
- After this change, run `git pull --ff-only origin main`, then `npm test`, then start the bot. On first boot, watch the log for migration messages. Do not delete the old `database.json` or `sessions/` until you have confirmed the bot has loaded registered data and logged in successfully from the new persistent location.


## 12. Pinterest registration gate and safer database migration (2026-10-22)

- `plugins/search/pinterest.js` now sets `handler.register = false`; the `.pin` / `.pinterest` search commands can be used before registration, so the registration gate no longer prevents testing the feature. Commit: `7253d8e`.
- `main.js` now performs a one-time merge of the ignored legacy `./database.json` into the persistent `~/.alvareth-bot-data/database.json` when the marker `.legacy-database-merged-v1` is absent. Missing old users/fields are filled in; existing persistent values take priority. Original legacy database is not deleted. If the persistent database exists, a pre-merge backup is stored under `~/.alvareth-bot-data/backups/`. Commits: `57e13b7` and `aef772b`.
- Important operational limit: no code update can recover registration data if the old database file has already been deleted or if the bot is running under a different OS user / `ALVARETH_DATA_DIR`. Before restart, preserve any available `database.json` and inspect `~/.alvareth-bot-data/database.json`; never delete either copy during troubleshooting.
- After pulling, run `npm test`, then start the bot and check startup logs for `Database lama digabung dengan data persisten`. Live database migration and live Pinterest API/WhatsApp response have not yet been verified in this session.


## 12. Native Pinterest carousel (2026-10-22)

- User reported that `.pin` looked like a normal image album instead of swipeable cards with buttons.
- `plugins/search/pinterest.js` now uses the installed `@itsliaaa/baileys` fork's native `sendMessage({ text, footer, cards })` API. Each card carries an image, caption, footer, and `nativeFlow: [{ text: '📌 Buka Pinterest', url: pinLink }]`; it should render as a swipeable carousel with an individual URL button per card instead of an album.
- The card caption normalizes pinner/author values to avoid `[object Object]` if the API returns an object.
- The repository's upstream library README documents `cards` + `nativeFlow` as the native carousel API. Actual WhatsApp rendering still requires testing in the user's chat.
- Latest plugin change: `027b312`; GitHub JavaScript syntax workflow completed successfully for this commit. Live message rendering/button behavior has not yet been tested.


## 13. Pinterest cards invisible when sent with top-level text (2026-10-22)

- User reported that `.pin` sent a ✅ reaction but no image/card message.
- Root cause found in the upstream `@itsliaaa/baileys` `generateWAMessageContent` implementation: the `message.text` branch is checked before `message.cards`, so a payload containing both top-level `text` and `cards` takes the plain-text branch and discards the cards.
- Fix in `plugins/search/pinterest.js`: send the intro text in its own message, then send a second payload containing `cards` and `footer` but deliberately no top-level `text`. This lets the library reach its carousel branch. Card URL buttons now set `useWebview: true`. Commit: `c33c13e`.
- The plugin checks that the carousel send returns a message key before reacting ✅. A send failure should enter the existing catch path and react ❌ with an error message.
- The syntax workflow is still running after this commit at the time of this note; verify GitHub Actions before telling the user it passed. Actual WhatsApp carousel rendering/button click must still be verified on the user's device.

## 14. Pinterest images found but carousel send failed (2026-10-22)

- User observed that .pin could find 10 results and send the intro message, then fail while sending the actual carousel.
- plugins/search/pinterest.js now downloads and validates each image URL first (18-second timeout, 8 MB maximum per image); broken/non-image URLs are skipped so one bad media URL cannot make all results fail.
- Native carousel cards now receive an in-memory image Buffer to avoid re-fetching remote Pinterest image URLs during carousel construction. Each card has a native-flow URL button.
- If sending the native carousel fails, the plugin logs the exact carousel error and falls back to individual image cards with a “Buka Pinterest” URL button. It only reacts ✅ after carousel or fallback delivery has produced message IDs; if no image can be sent, it reacts ❌ and reports the media-send failure.
- A duplicate displayValue declaration found by CI was removed. GitHub JavaScript syntax workflow passed for commit ae635c7.
- Live rendering of native carousel and fallback image buttons must still be verified in WhatsApp; successful syntax CI alone does not prove delivery.

## 15. Pinterest reverted from carousel to normal image album (2026-10-22)

- User explicitly cancelled the interactive card/carousel UI and requested the original regular image output instead.
- Current `plugins/search/pinterest.js` downloads/validates image URLs (maximum 8 MB each), skips failed URLs, then sends multiple results using the fork's `{ album: [{ image: Buffer, caption }] }` structure. Single surviving result is sent as one ordinary image.
- Each image caption includes query, title, pinner, likes (if available), direct Pinterest/search link, and Alvareth Bot branding. No card carousel or card buttons are intentionally sent.
- Success reaction is sent only after WhatsApp send resolves with a message key; send failures log the error and react ❌ with an error reply.
- Change commit: `a3710f2`. GitHub syntax workflow was still running at the time this note was written; inspect Actions result and test `.pin` in live WhatsApp before calling runtime behavior verified.


## 10. Repository cleanup (2026-10-23)

- Removed root `speed.py`, a standalone Speedtest CLI script not wired to the package scripts or the core `.ping` plugin.
- Removed root `ytta.txt`, an outdated setup guide describing a login method that is not used by the current QR-login flow.
- Added `assets/pingcanvas/` to `.gitignore`; the `.ping` plugin downloads font files there at runtime.
- Updated README deployment instructions: there is no active VPS deploy workflow in the repository.
- After the 2026-10-23 reference scan, unused legacy artwork and thumbnail files were removed only after code references had been redirected to `media/alvareth-preview.jpg` or the current Alvareth character assets.
- The branded chat assistant now lives in `plugins/ai/alvareth.js` with commands `.alvarethai` and `.alva`; the automatic AI persona in `plugins/anu/_autogpt.js` also uses Alvareth identity. Other named anime-persona plugins and unrelated trivia data remain as intentional features.
