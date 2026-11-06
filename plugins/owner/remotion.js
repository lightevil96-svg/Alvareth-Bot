import { localServiceUrl, localJson } from "../../video-studio/local-service.js";
import { existsSync } from "node:fs";
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

const MAX_PROMPT_CHARS = 24000;
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 6000;
const DEFAULT_WATCH_TIMEOUT_MS = 30 * 60 * 1000;
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

function providerReadiness() {
  const rendererInstalled =
    existsSync(join(process.cwd(), "node_modules", "@remotion", "renderer", "package.json")) &&
    existsSync(join(process.cwd(), "node_modules", "remotion", "package.json"));
  const ffmpegInstalled = hasBinary("ffmpeg") && hasBinary("ffprobe");
  return getRemotionProviderReadiness(
    process.env,
    path => existsSync(path),
    { remotionInstalled: rendererInstalled, ffmpegInstalled }
  );
}

async function showMenu(m, conn, usedPrefix = ".") {
  const rows = [
    {
      header: "",
      title: "🎬 Buat video",
      description: "Tempel storyboard JSON yang disusun ChatGPT.",
      id: usedPrefix + "remotion generate"
    },
    {
      header: "",
      title: "📊 Status render",
      description: "Lihat antrean dan progres pekerjaan.",
      id: usedPrefix + "remotion status"
    },
    {
      header: "",
      title: "📁 Riwayat",
      description: "Lihat hasil dan ID pekerjaan sebelumnya.",
      id: usedPrefix + "remotion history"
    },
    {
      header: "",
      title: "📤 Kirim ulang MP4",
      description: "Kirim kembali MP4 yang sudah selesai.",
      id: usedPrefix + "remotion send"
    },
    {
      header: "",
      title: "🧠 Panduan prompt",
      description: "Cara meminta ChatGPT membuat JSON storyboard yang valid.",
      id: usedPrefix + "remotion guide"
    },
    {
      header: "",
      title: "⚙️ Cek layanan",
      description: "Periksa Remotion, audio, footage, dan ComfyUI.",
      id: usedPrefix + "remotion services"
    },
    {
      header: "",
      title: "✖️ Batalkan prompt",
      description: "Hapus sesi menunggu prompt, bukan render aktif.",
      id: usedPrefix + "remotion cancel"
    }
  ];

  try {
    await conn.sendMessage(m.chat, {
      text: [
        "🎬 *ALVARETH REMOTION VIDEO STUDIO*",
        "",
        "Susun storyboard JSON menggunakan ChatGPT dan panduan prompt-remotion.md.",
        "Bot memvalidasi storyboard, menyiapkan media lokal, lalu merender MP4.",
        "",
        "🔒 Akses dibatasi untuk owner.",
        "Pilih tindakan di bawah ini."
      ].join("\n"),
      footer: "Alvareth Bot • Linux Remotion Engine",
      optionText: "Pilih fitur",
      optionTitle: "Remotion Video Studio",
      nativeFlow: [{
        text: "Menu produksi video",
        sections: [{ title: "Video Studio", rows }],
        icon: "document"
      }],
      interactiveAsTemplate: false
    }, { quoted: m });
  } catch (error) {
    console.warn("[REMOTION] Menu interaktif gagal; memakai fallback teks:", error?.message || error);
    const prefix = usedPrefix || ".";
    await m.reply(
      "🎬 *REMOTION VIDEO STUDIO*\n\n" +
      "Ketik salah satu perintah:\n" +
      "• " + prefix + "remotion generate\n" +
      "• " + prefix + "remotion status\n" +
      "• " + prefix + "remotion history\n" +
      "• " + prefix + "remotion send\n" +
      "• " + prefix + "remotion guide\n" +
      "• " + prefix + "remotion services\n" +
      "• " + prefix + "remotion cancel"
    );
  }
}

function activeJobs() {
  return listVideoJobs(30).filter(job => ["queued", "rendering"].includes(job.status));
}

async function startPromptJob(prompt, chat, fallbackConn) {
  const cleanPrompt = String(prompt || "").trim();
  if (cleanPrompt.length < 8) {
    await sendText(chat, "JSON storyboard terlalu singkat. Tempel objek JSON lengkap dari ChatGPT.", fallbackConn);
    return;
  }
  if (cleanPrompt.length > MAX_PROMPT_CHARS) {
    await sendText(chat, "JSON storyboard maksimal " + MAX_PROMPT_CHARS + " karakter. Minta ChatGPT membuat output yang lebih ringkas.", fallbackConn);
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
    "🧩 *Memeriksa storyboard ChatGPT*\n" +
    "Memvalidasi struktur JSON, scene, durasi narasi, visual, dan batas render.\n" +
    "Setelah lolos validasi, video langsung masuk antrean produksi.",
    fallbackConn
  );

  try {
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

async function showServices(m) {
  const statuses = providerReadiness();
  for (const [name, base, path] of [
    ["VoxCPM2", process.env.VIDEO_STUDIO_VOXCPM_URL || "http://127.0.0.1:7861", "health"]
  ]) {
    try {
      const health = await localJson(localServiceUrl(base, path), {}, 3000);
      const ready = health.ready === true && health.provider === "VoxCPM2";
      statuses.push({ name: name + " pemeriksaan langsung", configured: Boolean(ready), detail: ready ? "Service merespons dan model siap." : "Service merespons tetapi model belum siap." });
    } catch { statuses.push({ name: name + " pemeriksaan langsung", configured: false, detail: "Service lokal tidak dapat dihubungi." }); }
  }
  const lines = statuses.map(item =>
    (item.configured ? "✅ " : "⚠️ ") + "*" + item.name + "*\n" + item.detail
  );
  lines.push(
    "",
    "Storyboard dibuat di ChatGPT secara terpisah; bot tidak menjalankan Ollama atau LLM lokal. SFX dibuat lokal dan musik tidak dipaksakan. Kesehatan service belum membuktikan hasil video.",
    "Reference image dapat meningkatkan konsistensi karakter, tetapi tidak menjamin identitas identik pada semua scene."
  );
  return m.reply("⚙️ *KESIAPAN REMOTION DI SERVER LINUX*\n\n" + lines.join("\n\n"));
}

async function showGuide(m) {
  return m.reply(
    "🧠 *PANDUAN PROMPT REMOTION*\n\n" +
    "Storyboard dibuat di ChatGPT, bukan oleh AI lokal di VPS.\n" +
    "Buka panduan lengkap: https://github.com/lightevil96-svg/Alvareth-Bot/blob/feat/remotion-whatsapp-linux/prompt-remotion.md\n\n" +
    "1. Kirim brief videomu ke ChatGPT dengan mengikuti panduan tersebut.\n" +
    "2. Minta satu objek JSON lengkap dengan schemaVersion: 1.\n" +
    "3. Salin seluruh JSON, lalu ketik .remotion generate dan tempel JSON itu.\n\n" +
    "Batas input 24.000 karakter; 1–60 scene; maksimal 20 detik per scene dan 300 detik total. Brief teks biasa tidak diproses."
  );
}

async function handleCommand(m, { conn, usedPrefix, text }) {
  const parsed = parseRemotionCommand(text);

  if (parsed.action === "menu") return showMenu(m, conn, usedPrefix);
  if (parsed.action === "generate") {
    if (parsed.prompt) {
      void startPromptJob(parsed.prompt, m.chat, conn);
      return;
    }
    const ttl = positiveInt(process.env.VIDEO_STUDIO_WA_PROMPT_TTL_MS, DEFAULT_SESSION_TTL_MS, 60000, 3600000);
    sessions.set(m.chat, { createdAt: Date.now(), sender: m.sender, ttl });
    return m.reply(
      "🎬 *KIRIM STORYBOARD JSON*\n\n" +
      "Tempel JSON storyboard yang sudah dibuat ChatGPT sesuai panduan prompt-remotion.md.\n" +
      "Jangan kirim brief biasa di sesi ini. Bot hanya memvalidasi JSON dan menjalankan render.\n\n" +
      "Sesi input berlaku " + Math.round(ttl / 60000) + " menit. Ketik .remotion cancel untuk membatalkan."
    );
  }
  if (parsed.action === "status") return showStatus(m, conn);
  if (parsed.action === "history") return showHistory(m);
  if (parsed.action === "guide") return showGuide(m);
  if (parsed.action === "services") return showServices(m);
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
    await sendText(m.chat, "Input terlalu singkat. Tempel JSON storyboard lengkap dari ChatGPT atau mulai ulang dengan .remotion generate.", context.conn);
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
