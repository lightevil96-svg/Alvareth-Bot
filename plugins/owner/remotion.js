import { startLocalVideoServices } from "../../video-studio/local-services.js";
import { localJson, localServiceUrl } from "../../video-studio/local-service.js";
import { validateReviewedWorkflow } from "../../video-studio/media/comfyui.js";
import { readVideoStudioInstallerStatus, startVideoStudioInstaller } from "../../video-studio/installer.js";
import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, freemem, platform, totalmem } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { planVideoPrompt } from "../../video-studio/prompt/planner.js";
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

const MAX_PROMPT_CHARS = 6000;
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 6000;
const DEFAULT_WATCH_TIMEOUT_MS = 30 * 60 * 1000;
const sessions = global.__alvarethRemotionSessions || (global.__alvarethRemotionSessions = new Map());
const watchers = global.__alvarethRemotionWatchers || (global.__alvarethRemotionWatchers = new Set());

startVideoQueue();

const planning = global.__alvarethRemotionPlanning || (global.__alvarethRemotionPlanning = new Set());

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

function providerReadiness() {
  const rendererInstalled =
    existsSync(join(process.cwd(), "node_modules", "@remotion", "renderer", "package.json")) &&
    existsSync(join(process.cwd(), "node_modules", "remotion", "package.json"));
  const ffmpegInstalled = hasBinary("ffmpeg") && hasBinary("ffprobe");
  const approvedHashes = String(process.env.VIDEO_STUDIO_COMFYUI_REVIEWED_SHA256 || "");
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
    { remotionInstalled: rendererInstalled, ffmpegInstalled, workflowCheck, referenceWorkflowCheck }
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
        remotionMenuRow(usedPrefix, "🎬 Buat video", "Kirim brief; AI menyusun produksi.", "generate"),
        remotionMenuRow(usedPrefix, "📊 Status render", "Lihat antrean dan progres.", "status"),
        remotionMenuRow(usedPrefix, "📁 Riwayat video", "Lihat pekerjaan dan ID hasil.", "history"),
        remotionMenuRow(usedPrefix, "📤 Kirim MP4 terakhir", "Kirim ulang hasil yang selesai.", "send"),
        remotionMenuRow(usedPrefix, "🧠 Panduan prompt", "Lihat contoh brief video.", "guide"),
        remotionMenuRow(usedPrefix, "✖️ Batalkan input", "Batalkan sesi prompt yang menunggu.", "cancel")
      ]
    },
    {
      title: "Engine & layanan lokal",
      rows: [
        remotionMenuRow(usedPrefix, "⚙️ Kelola layanan", "Cek status, mulai VoxCPM2 dan Ollama.", "services-menu"),
        remotionMenuRow(usedPrefix, "⬇️ Instalasi engine", "Pilih GPU otomatis, CPU, atau cek progres.", "install-menu"),
        remotionMenuRow(usedPrefix, "🖥️ Spesifikasi server", "Periksa CPU, RAM, storage, dan GPU.", "hardware")
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
    "",
    "*Layanan:*",
    "• " + usedPrefix + "remotion services",
    "• " + usedPrefix + "remotion services start voice",
    "• " + usedPrefix + "remotion services start planner",
    "",
    "*Instalasi:*",
    "• " + usedPrefix + "remotion install",
    "• " + usedPrefix + "remotion install cpu",
    "• " + usedPrefix + "remotion install status"
  ].join("\n");

  return sendNativeMenu(m, conn, {
    title: "Remotion Video Studio",
    description: "Akses produksi video, riwayat, pengiriman MP4, layanan AI lokal, dan instalasi engine dari satu menu.",
    sections,
    fallback
  });
}

async function showServicesMenu(m, conn, usedPrefix = ".") {
  const sections = [{
    title: "Layanan lokal",
    rows: [
      remotionMenuRow(usedPrefix, "🔎 Periksa semua layanan", "Cek Ollama, VoxCPM2, ComfyUI dan workflow.", "services"),
      remotionMenuRow(usedPrefix, "🗣️ Mulai VoxCPM2", "Aktifkan voice-over lokal dan tunggu model siap.", "services start voice"),
      remotionMenuRow(usedPrefix, "🧠 Mulai Ollama", "Aktifkan model planner Qwen lokal.", "services start planner"),
      remotionMenuRow(usedPrefix, "↩️ Kembali ke menu", "Kembali ke menu utama Remotion.")
    ]
  }];
  const fallback = [
    "⚙️ *LAYANAN REMOTION*",
    "• " + usedPrefix + "remotion services",
    "• " + usedPrefix + "remotion services start voice",
    "• " + usedPrefix + "remotion services start planner",
    "• " + usedPrefix + "remotion"
  ].join("\n");
  return sendNativeMenu(m, conn, {
    title: "Layanan lokal",
    description: "Pilih pemeriksaan atau nyalakan service lokal. Memulai VoxCPM2 dapat membutuhkan waktu untuk memuat model.",
    sections,
    fallback
  });
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
    await sendText(chat, "Prompt terlalu singkat. Jelaskan ide videonya minimal beberapa kata.", fallbackConn);
    return;
  }
  if (cleanPrompt.length > MAX_PROMPT_CHARS) {
    await sendText(chat, "Prompt maksimal " + MAX_PROMPT_CHARS + " karakter. Ringkas brief lalu kirim ulang.", fallbackConn);
    return;
  }

  const maxActive = positiveInt(process.env.VIDEO_STUDIO_WA_MAX_ACTIVE_JOBS, 2, 1, 5);
  if (planning.size) return sendText(chat, "Planner sedang menyusun storyboard. Tunggu proses sebelumnya selesai.", fallbackConn);
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

  planning.add(chat);
  await sendText(
    chat,
    "🧠 *AI Director mulai bekerja*\n" +
    "Sedang memahami brief, menyusun alur cerita, menentukan scene, visual, gerakan, dan arahan audio.\n" +
    "Kamu tidak perlu mengatur FPS, rasio, warna, atau durasi scene secara manual.",
    fallbackConn
  );

  try {
    // Ollama is started by the planner. VoxCPM2 starts later, only when
    // narration is prepared, so both large models are not preloaded together.
    const plan = await planVideoPrompt(cleanPrompt);
    const project = compileVideoPlan(plan);
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
      "\n\nPeriksa .remotion services untuk melihat provider yang belum siap.",
      fallbackConn
    );
  } finally {
    planning.delete(chat);
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
  const watchTimeout = positiveInt(process.env.VIDEO_STUDIO_WA_WATCH_TIMEOUT_MS, DEFAULT_WATCH_TIMEOUT_MS, 60000, 7200000);
  const deadline = Date.now() + watchTimeout;
  let lastStage = "";
  let lastProgressMark = 0;

  while (Date.now() < deadline) {
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

  await sendText(
    chat,
    "⏳ Job masih berjalan melewati batas pemantauan WhatsApp.\n" +
    "Render tidak dihentikan. Ketik .remotion status untuk memeriksa kembali.",
    fallbackConn
  );
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

  const ollamaUrl = String(process.env.VIDEO_STUDIO_OLLAMA_URL || "http://127.0.0.1:11434").trim();
  const voxUrl = String(process.env.VIDEO_STUDIO_VOXCPM_URL || "http://127.0.0.1:7861").trim();
  if (ollamaUrl !== "http://127.0.0.1:11434" || voxUrl !== "http://127.0.0.1:7861") {
    return m.reply(
      "Installer otomatis saat ini menyiapkan endpoint lokal default:\n" +
      "Ollama: http://127.0.0.1:11434\nVoxCPM2: http://127.0.0.1:7861\n\n" +
      "Konfigurasi VIDEO_STUDIO_OLLAMA_URL atau VIDEO_STUDIO_VOXCPM_URL kamu berbeda. Sesuaikan endpoint ke default tersebut atau siapkan service sesuai endpoint yang sudah dikonfigurasi."
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
    "Installer akan memasang Ollama, Python 3.11, PyTorch, adapter VoxCPM2, lalu mengunduh model Qwen dan VoxCPM2. Proses berjalan di background dan log tersimpan di server.\n\n" +
    "Ketik .remotion install status untuk memantau. Jangan hapus atau restart file instalasi saat proses berjalan."
  );
}

async function showServices(m, conn, argument = "") {
  const requested = String(argument || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (requested.length) {
    if (requested[0] !== "start" || requested.length !== 2 ||
        !["voice", "voxcpm", "tts", "planner", "ollama"].includes(requested[1])) {
      return m.reply(
        "Format pemeriksaan layanan:\n" +
        "• .remotion services — cek status tanpa memuat model\n" +
        "• .remotion services start voice — mulai adapter VoxCPM2\n" +
        "• .remotion services start planner — mulai Ollama"
      );
    }

    const service = ["voice", "voxcpm", "tts"].includes(requested[1]) ? "voxcpm" : "ollama";
    const label = service === "voxcpm" ? "VoxCPM2" : "Ollama";
    const waitMs = service === "voxcpm"
      ? positiveInt(process.env.VIDEO_STUDIO_VOXCPM_STARTUP_TIMEOUT_MS, 600000, 30000, 1800000)
      : 30000;
    await m.reply("⏳ Memulai " + label + " lokal. Bot akan mengirim hasil pemeriksaan setelah service siap atau gagal.");
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
  const live = await startLocalVideoServices({ waitMs: 0, start: false });
  statuses.push(
    { name: "Ollama pemeriksaan langsung", configured: Boolean(live.ollama?.ready), detail: live.ollama?.detail || "Status Ollama tidak tersedia." },
    { name: "VoxCPM2 pemeriksaan langsung", configured: Boolean(live.voxcpm?.ready), detail: live.voxcpm?.detail || "Status VoxCPM2 tidak tersedia." }
  );

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
    "Untuk memasang runtime dan model lokal, gunakan .remotion install (GPU) atau .remotion install cpu (CPU). Pantau dengan .remotion install status.",
    "Untuk menyalakan VoxCPM2 sebelum membuat video: .remotion services start voice. Untuk Ollama: .remotion services start planner.",
    "Footage AI, character reference, dan musik AI memerlukan ComfyUI lokal serta workflow API JSON yang sudah diaudit dan SHA-256-nya disetujui; fitur ini tidak dipasang oleh installer inti.",
    "SFX dibuat lokal. Musik tidak dipaksakan. Kesehatan service belum membuktikan hasil video.",
    "Reference image dapat meningkatkan konsistensi karakter, tetapi tidak menjamin identitas identik pada semua scene."
  );
  return m.reply("⚙️ *KESIAPAN REMOTION DI SERVER LINUX*\n\n" + lines.join("\n\n"));
}

async function showGuide(m) {
  return m.reply(
    "🧠 *PANDUAN PROMPT REMOTION*\n\n" +
    "Tulis seperti memberi brief kepada sutradara video. Tidak perlu mengatur teknis render.\n\n" +
    "*Contoh:*\n" +
    "Buat video cinematic 35 detik tentang seekor rubah kecil yang tersesat di hutan saat hujan. Gunakan gaya animasi 3D yang hangat, karakter utama berpenampilan konsisten, alur emosional dari takut menjadi berani, kamera sinematik, narasi Bahasa Indonesia, subtitle sinkron, musik orkestra lembut, dan efek suara alam. Akhiri dengan pesan tentang keberanian.\n\n" +
    "*Tips:* sebutkan topik, penonton, suasana, karakter, pesan utama, dan platform jika memang penting. AI akan menentukan scene, tempo, rasio, warna, gerakan, dan transisi."
  );
}

async function handleCommand(m, { conn, usedPrefix, text }) {
  const parsed = parseRemotionCommand(text);

  if (parsed.action === "menu") return showMenu(m, conn, usedPrefix);
  if (parsed.action === "hardware") return showHardware(m);
  if (parsed.action === "servicesMenu") return showServicesMenu(m, conn, usedPrefix);
  if (parsed.action === "installMenu") return showInstallMenu(m, conn, usedPrefix);
  if (parsed.action === "generate") {
    if (parsed.prompt) {
      void startPromptJob(parsed.prompt, m.chat, conn);
      return;
    }
    const ttl = positiveInt(process.env.VIDEO_STUDIO_WA_PROMPT_TTL_MS, DEFAULT_SESSION_TTL_MS, 60000, 3600000);
    sessions.set(m.chat, { createdAt: Date.now(), sender: m.sender, ttl });
    return m.reply(
      "🎬 *KIRIM PROMPT VIDEO*\n\n" +
      "Ceritakan video yang ingin dibuat. Jelaskan ide, karakter, suasana, gaya visual, dan pesan yang ingin disampaikan.\n" +
      "Tidak perlu mengatur FPS, resolusi, warna, atau durasi setiap scene.\n\n" +
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
    await sendText(m.chat, "Prompt terlalu singkat. Kirim brief yang lebih jelas atau mulai ulang dengan .remotion generate.", context.conn);
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