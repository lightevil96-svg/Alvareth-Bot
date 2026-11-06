# Hermes Agent Maintenance Bridge

Alvareth exposes the Nous Research Hermes Agent through the existing owner-only WhatsApp command router. The bridge invokes the Hermes CLI as a child process; it does not start a second WhatsApp connection.

## Why CLI bridge instead of Hermes WhatsApp Gateway?

Alvareth already owns the WhatsApp connection through Baileys. Pairing a second Hermes Baileys gateway to the same WhatsApp account is unnecessary and can create competing sessions. The bridge keeps the current Alvareth connection and sends owner prompts to a local Hermes CLI process.

## Install and configure Hermes

Install Hermes in the same Linux user/container that runs Alvareth. Use the official installer:

    curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

Reload the service user's PATH if needed:

    source ~/.bashrc

Configure a provider and model interactively:

    hermes setup
    hermes model

The one-shot setup option is:

    hermes setup --portal

Hermes is open source, but model inference is not automatically free. Costs depend on the selected provider and model. A local model can avoid hosted inference charges if the server has sufficient RAM/VRAM and compute.

The Node.js bot process must be able to find the Hermes launcher. The installer commonly places it at ~/.local/bin/hermes; service managers and hosting panels often use a smaller PATH. In that case, set HERMES_BIN in Alvareth .env to the absolute launcher path, for example:

    HERMES_BIN=/home/alvareth/.local/bin/hermes

Configure the same Hermes home used during setup with HERMES_HOME only if it is not the default $HOME/.hermes. Do not copy API keys into Alvareth .env; configure provider credentials in Hermes itself.

Restart Alvareth, then run:

    .hermes status

## WhatsApp commands

| Command | Purpose |
| --- | --- |
| .hermes | Open the interactive maintenance menu |
| .hermes status | Check CLI availability and whether Hermes config/auth files exist |
| .hermes audit [focus] | Audit architecture, plugins, permission checks, reliability, and security |
| .hermes ask <question> | Ask a repository-aware technical question |
| .hermes patch <path> <instruction> | Generate a reviewable unified diff for an allowed source file |
| .hermes pending | List patches waiting for owner approval |
| .hermes apply <id> | Apply a reviewed patch after safety checks |
| .hermes undo <id> | Reverse a previously applied patch if its context still matches |
| .hermes discard <id> | Delete a pending patch without changing production code |
| .hermes verify | Run the repository npm test suite |
| .hermes reset | Start a new Hermes conversation for the current WhatsApp chat |
| .hermes setup | Show installation and configuration instructions |

Example:

    .hermes patch plugins/owner/menu.js simplify the input validation and add a regression test

## Safety model

- Every command is restricted to the Alvareth super-owner (isROwner); the plugin checks the owner flag again at runtime.
- Only one Hermes request is allowed at a time to protect limited VPS resources.
- Hermes is launched without a shell. Owner prompts are passed as a normal CLI argument, never interpolated into a shell command.
- The child process receives an allowlisted environment only. Alvareth bot numbers, GitHub tokens, and unrelated application secrets are not inherited.
- Hermes receives the file, web, search, and clarify toolsets. The terminal, shell, code-execution, gateway, and WhatsApp toolsets are not enabled by this bridge.
- HERMES_WRITE_SAFE_ROOT is set to a temporary workspace outside the repository. Hermes may read project source and write a proposed patch to that workspace, but its file-write/patch tools cannot directly change production files.
- Prompts explicitly forbid reading .env, credentials, WhatsApp auth/session files, databases, logs, downloads, backups, node_modules, and .git. Hermes secret redaction remains enabled by its own configuration.
- Patch validation rejects paths outside the project allowlist, path traversal, symlinks, binary diffs, permission changes, renames, deletions, package manifests, and lockfiles.
- .hermes apply <id> is a separate explicit owner action. It requires a Git checkout, clean target files, a successful git apply --check, backups, and JavaScript syntax checks. A syntax failure triggers an automatic reverse patch/backup restoration.
- Applying a patch does not commit, push, or deploy it. Run .hermes verify after applying and review git diff before committing.
- .hermes undo <id> uses the reverse patch and refuses if the current file context no longer matches.

Important limitation: Hermes file-write guards are not a general OS sandbox. This bridge deliberately does not enable its terminal tool, so the agent cannot run shell commands or use an unrestricted host terminal. Keep the Hermes installation and its credentials under the same trusted server account.

## Data locations

The bridge stores only WhatsApp-chat-to-Hermes-session IDs, pending patch files, applied patch copies, and backups under ALVARETH_DATA_DIR/hermes/ (default ~/.alvareth-bot-data/hermes/). It does not store provider credentials there.

Do not place the Hermes home directory inside the public repository. Keep $HOME/.hermes private and do not commit it.

## Troubleshooting

- Hermes CLI belum ditemukan: check which hermes in the same hosting user/container, then set HERMES_BIN to the absolute launcher path.
- Config or Credential store not available: run hermes setup / hermes model as the same server user.
- A one-shot request times out: raise HERMES_TIMEOUT_MS carefully (maximum 900000 ms) or choose a faster model.
- Patch application says target files have local changes: review/commit or back up those changes first; the bridge will not overwrite them.
- Patch application is rejected: inspect the patch and target branch manually. Unsupported changes must be made and reviewed outside the automatic patch route.
- npm test fails after applying a patch: use .hermes undo <id> if the patch context is unchanged, then inspect the failure before trying another change.

## Official references

- Installation: https://hermes-agent.nousresearch.com/docs/getting-started/installation
- CLI commands and one-shot usage: https://hermes-agent.nousresearch.com/docs/reference/cli-commands
- Security and file-write safety: https://hermes-agent.nousresearch.com/docs/user-guide/security
- Source repository: https://github.com/NousResearch/hermes-agent
