import { spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localServiceUrl } from "./local-service.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.ALVARETH_DATA_DIR ? resolve(process.env.ALVARETH_DATA_DIR) : join(homedir(), ".alvareth-bot-data");
const MANAGED = global.__alvarethVideoLocalServices || (global.__alvarethVideoLocalServices = new Map());
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_VOXCPM_URL = "http://127.0.0.1:7861";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";

export function getLocalVideoServiceConfig(env = process.env) {
  const ollamaUrl = String(env.VIDEO_STUDIO_OLLAMA_URL || DEFAULT_OLLAMA_URL).trim();
  const voxUrl = String(env.VIDEO_STUDIO_VOXCPM_URL || DEFAULT_VOXCPM_URL).trim();
  const modelPath = resolve(String(env.VOXCPM_MODEL_PATH || join(homedir(), "alvareth-models", "VoxCPM2")));
  const pythonPath = resolve(String(env.VIDEO_STUDIO_VOXCPM_PYTHON || join(ROOT, ".venv-voxcpm", "bin", "python")));
  return {
    ollamaUrl,
    ollamaModel: String(env.VIDEO_STUDIO_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim(),
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

export function buildLocalServiceEnvironment(kind, env = process.env, overrides = {}) {
  const specific = kind === "ollama"
    ? ["OLLAMA_MODELS", "OLLAMA_KEEP_ALIVE", "OLLAMA_NUM_PARALLEL", "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_FLASH_ATTENTION", "OLLAMA_KV_CACHE_TYPE", "OLLAMA_CONTEXT_LENGTH"]
    : ["TORCH_HOME", "HF_HOME", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE", "VOXCPM_VOICE_DESCRIPTION", "VOXCPM_ALIGNMENT_MODEL_PATH", "VOXCPM_ALIGNMENT_DEVICE"];
  const result = {};
  for (const key of [...COMMON_SERVICE_ENV, ...specific]) {
    if (env[key] !== undefined && env[key] !== "") result[key] = env[key];
  }
  if (!result.PATH && process.env.PATH) result.PATH = process.env.PATH;
  if (!result.HOME) result.HOME = homedir();
  return { ...result, ...overrides };
}

export function isOllamaModelReady(payload, model = DEFAULT_OLLAMA_MODEL) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return models.some(item => [item?.name, item?.model].some(name => String(name || "").trim() === model));
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

async function waitForService(url, isReady, waitMs) {
  let result = await requestJson(url);
  if (waitMs <= 0 || (result.reachable && isReady(result.data, result))) return result;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
    result = await requestJson(url);
    if (result.reachable && isReady(result.data, result)) break;
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

async function inspectOllama(config, env, waitMs) {
  let endpoint;
  try { endpoint = localServiceUrl(config.ollamaUrl, "api/tags"); }
  catch (error) {
    return { ready: false, reachable: false, model: config.ollamaModel, detail: "URL Ollama tidak valid: " + error.message };
  }

  let probe = await requestJson(endpoint);
  let launch = null;
  if (!probe.reachable && config.autoStart) {
    if (!commandWorks("ollama", ["--version"])) {
      return {
        ready: false, reachable: false, model: config.ollamaModel,
        detail: "Ollama tidak merespons dan binary ollama tidak ditemukan. Instal Ollama di Linux, lalu jalankan: ollama pull " + config.ollamaModel + "."
      };
    }
    const url = new URL(config.ollamaUrl);
    launch = launchManaged("Ollama", "ollama", ["serve"], buildLocalServiceEnvironment("ollama", env, {
      OLLAMA_HOST: url.host,
      OLLAMA_NO_CLOUD: "1"
    }));
    if (launch.started || launch.alreadyManaged) {
      probe = await waitForService(endpoint, data => Boolean(data), waitMs);
    }
  } else if (!probe.reachable && !config.autoStart) {
    return {
      ready: false, reachable: false, model: config.ollamaModel,
      detail: "Ollama tidak merespons. Autostart dimatikan; jalankan perintah ollama serve pada server."
    };
  }

  if (!probe.reachable) {
    return {
      ready: false, reachable: false, model: config.ollamaModel,
      detail: "Service Ollama belum dapat dihubungi di " + config.ollamaUrl + "." + processExitDetail(launch?.state)
    };
  }
  if (!probe.ok) {
    return {
      ready: false, reachable: true, model: config.ollamaModel,
      detail: "Ollama merespons HTTP " + probe.status + (probe.error ? ": " + probe.error : ".")
    };
  }
  if (!isOllamaModelReady(probe.data, config.ollamaModel)) {
    return {
      ready: false, reachable: true, model: config.ollamaModel,
      detail: "Ollama aktif, tetapi model " + config.ollamaModel + " belum tersedia. Jalankan sekali: ollama pull " + config.ollamaModel + "."
    };
  }
  return {
    ready: true, reachable: true, model: config.ollamaModel,
    detail: "Ollama aktif dan model " + config.ollamaModel + " siap digunakan."
  };
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

async function inspectVoxCPM(config, env, waitMs) {
  let endpoint;
  try { endpoint = localServiceUrl(config.voxUrl, "health"); }
  catch (error) {
    return { ready: false, reachable: false, detail: "URL VoxCPM2 tidak valid: " + error.message };
  }

  let probe = await requestJson(endpoint);
  let launch = null;
  if (!probe.reachable && config.autoStart) {
    if (!existsSync(config.pythonPath) || !commandWorks(config.pythonPath)) {
      return {
        ready: false, reachable: false,
        detail: "Python virtualenv VoxCPM2 belum siap. Buat .venv-voxcpm, pasang PyTorch yang sesuai GPU/CPU, lalu instal video-studio/services/voxcpm/requirements.txt."
      };
    }
    if (!existsSync(config.pythonServer)) {
      return { ready: false, reachable: false, detail: "Adapter VoxCPM2 tidak ditemukan: " + config.pythonServer };
    }
    const model = readVoxModelConfig(config.modelPath);
    if (!model.ok) return { ready: false, reachable: false, detail: model.detail };

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
      probe = await waitForService(endpoint, isVoxCPMReady, waitMs);
    }
  } else if (!probe.reachable && !config.autoStart) {
    return {
      ready: false, reachable: false,
      detail: "VoxCPM2 tidak merespons. Autostart dimatikan; jalankan adapter Python di video-studio/services/voxcpm/server.py."
    };
  }

  if (isVoxCPMReady(probe.data)) {
    return { ready: true, reachable: true, detail: "VoxCPM2 aktif dan model sudah dimuat." };
  }
  if (probe.reachable && probe.data?.provider === "VoxCPM2") {
    return {
      ready: false, reachable: true, starting: true,
      detail: "Server VoxCPM2 merespons tetapi model belum siap. Tunggu proses pemuatan model, lalu cek .remotion services kembali."
    };
  }
  if (probe.reachable) {
    return { ready: false, reachable: true, detail: "Endpoint merespons, tetapi bukan health response VoxCPM2 yang valid." };
  }
  return {
    ready: false, reachable: false,
    detail: "Service VoxCPM2 belum dapat dihubungi di " + config.voxUrl + "." + processExitDetail(launch?.state)
  };
}

export async function startLocalVideoServices({ env = process.env, services = ["ollama", "voxcpm"], waitMs = 0 } = {}) {
  const config = getLocalVideoServiceConfig(env);
  const result = {};
  const tasks = [];
  if (services.includes("ollama")) tasks.push(inspectOllama(config, env, waitMs).then(value => { result.ollama = value; }));
  if (services.includes("voxcpm")) tasks.push(inspectVoxCPM(config, env, waitMs).then(value => { result.voxcpm = value; }));
  await Promise.all(tasks);
  return result;
}
