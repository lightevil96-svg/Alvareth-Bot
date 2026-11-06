import { spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localServiceUrl } from "./local-service.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.ALVARETH_DATA_DIR ? resolve(process.env.ALVARETH_DATA_DIR) : join(homedir(), ".alvareth-bot-data");
const MANAGED = global.__alvarethVideoLocalServices || (global.__alvarethVideoLocalServices = new Map());
const DEFAULT_VOXCPM_URL = "http://127.0.0.1:7861";

export function getLocalVideoServiceConfig(env = process.env) {
  const voxUrl = String(env.VIDEO_STUDIO_VOXCPM_URL || DEFAULT_VOXCPM_URL).trim();
  const modelPath = resolve(String(env.VOXCPM_MODEL_PATH || join(homedir(), "alvareth-models", "VoxCPM2")));
  const pythonPath = resolve(String(env.VIDEO_STUDIO_VOXCPM_PYTHON || join(ROOT, ".venv-voxcpm", "bin", "python")));
  return {
    voxUrl,
    modelPath,
    pythonPath,
    pythonServer: join(ROOT, "video-studio", "services", "voxcpm", "server.py"),
    autoStart: String(env.VIDEO_STUDIO_LOCAL_SERVICES_AUTOSTART ?? "true").toLowerCase() !== "false"
  };
}

const COMMON_SERVICE_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
  "LD_LIBRARY_PATH", "CUDA_HOME", "CUDA_PATH", "CUDA_VISIBLE_DEVICES",
  "NVIDIA_VISIBLE_DEVICES", "NVIDIA_DRIVER_CAPABILITIES", "OMP_NUM_THREADS",
  "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"
];

export function buildLocalServiceEnvironment(_kind, env = process.env, overrides = {}) {
  const specific = [
    "TORCH_HOME", "HF_HOME", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE",
    "VOXCPM_VOICE_DESCRIPTION", "VOXCPM_ALIGNMENT_MODEL_PATH", "VOXCPM_ALIGNMENT_DEVICE"
  ];
  const result = {};
  for (const key of [...COMMON_SERVICE_ENV, ...specific]) {
    if (env[key] !== undefined && env[key] !== "") result[key] = env[key];
  }
  if (!result.PATH && process.env.PATH) result.PATH = process.env.PATH;
  if (!result.HOME) result.HOME = homedir();
  return { ...result, ...overrides };
}

export function isVoxCPMReady(payload) {
  return payload?.provider === "VoxCPM2" && payload?.ready === true;
}

function commandWorks(command, args = ["--version"]) {
  try {
    const result = spawnSync(command, args, { stdio: "ignore", timeout: 5000, windowsHide: true });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function launchManaged(name, command, args, env) {
  const current = MANAGED.get(name);
  if (current && current.exitCode === null && !current.error) {
    return { started: false, alreadyManaged: true, state: current };
  }

  const state = { pid: null, exitCode: null, error: null, startedAt: Date.now(), logPath: null };
  let logFd = null;
  try {
    const logDir = join(DATA_DIR, "video-studio", "logs");
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    const logPath = join(logDir, name.toLowerCase() + ".log");
    logFd = openSync(logPath, "a", 0o600);
    try { chmodSync(logPath, 0o600); } catch {}
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true
    });
    closeSync(logFd);
    logFd = null;
    state.logPath = logPath;
    MANAGED.set(name, state);
    child.once("spawn", () => { state.pid = child.pid || null; });
    child.once("error", error => {
      state.error = String(error?.message || error).slice(0, 180);
      state.exitCode = -1;
      console.warn("[VIDEO STUDIO] Gagal menjalankan " + name + ":", state.error);
    });
    child.once("exit", code => {
      state.exitCode = Number.isInteger(code) ? code : -1;
      console.warn("[VIDEO STUDIO] Proses " + name + " berhenti (exit=" + state.exitCode + ").");
    });
    child.unref();
    console.log("[VIDEO STUDIO] Memulai service lokal " + name + (child.pid ? " (PID " + child.pid + ")." : "."));
    return { started: true, alreadyManaged: false, state };
  } catch (error) {
    if (logFd !== null) { try { closeSync(logFd); } catch {} }
    state.error = String(error?.message || error).slice(0, 180);
    state.exitCode = -1;
    return { started: false, alreadyManaged: false, state };
  }
}

async function requestJson(url, timeoutMs = 1800) {
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.text();
    if (body.length > 16 * 1024 * 1024) return { reachable: true, ok: false, status: response.status, error: "Respons terlalu besar." };
    let data;
    try { data = JSON.parse(body); }
    catch { return { reachable: true, ok: false, status: response.status, error: "Respons bukan JSON." }; }
    return { reachable: true, ok: response.ok, status: response.status, data };
  } catch (error) {
    return { reachable: false, ok: false, error: String(error?.message || error).slice(0, 180) };
  }
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

async function waitForService(url, isReady, waitMs, shouldStop = () => false) {
  let result = await requestJson(url);
  if (waitMs <= 0 || (result.reachable && isReady(result.data, result)) || shouldStop()) return result;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (shouldStop()) break;
    await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
    result = await requestJson(url);
    if (result.reachable && isReady(result.data, result)) break;
    if (shouldStop()) break;
  }
  return result;
}

function processExitDetail(state) {
  if (!state) return "";
  const log = state.logPath ? " Log privat: " + state.logPath + "." : "";
  if (state.error) return " Gagal menjalankan proses: " + state.error + log;
  if (state.exitCode !== null) return " Proses berhenti dengan exit code " + state.exitCode + "; periksa kecocokan dependensi." + log;
  return (state.pid ? " Proses sudah dimulai (PID " + state.pid + "); service mungkin masih memuat model." : " Proses sudah diminta untuk berjalan; service mungkin masih memuat model.") + log;
}

function managedProcessStopped(name) {
  const state = MANAGED.get(name);
  return Boolean(state && (state.error || state.exitCode !== null));
}

function readVoxModelConfig(modelPath) {
  const configPath = join(modelPath, "config.json");
  if (!existsSync(configPath)) return { ok: false, detail: "Model VoxCPM2 belum ditemukan di " + modelPath + ". Unduh sekali dengan: hf download openbmb/VoxCPM2 --local-dir " + modelPath };
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (config.architecture !== "voxcpm2") return { ok: false, detail: "Folder model bukan VoxCPM2 (architecture harus voxcpm2): " + modelPath };
    return { ok: true };
  } catch {
    return { ok: false, detail: "config.json VoxCPM2 tidak valid di " + modelPath + "." };
  }
}

function detectPythonDevice(pythonPath, env) {
  const requested = String(env.VOXCPM_DEVICE || "").trim();
  if (requested && requested !== "auto") return requested;
  try {
    const result = spawnSync(pythonPath, ["-c", "import torch; print('cuda' if torch.cuda.is_available() else 'cpu')"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 12000, windowsHide: true
    });
    if (result.status === 0 && String(result.stdout || "").trim() === "cuda") return "cuda";
  } catch {}
  return "cpu";
}

async function inspectVoxCPM(config, env, waitMs, startAllowed = config.autoStart) {
  let endpoint;
  try { endpoint = localServiceUrl(config.voxUrl, "health"); }
  catch (error) {
    return { ready: false, reachable: false, detail: "URL VoxCPM2 tidak valid: " + error.message };
  }

  let probe = await requestJson(endpoint);
  let launch = null;
  if (!probe.reachable && startAllowed) {
    if (!existsSync(config.pythonPath) || !commandWorks(config.pythonPath)) {
      return {
        ready: false, reachable: false,
        detail: "Python virtualenv VoxCPM2 belum siap. Jalankan .remotion install untuk memasang Python, PyTorch, adapter, dan bobot model lokal."
      };
    }
    if (!existsSync(config.pythonServer)) {
      return { ready: false, reachable: false, detail: "Adapter VoxCPM2 tidak ditemukan: " + config.pythonServer };
    }
    const model = readVoxModelConfig(config.modelPath);
    if (!model.ok) return { ready: false, reachable: false, detail: model.detail + " Jalankan .remotion install untuk mengunduh model lokal." };

    const url = new URL(config.voxUrl);
    if (url.hostname !== "127.0.0.1") {
      return { ready: false, reachable: false, detail: "Autostart adapter VoxCPM2 hanya mendukung 127.0.0.1. Atur VIDEO_STUDIO_VOXCPM_URL=http://127.0.0.1:7861." };
    }
    const device = detectPythonDevice(config.pythonPath, env);
    launch = launchManaged("VoxCPM2", config.pythonPath, [config.pythonServer], buildLocalServiceEnvironment("voxcpm", env, {
      VOXCPM_MODEL_PATH: config.modelPath,
      VOXCPM_PORT: url.port || "7861",
      VOXCPM_DEVICE: device,
      HF_HUB_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      PYTHONUNBUFFERED: "1"
    }));
    if (launch.started || launch.alreadyManaged) {
      probe = await waitForService(endpoint, isVoxCPMReady, waitMs, () =>
        Boolean(launch?.state && (launch.state.error || launch.state.exitCode !== null))
      );
    }
  } else if (!probe.reachable && !startAllowed) {
    const pythonReady = existsSync(config.pythonPath) && commandWorks(config.pythonPath);
    const model = readVoxModelConfig(config.modelPath);
    return {
      ready: false, reachable: false,
      detail: !pythonReady
        ? "Python virtualenv VoxCPM2 belum terpasang. Gunakan .remotion install untuk memasang Python, PyTorch, dan adapter."
        : !model.ok
          ? model.detail + " Jalankan .remotion install untuk mengunduh model."
          : config.autoStart
            ? "Virtualenv dan bobot VoxCPM2 tersedia, tetapi adapter belum berjalan. Bot akan memulainya otomatis saat narasi dibutuhkan." + processExitDetail(MANAGED.get("VoxCPM2"))
            : "VoxCPM2 tidak merespons. Autostart dimatikan; jalankan adapter Python di video-studio/services/voxcpm/server.py." + processExitDetail(MANAGED.get("VoxCPM2"))
    };
  }

  // A previously launched adapter can bind its port before the model finishes loading.
  // Keep waiting for readiness instead of failing a render on the first HTTP 503.
  if (!launch && probe.reachable && probe.data?.provider === "VoxCPM2" &&
      !isVoxCPMReady(probe.data) && startAllowed && waitMs > 0) {
    probe = await waitForService(endpoint, isVoxCPMReady, waitMs);
  }

  if (isVoxCPMReady(probe.data)) {
    return { ready: true, reachable: true, detail: "VoxCPM2 aktif dan model sudah dimuat." };
  }
  if (probe.reachable && probe.data?.provider === "VoxCPM2") {
    return {
      ready: false, reachable: true, starting: true,
      detail: "Server VoxCPM2 merespons tetapi model belum siap. Tunggu proses pemuatan model, lalu cek .remotion services kembali." + processExitDetail(MANAGED.get("VoxCPM2")),
    };
  }
  if (probe.reachable) {
    return { ready: false, reachable: true, detail: "Endpoint merespons, tetapi bukan health response VoxCPM2 yang valid." };
  }
  return {
    ready: false, reachable: false,
    detail: "Service VoxCPM2 belum dapat dihubungi di " + config.voxUrl + "." + processExitDetail(launch?.state || MANAGED.get("VoxCPM2"))
  };
}

export async function startLocalVideoServices({ env = process.env, services = ["voxcpm"], waitMs = 0, start = true } = {}) {
  const config = getLocalVideoServiceConfig(env);
  const startAllowed = start && config.autoStart;
  const result = {};
  const tasks = [];
  if (services.includes("voxcpm")) tasks.push(inspectVoxCPM(config, env, waitMs, startAllowed).then(value => { result.voxcpm = value; }));
  await Promise.all(tasks);
  return result;
}