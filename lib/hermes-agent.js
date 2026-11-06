import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const OUTPUT_LIMIT = 300_000;
const ALLOWED_DIRECTORIES = [
  "plugins",
  "lib",
  "video-studio",
  "tests",
  "scripts",
  "docs",
  "src",
  "json"
];
const ALLOWED_ROOT_FILES = new Set([
  "handler.js",
  "main.js",
  "index.js",
  "README.md",
  "AI_CONTEXT.md",
  "AGENTS.md"
]);
const ALLOWED_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".json", ".md", ".yaml", ".yml", ".sh", ".py",
  ".txt", ".css", ".html"
]);
const BLOCKED_SEGMENTS = new Set([
  ".git", ".worktrees", "node_modules", ".env",
  "sessions", "session", "auth_info", "auth_info_baileys",
  "baileys_auth_info", "database", "downloads", "tmp",
  "logs", "backups", "downloads", "media"
]);

export function createHermesId() {
  return randomBytes(4).toString("hex");
}

export function hashHermesChat(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

export function parseHermesCommand(input) {
  const value = String(input || "").trim();
  if (!value) return { action: "menu", argument: "" };
  const match = value.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return {
    action: String(match?.[1] || "menu").toLowerCase(),
    argument: String(match?.[2] || "").trim()
  };
}

export function getHermesPaths(env = process.env) {
  const home = String(env.HOME || homedir());
  const dataRoot = path.resolve(String(
    env.ALVARETH_DATA_DIR || path.join(home, ".alvareth-bot-data")
  ));
  const root = path.join(dataRoot, "hermes");
  return {
    root,
    sessionsFile: path.join(root, "whatsapp-sessions.json"),
    workspaces: path.join(root, "workspaces"),
    pending: path.join(root, "pending"),
    applied: path.join(root, "applied"),
    backups: path.join(root, "backups")
  };
}

export function buildHermesEnvironment(workspacePath, env = process.env) {
  const home = String(env.HOME || homedir());
  const allowed = [
    "PATH",
    "HERMES_HOME",
    "HERMES_PROFILE",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "no_proxy"
  ];
  const output = {
    HOME: home,
    PATH: String(env.PATH || "/usr/local/bin:/usr/bin:/bin"),
    TERM: "dumb",
    LANG: "C.UTF-8",
    HERMES_WRITE_SAFE_ROOT: path.resolve(workspacePath),
  };
  for (const key of allowed) {
    if (env[key] !== undefined && env[key] !== "") output[key] = String(env[key]);
  }
  return output;
}

export function redactHermesOutput(value) {
  return String(value || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|bearer)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\r/g, "")
    .trim();
}

export function splitHermesMessage(value, maxChars = 3500) {
  const text = String(value || "").trim();
  if (!text) return [];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf("\n", maxChars);
    if (cut < Math.floor(maxChars * 0.55)) cut = remaining.lastIndexOf(" ", maxChars);
    if (cut < Math.floor(maxChars * 0.55)) cut = maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function validateHermesRepoPath(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Tentukan path file relatif terhadap folder utama bot.");
  }
  const raw = input.trim();
  if (
    raw.includes("\0") ||
    raw.includes("\\") ||
    raw.startsWith("/") ||
    /^[a-z]:/i.test(raw) ||
    raw.split("/").some(part => part === ".." || part === "")
  ) {
    throw new Error("Path tidak valid. Gunakan path relatif tanpa .., slash awal, atau backslash.");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized !== raw || normalized === "." || normalized === "..") {
    throw new Error("Path tidak valid atau mengarah ke luar folder bot.");
  }
  const segments = normalized.split("/");
  if (segments.some(part => BLOCKED_SEGMENTS.has(part) || part.startsWith(".env"))) {
    throw new Error("Path tersebut termasuk file runtime, kredensial, atau direktori terlindungi.");
  }
  const allowed = ALLOWED_ROOT_FILES.has(normalized) ||
    ALLOWED_DIRECTORIES.some(dir => normalized.startsWith(dir + "/"));
  if (!allowed) {
    throw new Error("Path hanya boleh berada di plugins/, lib/, video-studio/, tests/, scripts/, docs/, src/, json/, atau file dokumentasi/kode utama yang diizinkan.");
  }
  if (!ALLOWED_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    throw new Error("Ekstensi file tersebut belum diizinkan untuk inspeksi/perubahan Hermes.");
  }
  return normalized;
}

export function validateHermesUnifiedPatch(input) {
  const patch = String(input || "").replace(/\r\n/g, "\n");
  if (!patch.trim()) throw new Error("Patch kosong.");
  if (Buffer.byteLength(patch, "utf8") > 500_000) {
    throw new Error("Patch melebihi batas 500 KB.");
  }
  if (
    /GIT binary patch|^Binary files /m.test(patch) ||
    /^(?:old mode|new mode|new file mode|deleted file mode|rename from|rename to|copy from|copy to|Subproject commit) /m.test(patch)
  ) {
    throw new Error("Patch berisi perubahan binary, permission, rename, atau submodule yang tidak diizinkan.");
  }

  const headers = [...patch.matchAll(/^diff --git a\/([^\s]+) b\/([^\s]+)$/gm)];
  if (!headers.length) {
    throw new Error("Format patch tidak dikenali. Dibutuhkan unified diff dengan header diff --git.");
  }

  const paths = [];
  for (const match of headers) {
    if (match[1] !== match[2]) {
      throw new Error("Rename file tidak diizinkan dalam patch otomatis.");
    }
    const relativePath = validateHermesRepoPath(match[1]);
    if (paths.includes(relativePath)) {
      throw new Error("Patch mengandung path ganda: " + relativePath);
    }
    paths.push(relativePath);
  }

  const markers = [...patch.matchAll(/^(---|\+\+\+) (.+)$/gm)];
  if (!markers.length || !/^@@ /m.test(patch)) {
    throw new Error("Patch tidak memiliki file marker atau hunk perubahan yang valid.");
  }

  for (const marker of markers) {
    const value = marker[2].trim();
    if (value === "/dev/null") {
      if (marker[1] !== "---") {
        throw new Error("Penghapusan file tidak diizinkan.");
      }
      continue;
    }
    const pathMatch = value.match(/^[ab]\/([^\s]+)$/);
    if (!pathMatch) throw new Error("File marker patch tidak valid.");
    const relativePath = validateHermesRepoPath(pathMatch[1]);
    if (!paths.includes(relativePath)) {
      throw new Error("File marker tidak cocok dengan header patch: " + relativePath);
    }
  }

  return { patch, paths };
}

export async function ensureHermesWorkspace(workspacePath) {
  await mkdir(workspacePath, { recursive: true, mode: 0o700 });
  return workspacePath;
}

function appendBounded(current, chunk, limit) {
  if (current.length >= limit) return current;
  const remaining = limit - current.length;
  return current + chunk.toString("utf8").slice(0, remaining);
}

export function runHermesChild(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, args, {
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    const maxOutput = Math.max(1024, Number(options.maxOutputChars) || OUTPUT_LIMIT);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer;

    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 240_000);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout = appendBounded(stdout, chunk, maxOutput);
    });
    child.stderr.on("data", chunk => {
      stderr = appendBounded(stderr, chunk, Math.min(maxOutput, 50_000));
    });
    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) {
        reject(new Error("Proses melewati batas waktu " + Math.round(timeoutMs / 1000) + " detik."));
        return;
      }
      resolve({
        code: Number.isInteger(code) ? code : 1,
        signal: signal || null,
        stdout,
        stderr
      });
    });

    if (options.input !== undefined && options.input !== null) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export async function runHermesQuery({
  prompt,
  repoRoot = process.cwd(),
  workspacePath,
  sessionId = "",
  binary = process.env.HERMES_BIN || "hermes",
  timeoutMs = Number(process.env.HERMES_TIMEOUT_MS) || 300_000,
  env = process.env
}) {
  await ensureHermesWorkspace(workspacePath);
  const usageFile = path.join(workspacePath, "usage-" + createHermesId() + ".json");
  const args = [
    "--in", repoRoot,
    "chat",
    "--query", String(prompt || ""),
    "--toolsets", "file,web,search,clarify",
    "--quiet",
    "--source", "tool",
    "--max-turns", "16",
    ...(sessionId ? ["--resume", sessionId] : []),
    "--usage-file", usageFile
  ];
  let result;
  let usage = {};
  try {
    result = await runHermesChild(binary, args, {
      cwd: repoRoot,
      env: buildHermesEnvironment(workspacePath, env),
      input: String(prompt || ""),
      timeoutMs,
      maxOutputChars: OUTPUT_LIMIT
    });
    try {
      usage = JSON.parse(await readFile(usageFile, "utf8"));
    } catch {}
  } finally {
    await rm(usageFile, { force: true }).catch(() => {});
  }

  const output = redactHermesOutput(result.stdout);
  if (result.code !== 0) {
    const detail = redactHermesOutput(result.stderr || output).slice(-2500);
    throw new Error(
      "Hermes gagal (exit " + result.code + ")." +
      (detail ? "\n" + detail : " Periksa konfigurasi Hermes dan log server.")
    );
  }
  if (!output) throw new Error("Hermes selesai tanpa jawaban. Periksa provider/model pada konfigurasi Hermes.");
  return {
    text: output,
    sessionId: typeof usage.session_id === "string" ? usage.session_id : "",
    usage
  };
}

export async function getHermesVersion({
  binary = process.env.HERMES_BIN || "hermes",
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const home = String(env.HOME || homedir());
  const result = await runHermesChild(binary, ["--version"], {
    cwd,
    env: buildHermesEnvironment(path.join(home, ".alvareth-hermes-empty-write-root"), env),
    timeoutMs: 15_000,
    maxOutputChars: 5000
  });
  if (result.code !== 0) {
    throw new Error(redactHermesOutput(result.stderr || result.stdout) || "Hermes CLI tidak dapat dijalankan.");
  }
  return redactHermesOutput(result.stdout || result.stderr).slice(0, 300);
}

async function assertNoSymlinkPath(root, relativePath) {
  const parts = relativePath.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Symlink tidak diizinkan pada path patch: " + relativePath);
      if (i < parts.length - 1 && !stat.isDirectory()) {
        throw new Error("Komponen path bukan direktori: " + relativePath);
      }
      if (i === parts.length - 1 && !stat.isFile()) {
        throw new Error("Target patch harus berupa file biasa: " + relativePath);
      }
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

async function runGit(repoRoot, args, input = null) {
  const result = await runHermesChild("git", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1"
    },
    input,
    timeoutMs: 30_000,
    maxOutputChars: 30_000
  });
  if (result.code !== 0) {
    throw new Error(redactHermesOutput(result.stderr || result.stdout).slice(-2500) || "Perintah Git gagal.");
  }
  return result.stdout.trim();
}

async function restoreHermesBackups(repoRoot, backupRoot, manifest) {
  for (const item of manifest.files) {
    const destination = path.join(repoRoot, item.path);
    if (item.existed) {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(backupRoot, item.backup), destination);
    } else {
      await rm(destination, { force: true });
    }
  }
}

export async function applyHermesPatch({
  repoRoot = process.cwd(),
  patch,
  id,
  backupRoot
}) {
  const validated = validateHermesUnifiedPatch(patch);
  const root = await realpath(repoRoot);
  const gitRoot = await runGit(root, ["rev-parse", "--show-toplevel"]);
  if (await realpath(gitRoot) !== root) {
    throw new Error("Penerapan patch hanya diizinkan dari root repository Git Alvareth.");
  }

  for (const relativePath of validated.paths) {
    await assertNoSymlinkPath(root, relativePath);
  }
  const dirty = await runGit(root, [
    "status", "--porcelain", "--untracked-files=all", "--",
    ...validated.paths
  ]);
  if (dirty) {
    throw new Error(
      "File target memiliki perubahan lokal. Simpan/commit perubahan tersebut sebelum menerapkan patch agar tidak tertimpa."
    );
  }

  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const files = [];
  for (const relativePath of validated.paths) {
    const absolute = path.join(root, relativePath);
    const existed = existsSync(absolute);
    const backup = relativePath;
    if (existed) {
      await mkdir(path.dirname(path.join(backupRoot, backup)), { recursive: true, mode: 0o700 });
      await copyFile(absolute, path.join(backupRoot, backup));
    }
    files.push({ path: relativePath, existed, backup });
  }
  const manifest = { id, createdAt: new Date().toISOString(), files };
  await writeFile(
    path.join(backupRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600 }
  );

  try {
    await runGit(root, ["apply", "--check", "--whitespace=nowarn", "-"], validated.patch);
    await runGit(root, ["apply", "--whitespace=nowarn", "-"], validated.patch);
    const syntaxFiles = validated.paths.filter(file => [".js", ".mjs", ".cjs"].includes(path.extname(file)));
    for (const file of syntaxFiles) {
      const check = await runHermesChild("node", ["--check", path.join(root, file)], {
        cwd: root,
        env: process.env,
        timeoutMs: 15_000,
        maxOutputChars: 10_000
      });
      if (check.code !== 0) {
        throw new Error(
          "Pemeriksaan sintaks gagal pada " + file + ": " +
          redactHermesOutput(check.stderr || check.stdout).slice(-1800)
        );
      }
    }
  } catch (error) {
    try {
      await runGit(root, ["apply", "-R", "--whitespace=nowarn", "-"], validated.patch);
    } catch {
      await restoreHermesBackups(root, backupRoot, manifest);
    }
    throw error;
  }

  return {
    paths: validated.paths,
    backupRoot,
    syntaxChecked: validated.paths.filter(file => [".js", ".mjs", ".cjs"].includes(path.extname(file)))
  };
}

export async function undoHermesPatch({ repoRoot = process.cwd(), patch }) {
  const validated = validateHermesUnifiedPatch(patch);
  const root = await realpath(repoRoot);
  const gitRoot = await runGit(root, ["rev-parse", "--show-toplevel"]);
  if (await realpath(gitRoot) !== root) {
    throw new Error("Undo hanya dapat dijalankan dari root repository Git Alvareth.");
  }
  for (const relativePath of validated.paths) {
    await assertNoSymlinkPath(root, relativePath);
  }
  await runGit(root, ["apply", "-R", "--check", "--whitespace=nowarn", "-"], validated.patch);
  await runGit(root, ["apply", "-R", "--whitespace=nowarn", "-"], validated.patch);
  return validated.paths;
}
