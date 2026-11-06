import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = path.resolve(process.env.ALVARETH_DATA_DIR || path.join(homedir(), ".alvareth-bot-data"));
const GENERATED_ROOT = path.join(PROJECT_ROOT, "video-studio", "remotion", "public", "generated");
const DEFAULT_TEMP_ROOT = path.join(DATA_ROOT, "tmp");
const TEMP_ROOT = path.resolve(process.env.ALVARETH_WA_TMPDIR || DEFAULT_TEMP_ROOT);
const DAY_MS = 24 * 60 * 60 * 1000;

function run(command, args, timeout = 30000) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return amount.toFixed(2) + " " + units[index];
}

export function getDiskReport({ cwd = PROJECT_ROOT } = {}) {
  const df = run("df", ["-hP", cwd]);
  const lines = df.split(/\r?\n/);
  const columns = (lines.at(-1) || "").trim().split(/\s+/);
  const filesystem = columns.length >= 6
    ? { device: columns[0], size: columns[1], used: columns[2], available: columns[3], usePercent: columns[4], mount: columns[5] }
    : null;

  const du = run("du", ["-x", "-h", "-d", "1", cwd], 60000);
  const folders = du.split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^([^\t]+)\t(.+)$/);
    return match ? { size: match[1], path: match[2] } : null;
  }).filter(Boolean).sort((a, b) => a.path === cwd ? -1 : b.path === cwd ? 1 : 0).slice(0, 12);

  return { filesystem, folders, scannedPath: cwd, scannedAt: new Date().toISOString() };
}

async function walkSafeFiles(root, cutoff, output = []) {
  let rootStat;
  try { rootStat = await lstat(root); } catch { return output; }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return output;

  const visit = async directory => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      let info;
      try { info = await lstat(target); } catch { continue; }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await visit(target);
      } else if (info.isFile() && info.mtimeMs < cutoff) {
        output.push({ path: target, size: info.size, modifiedAt: info.mtime.toISOString() });
      }
    }
  };
  await visit(root);
  return output;
}

function allowedCleanupRoots() {
  const roots = [
    { label: "Temporary media WhatsApp", path: TEMP_ROOT },
    { label: "Aset sementara Remotion", path: GENERATED_ROOT }
  ];
  return roots.filter((item, index, all) =>
    all.findIndex(other => other.path === item.path) === index &&
    item.path !== PROJECT_ROOT &&
    !PROJECT_ROOT.startsWith(item.path + path.sep)
  );
}

export async function getSafeCleanupPreview({ olderThanMs = DAY_MS, now = Date.now() } = {}) {
  const cutoff = now - Math.max(DAY_MS, Number(olderThanMs) || DAY_MS);
  const candidates = [];
  for (const root of allowedCleanupRoots()) {
    const files = await walkSafeFiles(root.path, cutoff);
    const sizeBytes = files.reduce((sum, file) => sum + file.size, 0);
    candidates.push({
      label: root.label,
      path: root.path,
      fileCount: files.length,
      sizeBytes,
      files
    });
  }
  return {
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
    totalFiles: candidates.reduce((sum, item) => sum + item.fileCount, 0),
    totalBytes: candidates.reduce((sum, item) => sum + item.sizeBytes, 0),
    candidates
  };
}

export async function cleanSafeTempFiles(preview, { now = Date.now() } = {}) {
  if (!preview || !Array.isArray(preview.candidates) || !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) < now) {
    throw new Error("Preview pembersihan tidak tersedia atau sudah kedaluwarsa. Jalankan .disk clean lagi.");
  }

  const allowed = new Map(allowedCleanupRoots().map(root => [root.path, root.label]));
  let deletedFiles = 0;
  let deletedBytes = 0;
  const errors = [];

  for (const candidate of preview.candidates) {
    if (!allowed.has(candidate.path) || !Array.isArray(candidate.files)) continue;
    for (const file of candidate.files) {
      const target = path.resolve(file.path);
      if (!target.startsWith(candidate.path + path.sep)) continue;
      try {
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs >= Date.parse(preview.createdAt)) continue;
        await rm(target, { force: false });
        deletedFiles++;
        deletedBytes += info.size;
      } catch (error) {
        if (error?.code !== "ENOENT") errors.push(path.basename(target) + ": " + String(error?.message || error).slice(0, 120));
      }
    }
  }

  return { deletedFiles, deletedBytes, errors: errors.slice(0, 5) };
}
