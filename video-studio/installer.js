import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, openSync, closeSync,
  readFileSync, rmSync, writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACTIVE = global.__alvarethVideoStudioInstallers || (global.__alvarethVideoStudioInstallers = new Map());

const INSTALL_ENV_KEYS = [
  "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
  "LD_LIBRARY_PATH", "CUDA_HOME", "CUDA_PATH", "CUDA_VISIBLE_DEVICES",
  "NVIDIA_VISIBLE_DEVICES", "NVIDIA_DRIVER_CAPABILITIES", "OMP_NUM_THREADS",
  "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "ALVARETH_DATA_DIR",
  "VOXCPM_MODEL_PATH",
  "VOXCPM_TORCH_INDEX_URL", "UV_VERSION", "HF_ENDPOINT", "HF_HOME",
  "HUGGINGFACE_HUB_CACHE", "CURL_CA_BUNDLE", "SSL_CERT_FILE"
];

export function getVideoStudioInstallerPaths(env = process.env) {
  const home = String(env.HOME || homedir());
  const dataDir = resolve(String(env.ALVARETH_DATA_DIR || join(home, ".alvareth-bot-data")));
  const logDir = join(dataDir, "video-studio", "logs");
  return {
    dataDir,
    logDir,
    scriptPath: join(ROOT, "scripts", "setup-video-studio-linux.sh"),
    logPath: join(logDir, "setup.log"),
    lockDir: join(logDir, "setup.lock"),
    pidPath: join(logDir, "setup.lock", "pid"),
    exitCodePath: join(logDir, "setup.exit-code")
  };
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readNumber(path) {
  try {
    const value = Number(readFileSync(path, "utf8").trim());
    return Number.isSafeInteger(value) ? value : null;
  } catch {
    return null;
  }
}

function readLogTail(path, maxChars = 2600) {
  try {
    return readFileSync(path, "utf8").slice(-maxChars).trim();
  } catch {
    return "";
  }
}

export function readVideoStudioInstallerStatus(env = process.env) {
  const paths = getVideoStudioInstallerPaths(env);
  const pid = readNumber(paths.pidPath);
  const lockExists = existsSync(paths.lockDir);
  const running = lockExists && processIsAlive(pid);
  const exitCode = readNumber(paths.exitCodePath);
  const status = running
    ? "running"
    : lockExists
      ? "interrupted"
      : exitCode === null
        ? "not-started"
        : exitCode === 0 ? "completed" : "failed";
  return {
    status,
    pid,
    exitCode,
    logTail: readLogTail(paths.logPath),
    logPath: paths.logPath
  };
}

export function detectVideoStudioNvidiaGpu() {
  try {
    const result = spawnSync("nvidia-smi", [
      "--query-gpu=name,memory.total",
      "--format=csv,noheader,nounits"
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true
    });
    const line = String(result.stdout || "").split(/\r?\n/).find(item => item.trim());
    if (result.status !== 0 || !line) return { available: false, name: "", memoryMiB: null };
    const [name, memory] = line.split(",").map(item => item.trim());
    const memoryMiB = Number(memory);
    return {
      available: true,
      name: name || "NVIDIA GPU",
      memoryMiB: Number.isFinite(memoryMiB) && memoryMiB > 0 ? memoryMiB : null
    };
  } catch {
    return { available: false, name: "", memoryMiB: null };
  }
}

export function buildVideoStudioInstallerEnvironment(env = process.env, mode = "gpu") {
  const result = {};
  for (const key of INSTALL_ENV_KEYS) {
    if (env[key] !== undefined && env[key] !== "") result[key] = String(env[key]);
  }
  result.HOME = result.HOME || homedir();
  result.PATH = [
    join(result.HOME, ".local", "bin"),
    result.PATH || env.PATH || "/usr/local/bin:/usr/bin:/bin"
  ].join(":");
  if (mode === "cpu") result.VOXCPM_TORCH_INDEX_URL = "https://download.pytorch.org/whl/cpu";
  return result;
}

export function startVideoStudioInstaller({
  mode = "gpu",
  env = process.env,
  onExit,
  onError
} = {}) {
  if (process.platform !== "linux") {
    return { started: false, error: "Installer Video Studio hanya mendukung Linux." };
  }
  if (!["gpu", "cpu"].includes(mode)) {
    return { started: false, error: "Mode installer harus gpu atau cpu." };
  }

  const paths = getVideoStudioInstallerPaths(env);
  if (!existsSync(paths.scriptPath)) {
    return { started: false, error: "Script setup-video-studio-linux.sh tidak ditemukan di checkout bot." };
  }

  const current = readVideoStudioInstallerStatus(env);
  if (current.status === "running" || ACTIVE.has(paths.dataDir)) {
    return { started: false, alreadyRunning: true, pid: current.pid };
  }

  const gpu = detectVideoStudioNvidiaGpu();
  if (mode === "gpu" && !gpu.available) {
    return { started: false, needsCpuOptIn: true, gpu };
  }

  mkdirSync(paths.logDir, { recursive: true, mode: 0o700 });
  let logFd;
  try {
    logFd = openSync(paths.logPath, "a", 0o600);
    try { chmodSync(paths.logPath, 0o600); } catch {}
    const args = [paths.scriptPath, "--with-models"];
    if (mode === "cpu") args.push("--allow-cpu");
    const child = spawn("bash", args, {
      cwd: ROOT,
      env: buildVideoStudioInstallerEnvironment(env, mode),
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true
    });
    closeSync(logFd);
    logFd = undefined;

    ACTIVE.set(paths.dataDir, child);
    child.once("error", error => {
      ACTIVE.delete(paths.dataDir);
      try {
        writeFileSync(paths.exitCodePath, "127\n", { mode: 0o600 });
        rmSync(paths.lockDir, { recursive: true, force: true });
      } catch {}
      onError?.(error);
    });
    child.once("exit", code => {
      ACTIVE.delete(paths.dataDir);
      onExit?.(Number.isInteger(code) ? code : -1);
    });
    child.unref();
    return { started: true, pid: child.pid || null, mode, gpu };
  } catch (error) {
    if (logFd !== undefined) {
      try { closeSync(logFd); } catch {}
    }
    return { started: false, error: String(error?.message || error).slice(0, 240) };
  }
}
