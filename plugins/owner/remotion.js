import { startLocalVideoServices, getLocalVideoServiceConfig } from "../../video-studio/local-services.js";
import { localJson, localServiceUrl } from "../../video-studio/local-service.js";
import { validateReviewedWorkflow } from "../../video-studio/media/comfyui.js";
import { readVideoStudioInstallerStatus, startVideoStudioInstaller } from "../../video-studio/installer.js";
import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, freemem, homedir, platform, totalmem } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseStoryboardInput } from "../../video-studio/prompt/storyboard.js";
import { getVoiceSettings, updateVoiceSettings, EDGE_TTS_VOICES, VOXCPM_STYLES } from "../../video-studio/voice-settings.js";
import { compileVideoPlan } from "../../video-studio/prompt/compile.js";
import {
  startVideoQueue,
  createVideoJob,
  getVideoJob,
  getVideoOutput,
  listVideoJobs
} from "../../video-studio/queue.js";
import {
  sendLocalFile,
  describeWhatsAppUploadError
} from "../../lib/whatsapp-file-sender.js";
import { wasBotSentMessage } from "../../lib/auto-download.js";
import {
  parseRemotionCommand,
  formatRemotionJob,
  remotionStageLabel,
  getRemotionProviderReadiness
} from "../../video-studio/whatsapp.js";

const MAX_PROMPT_CHARS = 24000;
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 6000;
const sessions = global.__alvarethRemotionSessions || (global.__alvarethRemotionSessions = new Map());
const watchers = global.__alvarethRemotionWatchers || (global.__alvarethRemotionWatchers = new Set());

startVideoQueue();

const preparing = global.__alvarethRemotionPreparing || (global.__alvarethRemotionPreparing = new Set());

function positiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function sendText(chat, text, fallbackConn) {
  const socket = global.conn || fallbackConn;
  if (!socket || typeof socket.sendMessage !== "function" || !chat) return Promise.resolve(null);
  return socket.sendMessage(chat, { text: String(text || "") }).catch(error => {
    console.warn("[REMOTION:WA] Gagal mengirim notifikasi WhatsApp:", error?.message || error);
    return null;
  });
}

function hasCommandPrefix(value, prefix) {
  const candidates = Array.isArray(prefix) ? prefix : [prefix];
  return candidates.some(candidate => {
    if (candidate instanceof RegExp) {
      try {
        const regex = new RegExp(candidate.source, candidate.flags.replace(/[gy]/g, ""));
        return regex.test(value);
      } catch { return false; }
    }
    return typeof candidate === "string" && candidate.length > 0 && value.startsWith(candidate);
  });
}

function hasBinary(name) {
  try {
    return spawnSync(name, ["-version"], {
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true
    }).status === 0;
  } catch {
    return false;
  }
}

function resolveEdgeTtsPythonPath() {
  const custom = String(process.env.VIDEO_STUDIO_EDGE_TTS_PYTHON || "").trim();
  if (custom) return custom;
  const edgeVenvPython = join(process.cwd(), ".venv-edge-tts", "bin", "python");
  return existsSync(edgeVenvPython) ? edgeVenvPython : getLocalVideoServiceConfig().pythonPath;
}

function providerReadiness() {
  const rendererInstalled =
    existsSync(join(process.cwd(), "node_modules", "@remotion", "renderer", "package.json")) &&
    existsSync(join(process.cwd(), "node_modules", "remotion", "package.json"));
  const ffmpegInstalled = hasBinary("ffmpeg") && hasBinary("ffprobe");
  const approvedHashes = String(process.env.VIDEO_STUDIO_COMFYUI_REVIEWED_SHA256 || "");
  const voiceConfig = getLocalVideoServiceConfig();
  const voxCPMInstalled = existsSync(voiceConfig.pythonPath) && existsSync(join(voiceConfig.modelPath, "config.json"));
  const edgePython = resolveEdgeTtsPythonPath();
  let edgeTtsInstalled = false;
  try {
    edgeTtsInstalled = spawnSync(edgePython, ["-c", "import edge_tts"], { stdio: "ignore", timeout: 8000, windowsHide: true }).status === 0;
  } catch {}
  const workflowCheck = path => {
    const content = readFileSync(path, "utf8");
    validateReviewedWorkflow(content, approvedHashes);
    return { configured: true, detail: "Workflow API JSON ditemukan dan SHA-256 disetujui." };
  };
  const referenceWorkflowCheck = (_imagePath, videoPath) => {
    const videoContent = readFileSync(videoPath, "utf8");
    if (!videoContent.includes("{{REFERENCE_IMAGE}}")) {
      return { configured: false, detail: "Workflow video belum memakai placeholder {{REFERENCE_IMAGE}}." };
    }
    return { configured: true, detail: "Workflow image dan video lolos pemeriksaan SHA-256; placeholder {{REFERENCE_IMAGE}} tersedia." };
  };
  return getRemotionProviderReadiness(
    process.env,
    path => existsSync(path),
    { remotionInstalled: rendererInstalled, ffmpegInstalled, workflowCheck, referenceWorkflowCheck, edgeTtsInstalled, voxCPMInstalled, voiceSettings: getVoiceSettings() }
  );
}

async function sendNativeMenu(m, conn, { title, description, sections, fallback }) {
  if (!conn || typeof conn.sendMessage !== "function") return m.reply(fallback);
  try {
    await conn.sendMessage(m.chat, {
      text: [
        "🎬 *ALVARETH REMOTION VIDEO STUDIO*",
        "",
        description,
        "",
        "🔒 Akses dibatasi untuk owner.",
        "Pilih tindakan di bawah ini."
      ].join("\n"),
      footer: "Alvareth Bot • Linux Remotion Engine",
      optionText: "Pilih fitur",
      optionTitle: title,
      nativeFlow: [{
        text: title,
        sections,
        icon: "document"
      }],
      interactiveAsTemplate: false
    }, { quoted: m });
  } catch (error) {
    console.warn("[REMOTION] Menu interaktif gagal; memakai fallback teks:", error?.message || error);
    await m.reply(fallback);
  }
}

function remotionMenuRow(usedPrefix, title, description, command = "") {
  return {
    header: "",
    title,
    description,
    id: usedPrefix + "remotion" + (command ? " " + command : "")
  };
}

async function showHardware(m) {
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model || "Tidak terdeteksi";
  const totalRam = (totalmem() / (1024 ** 3)).toFixed(1);
  const freeRam = (freemem() / (1024 ** 3)).toFixed(1);

  let disk = "Tidak dapat dibaca";
  const diskResult = spawnSync("df", ["-hP", process.cwd()], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true
  });
  if (diskResult.status === 0) {
    const lines = String(diskResult.stdout || "").trim().split(/\r?\n/);
    const columns = String(lines.at(-1) || "").trim().split(/\s+/);
    if (columns.length >= 6) {
      disk = columns[3] + " tersedia dari " + columns[1] + " (" + columns[4] + " terpakai)";
    }
  }

  let gpu = "";
  const nvidia = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true
  });
  if (nvidia.status === 0 && String(nvidia.stdout || "").trim()) {
    gpu = "NVIDIA terdeteksi: " + String(nvidia.stdout).trim().split(/\r?\n/).join("; ");
  } else {
    const pci = spawnSync("lspci", [], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true
    });
    const displayDevices = pci.status === 0
      ? String(pci.stdout || "").split(/\r?\n/).filter(line => /(VGA compatible controller|3D controller|Display controller)/i.test(line))
      : [];
    gpu = displayDevices.length
      ? "Perangkat grafis PCI: " + displayDevices.join("; ") + ". Belum tentu mendukung CUDA/NVIDIA."
      : "NVIDIA GPU belum terdeteksi melalui nvidia-smi. GPU lain atau GPU passthrough belum dapat dipastikan.";
  }

  return m.reply([
    "🖥️ *SPESIFIKASI SERVER REMOTION*",
    "",
    "*CPU:* " + cpuModel,
    "*Logical CPU:* " + cpuList.length + " thread",
    "*RAM:* " + totalRam + " GB total • " + freeRam + " GB tersedia saat ini",
    "*Storage:* " + disk,
    "*GPU:* " + gpu,
    "*OS / Arsitektur:* " + platform() + " / " + arch(),
    "",
    "Catatan: kapasitas RAM dan storage tidak membuktikan adanya GPU. Installer GPU membutuhkan NVIDIA yang terlihat oleh nvidia-smi; jika tidak terdeteksi, pilih mode CPU secara sadar."
  ].join("\n"));
}

async function showMenu(m, conn, usedPrefix = ".") {
  const sections = [
    {
      title: "Produksi video",
      rows: [
        remotionMenuRow(usedPrefix, "🎬 Buat video", "Tempel storyboard JSON dari model AI pilihan kamu.", "generate"),
        remotionMenuRow(usedPrefix, "📊 Status render", "Lihat antrean dan progres.", "status"),
        remotionMenuRow(usedPrefix, "📁 Riwayat video", "Lihat pekerjaan dan ID hasil.", "history"),
        remotionMenuRow(usedPrefix, "📤 Kirim MP4 terakhir", "Kirim ulang hasil yang selesai.", "send"),
        remotionMenuRow(usedPrefix, "🧠 Panduan prompt", "Panduan membuat JSON storyboard dengan model AI pilihan kamu.", "guide"),
        remotionMenuRow(usedPrefix, "✖️ Batalkan input", "Batalkan sesi prompt yang menunggu.", "cancel")
      ]
    },
    {
      title: "Engine & layanan lokal",
      rows: [
        remotionMenuRow(usedPrefix, "⚙️ Kelola layanan", "Cek Edge TTS online, VoxCPM2, dan layanan video.", "services-menu"),
        remotionMenuRow(usedPrefix, "⬇️ Instalasi engine", "Pilih GPU otomatis, CPU, atau cek progres.", "install-menu"),
        remotionMenuRow(usedPrefix, "🖥️ Spesifikasi server", "Periksa CPU, RAM, storage, dan GPU.", "hardware"),
        remotionMenuRow(usedPrefix, "🗣️ Pengaturan voice", "Pilih provider, suara, kecepatan, pitch, dan karakter narator.", "voice")
      ]
    }
  ];

  const fallback = [
    "🎬 *REMOTION VIDEO STUDIO*",
    "",
    "*Produksi:*",
    "• " + usedPrefix + "remotion generate",
    "• " + usedPrefix + "remotion status",
    "• " + usedPrefix + "remotion history",
    "• " + usedPrefix + "remotion send [ID]",
    "• " + usedPrefix + "remotion guide",
    "• " + usedPrefix + "remotion cancel",
    "",
    "• " + usedPrefix + "remotion hardware",
    "• " + usedPrefix + "remotion voice",
    "",
    "*Layanan:*",
    "• " + usedPrefix + "remotion services",
    "• " + usedPrefix + "remotion services start voice",
    "",
    "*Instalasi:*",
    "• " + usedPrefix + "remotion install",
    "• " + usedPrefix + "remotion install cpu",
    "• " + usedPrefix + "remotion install status"
  ].join("\n");

  return sendNativeMenu(m, conn, {
    title: "Remotion Video Studio",
    description: "Akses produksi video, riwayat, pengiriman MP4, layanan lokal, diagnostik server, dan instalasi engine dari satu menu.",
    sections,
    fallback
  });
}

async function showServicesMenu(m, conn, usedPrefix = ".") {
  const sections = [{
    title: "Layanan lokal",
    rows: [
      remotionMenuRow(usedPrefix, "🔎 Periksa semua layanan", "Cek Edge TTS, VoxCPM2, ComfyUI dan workflow.", "services"),
      remotionMenuRow(usedPrefix, "🗣️ Mulai VoxCPM2", "Aktifkan voice-over lokal dan tunggu model siap.", "services start voice"),
      remotionMenuRow(usedPrefix, "↩️ Kembali ke menu", "Kembali ke menu utama Remotion.")
    ]
  }];
  const fallback = [
    "⚙️ *LAYANAN REMOTION*",
    "• " + usedPrefix + "remotion services",
    "• " + usedPrefix + "remotion services start voice",
    "• " + usedPrefix + "remotion"
  ].join("\n");
  return sendNativeMenu(m, conn, {
    title: "Layanan lokal",
    description: "Periksa Edge TTS online atau nyalakan VoxCPM2 jika provider lokal dipilih.",
    sections,
    fallback
  });
}
async function showVoiceMenu(m, conn, usedPrefix = ".", notice = "") {
  const settings = getVoiceSettings();
  const edgeReady = providerReadiness().find(item => item.name === "Edge TTS online")?.configured === true;
  const providerLabel = settings.provider === "edge-tts" ? "Edge TTS online (gratis)" : "VoxCPM2 lokal";
  const voiceLabel = EDGE_TTS_VOICES[settings.voice] || settings.voice;
  const styleLabel = settings.voxStyle || "warm";
  const sections = [
    {
      title: "Provider / model",
      rows: [
        remotionMenuRow(usedPrefix, "☁️ Edge TTS online", "Microsoft Neural voice, gratis, tanpa model GPU.", "voice provider edge-tts"),
        remotionMenuRow(usedPrefix, "🖥️ VoxCPM2 lokal", "Model lokal 2B; dapat lambat pada CPU.", "voice provider voxcpm2"),
        remotionMenuRow(usedPrefix, "⬇️ Pasang Edge TTS", "Instal adapter ringan tanpa mengunduh model suara.", "voice install")
      ]
    },
    {
      title: "Suara Bahasa Indonesia",
      rows: [
        remotionMenuRow(usedPrefix, "👩 Gadis Neural", "Suara perempuan Indonesia.", "voice model id-ID-GadisNeural"),
        remotionMenuRow(usedPrefix, "👨 Ardi Neural", "Suara laki-laki Indonesia.", "voice model id-ID-ArdiNeural")
      ]
    },
    {
      title: "Kecepatan narasi",
      rows: [
        remotionMenuRow(usedPrefix, "🐢 Lebih lambat (-10%)", "Tempo lebih santai.", "voice rate -10%"),
        remotionMenuRow(usedPrefix, "⏺️ Normal", "Kecepatan standar.", "voice rate +0%"),
        remotionMenuRow(usedPrefix, "⚡ Lebih cepat (+10%)", "Tempo lebih cepat.", "voice rate +10%")
      ]
    },
    {
      title: "Pitch suara",
      rows: [
        remotionMenuRow(usedPrefix, "Pitch rendah (-10 Hz)", "Nada suara lebih rendah.", "voice pitch -10Hz"),
        remotionMenuRow(usedPrefix, "Pitch normal", "Nada suara standar.", "voice pitch +0Hz"),
        remotionMenuRow(usedPrefix, "Pitch tinggi (+10 Hz)", "Nada suara lebih tinggi.", "voice pitch +10Hz")
      ]
    },
    {
      title: "Volume narator",
      rows: [
        remotionMenuRow(usedPrefix, "Volume rendah (-10%)", "Kurangi volume suara.", "voice volume -10%"),
        remotionMenuRow(usedPrefix, "Volume normal", "Volume standar.", "voice volume +0%"),
        remotionMenuRow(usedPrefix, "Volume tinggi (+10%)", "Naikkan volume suara.", "voice volume +10%")
      ]
    },
    {
      title: "Karakter narator VoxCPM2",
      rows: [
        remotionMenuRow(usedPrefix, "Natural", "Artikulasi jelas dan natural.", "voice style natural"),
        remotionMenuRow(usedPrefix, "Warm", "Hangat dan bersahabat.", "voice style warm"),
        remotionMenuRow(usedPrefix, "Energetic", "Lebih hidup dan ekspresif.", "voice style energetic"),
        remotionMenuRow(usedPrefix, "Calm", "Tenang dan lembut.", "voice style calm"),
        remotionMenuRow(usedPrefix, "Storytelling", "Intonasi penceritaan lebih ekspresif.", "voice style storytelling")
      ]
    }
  ];
  const description = [
    notice,
    "Provider aktif: " + providerLabel,
    "Voice: " + voiceLabel,
    "Kecepatan: " + settings.rate + " • Pitch: " + settings.pitch + " • Volume: " + settings.volume,
    "Karakter VoxCPM2: " + styleLabel,
    "Status Edge TTS: " + (edgeReady ? "siap" : "belum terpasang; pilih Pasang Edge TTS"),
    "Pengaturan berlaku untuk video baru; job yang sudah masuk antrean tidak berubah."
  ].filter(Boolean).join("\n");
  const fallback = [
    "🗣️ *PENGATURAN VOICE REMOTION*",
    description,
    "",
    "• " + usedPrefix + "remotion voice provider edge-tts",
    "• " + usedPrefix + "remotion voice provider voxcpm2",
    "• " + usedPrefix + "remotion voice model id-ID-GadisNeural",
    "• " + usedPrefix + "remotion voice model id-ID-ArdiNeural",
    "• " + usedPrefix + "remotion voice rate +10%",
    "• " + usedPrefix + "remotion voice pitch +10Hz",
    "• " + usedPrefix + "remotion voice volume +10%",
    "• " + usedPrefix + "remotion voice install",
    "• " + usedPrefix + "remotion voice reset"
  ].join("\n");
  return sendNativeMenu(m, conn, {
    title: "Pengaturan voice",
    description,
    sections,
    fallback
  });
}

async function installEdgeTts(m) {
  const config = getLocalVideoServiceConfig();
  const home = String(process.env.HOME || homedir());
  const localUv = join(home, ".local", "bin", "uv");
  const uvProbe = spawnSync("uv", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, windowsHide: true });
  const uv = uvProbe.status === 0 ? "uv" : localUv;
  const useUv = uvProbe.status === 0 || existsSync(localUv);
  const edgeVenv = join(process.cwd(), ".venv-edge-tts");
  const edgePython = join(edgeVenv, "bin", "python");
  let pythonPath = existsSync(edgePython) ? edgePython : config.pythonPath;

  if (!existsSync(pythonPath) && useUv) {
    const pythonInstall = spawnSync(uv, ["python", "install", "3.11"], {
      encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
    });
    if (pythonInstall.error || pythonInstall.status !== 0) {
      return m.reply("❌ Python ringan untuk Edge TTS gagal disiapkan:\n" + String(pythonInstall.stderr || pythonInstall.stdout || pythonInstall.error?.message || "").slice(-1000));
    }
    const venvCreate = spawnSync(uv, ["venv", "--python", "3.11", edgeVenv], {
      encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true
    });
    if (venvCreate.error || venvCreate.status !== 0) {
      return m.reply("❌ Virtualenv Edge TTS gagal dibuat:\n" + String(venvCreate.stderr || venvCreate.stdout || venvCreate.error?.message || "").slice(-1000));
    }
    pythonPath = edgePython;
  }
  if (!existsSync(pythonPath)) {
    return m.reply("Python belum tersedia. Edge TTS bisa memakai virtualenv ringan tanpa GPU, tetapi binary uv belum ditemukan. Jalankan .remotion install untuk memasang uv, lalu ulangi .remotion voice install.");
  }

  const result = useUv
    ? spawnSync(uv, ["pip", "install", "--python", pythonPath, "edge-tts==7.3.1"], {
        encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
      })
    : spawnSync(pythonPath, ["-m", "pip", "install", "edge-tts==7.3.1"], {
        encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
      });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "installer gagal").slice(-1200);
    return m.reply("❌ Instalasi Edge TTS gagal:\n" + detail);
  }
  const check = spawnSync(pythonPath, ["-c", "import edge_tts; print(getattr(edge_tts, '__version__', 'ready'))"], {
    encoding: "utf8", timeout: 10000, windowsHide: true
  });
  if (check.status !== 0) return m.reply("❌ Paket terpasang tetapi pemeriksaan import Edge TTS gagal:\n" + String(check.stderr || "").slice(-800));
  return m.reply(
    "✅ *Edge TTS siap digunakan.*\nVersi: " + String(check.stdout || "ready").trim() +
    "\nVirtualenv: " + pythonPath +
    "\nProvider ini memakai layanan suara online, tidak memerlukan model GPU atau API key. Pilih .remotion voice provider edge-tts."
  );
}

async function handleVoiceCommand(m, conn, usedPrefix = ".", argument = "") {
  const parts = String(argument || "").trim().split(/\s+/).filter(Boolean);
  const key = String(parts[0] || "").toLowerCase();
  const value = parts.slice(1).join(" ").trim();
  if (!key) return showVoiceMenu(m, conn, usedPrefix);
  if (key === "install") return installEdgeTts(m);
  if (key === "reset") {
    updateVoiceSettings({
      provider: "edge-tts",
      voice: "id-ID-GadisNeural",
      rate: "+0%",
      pitch: "+0Hz",
      volume: "+0%",
      voxStyle: "warm"
    });
    return showVoiceMenu(m, conn, usedPrefix, "✅ Pengaturan voice dikembalikan ke default.");
  }
  let patch;
  if (key === "provider" && ["edge-tts", "voxcpm2"].includes(value)) patch = { provider: value };
  else if (key === "model" && Object.hasOwn(EDGE_TTS_VOICES, value)) patch = { voice: value };
  else if (key === "style" && Object.hasOwn(VOXCPM_STYLES, value)) patch = { voxStyle: value };
  else if (key === "rate" && /^[+-]\d{1,2}%$/.test(value)) patch = { rate: value };
  else if (key === "pitch" && /^[+-]\d{1,2}Hz$/i.test(value)) patch = { pitch: value };
  else if (key === "volume" && /^[+-]\d{1,2}%$/.test(value)) patch = { volume: value };
  else {
    return m.reply(
      "Format pengaturan voice:\n" +
      "• .remotion voice\n" +
      "• .remotion voice provider edge-tts|voxcpm2\n" +
      "• .remotion voice model id-ID-GadisNeural|id-ID-ArdiNeural\n" +
      "• .remotion voice rate +10%|-10%|+0%\n" +
      "• .remotion voice pitch +10Hz|-10Hz|+0Hz\n" +
      "• .remotion voice volume +10%|-10%|+0%\n" +
      "• .remotion voice style natural|warm|energetic|calm|storytelling\n" +
      "• .remotion voice install|reset"
    );
  }
  const updated = updateVoiceSettings(patch);
  return showVoiceMenu(m, conn, usedPrefix, "✅ Pengaturan diperbarui. Provider aktif: " + updated.provider + ".");
}

async function showInstallMenu(m, conn, usedPrefix = ".") {
  const sections = [{
    title: "Instalasi engine lokal",
    rows: [
      remotionMenuRow(usedPrefix, "🚀 Instal otomatis (GPU)", "Gunakan GPU NVIDIA jika terdeteksi.", "install"),
      remotionMenuRow(usedPrefix, "🐢 Instal mode CPU", "Paksa instalasi CPU; proses inferensi lebih lambat.", "install cpu"),
      remotionMenuRow(usedPrefix, "📋 Status instalasi", "Lihat progres, exit code, dan log installer.", "install status"),
      remotionMenuRow(usedPrefix, "↩️ Kembali ke menu", "Kembali ke menu utama Remotion.")
    ]
  }];
  const fallback = [
    "⬇️ *INSTALASI REMOTION*",
    "• " + usedPrefix + "remotion install",
    "• " + usedPrefix + "remotion install cpu",
    "• " + usedPrefix + "remotion install status",
    "• " + usedPrefix + "remotion"
  ].join("\n");
  return sendNativeMenu(m, conn, {
    title: "Instalasi engine",
    description: "Pilih instalasi otomatis dengan deteksi GPU NVIDIA, mode CPU secara eksplisit, atau pemeriksaan progres.",
    sections,
    fallback
  });
}
function activeJobs() {
  return listVideoJobs(30).filter(job => ["queued", "rendering"].includes(job.status));
}

async function startPromptJob(prompt, chat, fallbackConn) {
  const cleanPrompt = String(prompt || "").trim();
  if (cleanPrompt.length < 8) {
    await sendText(chat, "JSON storyboard terlalu singkat. Tempel objek JSON lengkap dari model AI pilihan kamu.", fallbackConn);
    return;
  }
  if (cleanPrompt.length > MAX_PROMPT_CHARS) {
    await sendText(chat, "JSON storyboard maksimal " + MAX_PROMPT_CHARS + " karakter. Minta model AI membuat output yang lebih ringkas.", fallbackConn);
    return;
  }

  const maxActive = positiveInt(process.env.VIDEO_STUDIO_WA_MAX_ACTIVE_JOBS, 2, 1, 5);
  if (preparing.size) return sendText(chat, "Storyboard lain sedang divalidasi. Tunggu proses sebelumnya selesai.", fallbackConn);
  const currentJobs = activeJobs();
  if (currentJobs.length >= maxActive) {
    await sendText(
      chat,
      "⏳ Antrean video sedang penuh (" + currentJobs.length + "/" + maxActive + ").\n" +
      "Tunggu pekerjaan sebelumnya selesai, lalu ketik .remotion status.",
      fallbackConn
    );
    return;
  }

  preparing.add(chat);
  await sendText(
    chat,
    "🧩 *Memeriksa storyboard dari model AI pilihan kamu*\n" +
    "Memvalidasi struktur JSON, scene, durasi narasi, visual, dan batas render.\n" +
    "Setelah lolos validasi, video langsung masuk antrean produksi.",
    fallbackConn
  );

  try {
    // Storyboard JSON is supplied by the operator; the selected TTS provider starts only during media preparation.
    const plan = parseStoryboardInput(cleanPrompt);
    const project = compileVideoPlan(plan);
    project.voiceSettings = getVoiceSettings();
    const job = createVideoJob(project);
    ensureJobWatcher(job.id, chat, fallbackConn);

    await sendText(
      chat,
      "✅ *Storyboard siap dan masuk antrean render*\n" +
      "Judul: " + job.title + "\n" +
      "Durasi: " + job.durationSeconds + " detik\n" +
      "Scene: " + job.sceneCount + "\n" +
      "Format: " + job.ratio + " • " + (plan.fps || 30) + " FPS\n" +
      "ID: " + job.id + "\n\n" +
      "Bot akan mengirim MP4 setelah rendering selesai. Cek kapan saja dengan .remotion status.",
      fallbackConn
    );
    console.log("[REMOTION:WA] Job dibuat:", job.id, "| scenes=" + job.sceneCount + "| ratio=" + job.ratio);
  } catch (error) {
    console.error("[REMOTION:WA] Gagal membuat pekerjaan:", error?.stack || error);
    await sendText(
      chat,
      "❌ *Video belum dapat diproses*\n" +
      String(error?.message || error).slice(0, 900) +
      "\n\nPastikan JSON mengikuti prompt-remotion.md. Jika storyboard valid tetapi audio atau footage gagal, cek .remotion services.",
      fallbackConn
    );
  } finally {
    preparing.delete(chat);
  }
}

function ensureJobWatcher(jobId, chat, fallbackConn) {
  if (watchers.has(jobId)) return;
  watchers.add(jobId);
  void watchJob(jobId, chat, fallbackConn)
    .catch(error => {
      console.error("[REMOTION:WA] Watcher gagal:", jobId, error?.stack || error);
      return sendText(chat, "⚠️ Pemantauan job " + jobId + " terhenti. Cek kembali dengan .remotion status.", fallbackConn);
    })
    .finally(() => watchers.delete(jobId));
}

async function watchJob(jobId, chat, fallbackConn) {
  const pollInterval = positiveInt(process.env.VIDEO_STUDIO_WA_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, 3000, 30000);
  let lastStage = "";
  let lastProgressMark = 0;

  // Monitoring has no deadline: keep notifying until the render completes or fails.
  while (true) {
    const job = getVideoJob(jobId);
    if (!job) {
      await sendText(chat, "⚠️ Job " + jobId + " tidak ditemukan dalam riwayat render.", fallbackConn);
      return;
    }

    if (job.status === "failed") {
      await sendText(
        chat,
        "❌ *Rendering gagal*\n" +
        "Judul: " + job.title + "\n" +
        "Tahap: " + remotionStageLabel(job.stage) + "\n" +
        "Detail: " + String(job.error || "Kesalahan tidak diketahui").slice(0, 700) +
        "\n\nPerbaiki provider/server lalu buat ulang dengan prompt yang sama.",
        fallbackConn
      );
      return;
    }

    if (job.status === "completed") {
      const output = getVideoOutput(jobId);
      if (!output?.path) {
        await sendText(chat, "⚠️ Render selesai, tetapi file MP4 tidak ditemukan. ID: " + jobId, fallbackConn);
        return;
      }

      const warnings = Array.isArray(job.mediaWarnings) ? job.mediaWarnings.slice(0, 2) : [];
      const caption = [
        "🎬 *VIDEO SELESAI DIBUAT*",
        "Judul: " + job.title,
        "Durasi: " + job.durationSeconds + " detik",
        "AI footage: " + (Number(job.aiFootageCount) || 0) + " scene",
        "Voice-over: " + (job.voiceoverEnabled ? "aktif" : "tidak aktif"),
        job.voiceoverEnabled ? "Model suara: " + (job.voiceModel || "TTS") + " • " + (job.voiceName || "-") : "",
        "Musik AI: " + (job.aiMusicEnabled ? "aktif" : "tidak aktif"),
        "ID: " + jobId,
        warnings.length ? "Catatan: " + warnings.join(" | ").slice(0, 500) : ""
      ].filter(Boolean).join("\n");

      try {
        await sendLocalFile(global.conn || fallbackConn, chat, output.path, {
          mimetype: "video/mp4",
          caption,
          jobId
        });
        console.log("[REMOTION:WA] MP4 terkirim:", jobId);
      } catch (error) {
        console.error("[REMOTION:WA] Upload MP4 gagal:", error?.stack || error);
        await sendText(
          chat,
          "⚠️ MP4 berhasil dirender, tetapi gagal dikirim ke WhatsApp.\n" +
          describeWhatsAppUploadError(error) +
          "\n\nFile tetap tersimpan. Coba lagi dengan .remotion send " + jobId + ".",
          fallbackConn
        );
      }
      return;
    }

    const stage = String(job.stage || job.status || "");
    if (stage !== lastStage) {
      lastStage = stage;
      lastProgressMark = 0;
      await sendText(
        chat,
        "🎞️ *" + remotionStageLabel(stage) + "*\n" +
        "Video: " + job.title + "\nID: " + jobId,
        fallbackConn
      ).catch(() => {});
    } else if (stage === "rendering") {
      const mark = Math.floor((Number(job.progress) || 0) / 20) * 20;
      if (mark >= 20 && mark > lastProgressMark) {
        lastProgressMark = mark;
        await sendText(chat, "⏳ Rendering " + job.title + ": " + mark + "%", fallbackConn).catch(() => {});
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

async function sendCompletedJob(m, conn, requestedId = "") {
  const jobs = listVideoJobs(50);
  const job = requestedId
    ? jobs.find(item => item.id === requestedId)
    : jobs.find(item => item.status === "completed" && item.hasOutput);

  if (!job || job.status !== "completed") {
    return m.reply("Tidak ada hasil MP4 selesai yang cocok. Lihat daftar dengan .remotion history.");
  }

  const output = getVideoOutput(job.id);
  if (!output?.path) return m.reply("File hasil tidak tersedia lagi untuk job " + job.id + ".");

  try {
    await sendLocalFile(conn, m.chat, output.path, {
      mimetype: "video/mp4",
      caption: "🎬 *HASIL REMOTION*\n" + job.title + "\nID: " + job.id,
      jobId: job.id
    });
  } catch (error) {
    await m.reply("Gagal mengirim MP4:\n" + describeWhatsAppUploadError(error));
  }
}

async function showStatus(m, conn) {
  const jobs = listVideoJobs(20);
  const active = jobs.filter(job => ["queued", "rendering"].includes(job.status));
  if (active.length) {
    for (const job of active) ensureJobWatcher(job.id, m.chat, conn);
    return m.reply("📊 *STATUS REMOTION*\n\n" + active.map(formatRemotionJob).join("\n\n"));
  }
  if (!jobs.length) return m.reply("Belum ada pekerjaan video. Ketik .remotion untuk membuka menu.");
  return m.reply("Tidak ada render aktif.\n\n*Pekerjaan terakhir:*\n" + formatRemotionJob(jobs[0]));
}

async function showHistory(m) {
  const jobs = listVideoJobs(10);
  if (!jobs.length) return m.reply("Riwayat video masih kosong.");
  const statusLabels = { queued: "Antrean", rendering: "Render", completed: "Selesai", failed: "Gagal" };
  const lines = jobs.map((job, index) => [
    (index + 1) + ". *" + String(job.title || "Video tanpa judul") + "*",
    "   " + (statusLabels[job.status] || job.status) + " • " + job.durationSeconds + " detik • " + job.ratio,
    "   ID: " + job.id
  ].join("\n"));
  return m.reply("📁 *RIWAYAT VIDEO REMOTION*\n\n" + lines.join("\n\n") + "\n\nKirim ulang hasil: .remotion send ID");
}


function formatInstallerStatus(status) {
  if (status.status === "running") {
    return "⏳ *INSTALLER SEDANG BERJALAN*\nPID: " + (status.pid || "-") + "\nCek lagi dengan .remotion install status.";
  }
  if (status.status === "completed") {
    return "✅ *INSTALLER SELESAI*\nRuntime dan bobot model berhasil disiapkan. Lanjutkan dengan .remotion services.";
  }
  if (status.status === "failed") {
    return "❌ *INSTALLER GAGAL*\nExit code: " + status.exitCode + "\nPeriksa log terakhir di bawah.";
  }
  if (status.status === "interrupted") {
    return "⚠️ *STATUS INSTALLER TIDAK PASTI*\nLock tersisa tetapi proses tidak terdeteksi. Jalankan .remotion install lagi; script akan membersihkan lock usang.";
  }
  return "Belum ada proses instalasi. Jalankan .remotion install untuk GPU atau .remotion install cpu untuk mode CPU.";
}

async function showInstallerStatus(m) {
  const status = readVideoStudioInstallerStatus();
  const tail = status.logTail
    ? "\n\n*Log terakhir:*\n" + status.logTail.split(/\r?\n/).slice(-12).join("\n").slice(-2200)
    : "";
  return m.reply(formatInstallerStatus(status) + tail);
}

async function installLocalEngine(m, conn, argument = "") {
  const option = String(argument || "").trim().toLowerCase();
  if (option === "status") return showInstallerStatus(m);
  if (option && option !== "cpu") {
    return m.reply(
      "Perintah instalasi:\n" +
      "• .remotion install — otomatis memakai GPU NVIDIA yang terdeteksi\n" +
      "• .remotion install cpu — paksa jalur CPU (lebih lambat)\n" +
      "• .remotion install status — lihat proses dan log terakhir"
    );
  }

  const voxUrl = String(process.env.VIDEO_STUDIO_VOXCPM_URL || "http://127.0.0.1:7861").trim();
  if (voxUrl !== "http://127.0.0.1:7861") {
    return m.reply(
      "Installer otomatis menyiapkan endpoint VoxCPM2 lokal default http://127.0.0.1:7861. " +
      "VIDEO_STUDIO_VOXCPM_URL kamu berbeda; sesuaikan endpoint atau siapkan service secara manual."
    );
  }

  const mode = option === "cpu" ? "cpu" : "gpu";
  const result = startVideoStudioInstaller({
    mode,
    onExit: code => {
      void sendText(
        m.chat,
        code === 0
          ? "✅ *Pemasangan engine lokal selesai.*\nKetik .remotion services untuk pemeriksaan, lalu coba buat video. Pemanggilan pertama VoxCPM2 dapat memerlukan waktu untuk memuat model."
          : "❌ *Pemasangan engine lokal berhenti dengan error (exit " + code + ").*\nKetik .remotion install status untuk melihat log terakhir.",
        conn
      );
    },
    onError: error => {
      void sendText(m.chat, "❌ Installer tidak dapat dijalankan: " + String(error?.message || error).slice(0, 300), conn);
    }
  });

  if (result.alreadyRunning) {
    return m.reply("⏳ Installer sudah berjalan (PID " + (result.pid || "-") + "). Ketik .remotion install status untuk melihat progres.");
  }
  if (result.needsCpuOptIn) {
    return m.reply(
      "⚠️ *GPU NVIDIA tidak terdeteksi di container.*\n" +
      "Installer tidak akan diam-diam memaksa mode CPU. Jika server memang CPU-only dan kamu menerima proses yang jauh lebih lambat, kirim:\n\n" +
      ".remotion install cpu\n\n" +
      "Jika VPS seharusnya memiliki GPU, aktifkan GPU passthrough pada container lalu ulangi .remotion install."
    );
  }
  if (!result.started) return m.reply("❌ Instalasi tidak dimulai: " + (result.error || "kesalahan tidak diketahui"));

  const hardware = mode === "cpu"
    ? "Mode CPU dipilih secara eksplisit. VoxCPM2 2B dapat berjalan di CPU, tetapi sangat lambat."
    : "GPU terdeteksi: " + result.gpu.name + (result.gpu.memoryMiB ? " (" + result.gpu.memoryMiB + " MiB VRAM)" : "") +
      (result.gpu.memoryMiB && result.gpu.memoryMiB < 8192 ? "\n⚠️ VRAM di bawah acuan resmi sekitar 8 GB; pemuatan model bisa gagal karena memori." : "");
  return m.reply(
    "🚀 *PEMASANGAN ENGINE REMOTION DIMULAI*\n" +
    hardware + "\n\n" +
    "Installer akan memasang Python 3.11, PyTorch, adapter VoxCPM2, lalu mengunduh bobot model VoxCPM2. Proses berjalan di background dan log tersimpan di server.\n\n" +
    "Ketik .remotion install status untuk memantau. Jangan hapus atau restart file instalasi saat proses berjalan."
  );
}

async function showServices(m, conn, argument = "") {
  const requested = String(argument || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (requested.length) {
    if (requested[0] !== "start" || requested.length !== 2 ||
        !["voice", "voxcpm", "tts"].includes(requested[1])) {
      return m.reply(
        "Format pemeriksaan layanan:\n" +
        "• .remotion services — cek status tanpa memuat model\n" +
        "• .remotion services start voice — mulai adapter VoxCPM2"
      );
    }

    if (getVoiceSettings().provider === "edge-tts") {
      return m.reply("Edge TTS online tidak memerlukan service lokal. Pastikan paket sudah terpasang dengan .remotion voice install. Untuk memakai VoxCPM2, ubah provider melalui .remotion voice.");
    }
    const service = "voxcpm";
    const label = "VoxCPM2";
    const waitMs = Infinity;
    await m.reply("⏳ Memulai " + label + " lokal. Bot akan menunggu sampai model siap atau proses service berhenti; tanpa batas waktu.");
    void startLocalVideoServices({ services: [service], waitMs, start: true }).then(result => {
      const state = result[service];
      return sendText(
        m.chat,
        (state?.ready ? "✅ " : "❌ ") + "*" + label + "*\n" +
        (state?.detail || "Status service tidak tersedia."),
        conn
      );
    }).catch(error => {
      void sendText(m.chat, "❌ Gagal memulai " + label + ": " + String(error?.message || error).slice(0, 300), conn);
    });
    return;
  }

  const statuses = providerReadiness();
  // Status is observational: do not load large models just to inspect them.
  const live = await startLocalVideoServices({ services: ["voxcpm"], waitMs: 0, start: false });
  statuses.push({
    name: "VoxCPM2 pemeriksaan langsung",
    configured: Boolean(live.voxcpm?.ready),
    detail: live.voxcpm?.detail || "Status VoxCPM2 tidak tersedia."
  });

  const comfyUrl = process.env.VIDEO_STUDIO_COMFYUI_URL || "http://127.0.0.1:8188";
  try {
    const stats = await localJson(localServiceUrl(comfyUrl, "system_stats"), {}, 3000);
    const ready = Boolean(stats?.system && Array.isArray(stats?.devices));
    statuses.push({
      name: "ComfyUI pemeriksaan langsung",
      configured: ready,
      detail: ready
        ? "ComfyUI merespons di " + comfyUrl + "; workflow dan hash audit tetap harus dikonfigurasi."
        : "ComfyUI merespons, tetapi payload system_stats tidak sesuai kontrak."
    });
  } catch {
    statuses.push({
      name: "ComfyUI pemeriksaan langsung",
      configured: false,
      detail: "ComfyUI belum dapat dihubungi di " + comfyUrl + ". Installer inti Remotion tidak memasang ComfyUI atau workflow model."
    });
  }

  const lines = statuses.map(item =>
    (item.configured ? "✅ " : "⚠️ ") + "*" + item.name + "*\n" + item.detail
  );
  lines.push(
    "",
    "Storyboard dibuat dengan model AI pilihan kamu di luar bot; minta model tersebut membaca prompt-remotion.md. Bot hanya memvalidasi JSON dan menjalankan render.",
    "Provider voice default adalah Edge TTS online. Pasang dengan .remotion voice install; tidak perlu GPU atau model lokal.",
    "VoxCPM2 tetap tersedia sebagai opsi lokal melalui .remotion voice provider voxcpm2. Untuk menyalakannya: .remotion services start voice.",
    "Footage AI, character reference, dan musik AI memerlukan ComfyUI lokal serta workflow API JSON yang sudah diaudit dan SHA-256-nya disetujui; fitur ini tidak dipasang oleh installer inti.",
    "SFX dibuat lokal. Musik tidak dipaksakan. Kesehatan service belum membuktikan hasil video.",
    "Reference image dapat meningkatkan konsistensi karakter, tetapi tidak menjamin identitas identik pada semua scene."
  );
  return m.reply("⚙️ *KESIAPAN REMOTION DI SERVER LINUX*\n\n" + lines.join("\n\n"));
}
async function showGuide(m) {
  return m.reply(
    "🧠 *PANDUAN PROMPT REMOTION*\n\n" +
    "Gunakan model AI apa pun yang kamu pilih. Minta model membaca panduan GitHub di atas dan menghasilkan JSON storyboard. Bot tidak menjalankan AI planner; bot hanya memvalidasi JSON.\n" +
    "Buka panduan lengkap: https://github.com/lightevil96-svg/Alvareth-Bot/blob/main/prompt-remotion.md\n\n" +
    "1. Kirim link panduan di atas ke model AI pilihan kamu dan minta model membaca seluruh panduan.\n" +
    "2. Berikan brief video dan minta satu objek JSON lengkap dengan schemaVersion: 1.\n" +
    "3. Salin seluruh JSON, lalu ketik .remotion generate dan tempel JSON itu.\n\n" +
    "Batas input 24.000 karakter; 1–60 scene; maksimal 20 detik per scene dan 300 detik total. Brief teks biasa tidak diproses."
  );
}
async function handleCommand(m, { conn, usedPrefix, text }) {
  const parsed = parseRemotionCommand(text);

  if (parsed.action === "menu") return showMenu(m, conn, usedPrefix);
  if (parsed.action === "hardware") return showHardware(m);
  if (parsed.action === "servicesMenu") return showServicesMenu(m, conn, usedPrefix);
  if (parsed.action === "installMenu") return showInstallMenu(m, conn, usedPrefix);
  if (parsed.action === "voice") return handleVoiceCommand(m, conn, usedPrefix, parsed.argument);
  if (parsed.action === "generate") {
    if (parsed.prompt) {
      void startPromptJob(parsed.prompt, m.chat, conn);
      return;
    }
    const ttl = positiveInt(process.env.VIDEO_STUDIO_WA_PROMPT_TTL_MS, DEFAULT_SESSION_TTL_MS, 60000, 3600000);
    sessions.set(m.chat, { createdAt: Date.now(), sender: m.sender, ttl });
    return m.reply(
      "🎬 *KIRIM STORYBOARD JSON*\n\n" +
      "Tempel JSON storyboard yang dibuat model AI pilihan kamu sesuai panduan prompt-remotion.md.\n" +
      "Jangan kirim brief biasa di sesi ini. Bot hanya memvalidasi JSON dan menjalankan render.\n\n" +
      "Sesi input berlaku " + Math.round(ttl / 60000) + " menit. Ketik .remotion cancel untuk membatalkan."
    );
  }
  if (parsed.action === "status") return showStatus(m, conn);
  if (parsed.action === "history") return showHistory(m);
  if (parsed.action === "guide") return showGuide(m);
  if (parsed.action === "services") return showServices(m, conn, parsed.argument);
  if (parsed.action === "install") return installLocalEngine(m, conn, parsed.argument);
  if (parsed.action === "cancel") {
    const ownSession = sessions.get(m.chat)?.sender === m.sender;
    const removed = ownSession && sessions.delete(m.chat);
    return m.reply(removed
      ? "✅ Sesi input prompt dibatalkan. Render yang sudah berjalan tidak terpengaruh."
      : "Tidak ada sesi input prompt yang sedang menunggu.");
  }
  if (parsed.action === "send") return sendCompletedJob(m, conn, parsed.jobId);

  return showMenu(m, conn, usedPrefix);
}

const handler = async (m, context = {}) => {
  // Check again here: callbacks and direct invocation must not bypass the router.
  if (context.isROwner !== true) return m.reply("Fitur Remotion hanya untuk owner.");
  startVideoQueue();
  return handleCommand(m, context);
};

global.__alvarethRemotionPromptHandler = async (m, context = {}) => {
  if (context.isROwner !== true || wasBotSentMessage(m)) return false;

  const session = sessions.get(m.chat);
  if (!session || session.sender !== m.sender) return false;

  const prompt = String(m.text || "").trim();
  if (!prompt) return false;

  const prefix = context.conn?.prefix ?? global.prefix;
  if (hasCommandPrefix(prompt, prefix)) return false;

  sessions.delete(m.chat);
  if (Date.now() - session.createdAt > session.ttl) {
    await sendText(m.chat, "⌛ Sesi input prompt sudah kedaluwarsa. Ketik .remotion generate untuk memulai lagi.", context.conn);
    return true;
  }
  if (prompt.length < 8) {
    await sendText(m.chat, "Input terlalu singkat. Tempel JSON storyboard lengkap dari model AI pilihan atau mulai ulang dengan .remotion generate.", context.conn);
    return true;
  }

  void startPromptJob(prompt, m.chat, context.conn);
  return true;
};

handler.help = ["remotion"];
handler.tags = ["owner"];
handler.command = /^remotion$/i;
handler.rowner = true;

export default handler;