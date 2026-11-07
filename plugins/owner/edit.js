import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getQuotedMediaInfo,
  resolveQuotedMediaInfo,
  downloadQuotedMedia
} from "../../lib/simple.js";
import { wasBotSentMessage } from "../../lib/auto-download.js";
import { sendLocalFile, describeWhatsAppUploadError } from "../../lib/whatsapp-file-sender.js";
import {
  createDefaultEditPlan,
  normalizeEditSettings
} from "../../video-edit/schema.js";
import {
  enqueueEditJob,
  getEditOutput,
  listEditJobs,
  editStoragePaths
} from "../../video-edit/queue.js";

const MAX_PROMPT_CHARS = 24000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_INPUT_BYTES = 256 * 1024 * 1024;
const sessions = global.__alvarethEditSessions || (global.__alvarethEditSessions = new Map());

function sessionKey(m) {
  return String(m.chat || "") + ":" + String(m.sender || "");
}

function sendText(conn, chat, text) {
  if (!conn || typeof conn.sendMessage !== "function" || !chat) return Promise.resolve(null);
  return conn.sendMessage(chat, { text: String(text || "") }).catch(error => {
    console.warn("[EDIT:WA] Gagal mengirim notifikasi:", error?.message || error);
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
      } catch {
        return false;
      }
    }
    return typeof candidate === "string" && candidate.length > 0 && value.startsWith(candidate);
  });
}

function isVideoType(type, mime) {
  return /^(video|ptv)Message$/i.test(String(type || "")) || /^video\//i.test(String(mime || ""));
}

function directVideoInfo(m) {
  const raw = m?.rawMessage?.message || m?.message || {};
  const type = String(m?.mtype || Object.keys(raw).find(key => /^(video|ptv)Message$/i.test(key)) || "");
  const node = m?.msg || raw.videoMessage || raw.ptvMessage || m;
  const mime = String(node?.mimetype || m?.mimetype || "");
  return isVideoType(type, mime) ? { type, media: node, mime } : null;
}

async function resolveVideoPayload(m, conn) {
  let quoted = null;
  try { quoted = await resolveQuotedMediaInfo(m, conn); } catch (error) {
    console.warn("[EDIT] Gagal membaca media reply:", error?.message || error);
  }
  if (quoted && isVideoType(quoted.type, quoted.mime)) return { quoted: true, info: quoted };
  const direct = directVideoInfo(m);
  if (direct) return { quoted: false, info: direct };
  const preview = getQuotedMediaInfo(m);
  if (preview && isVideoType(preview.type, preview.mime)) return { quoted: true, info: preview };
  return null;
}

async function downloadVideoPayload(m, conn, payload) {
  let buffer = null;
  if (payload.quoted) {
    buffer = await downloadQuotedMedia(m, conn);
  } else if (typeof m.download === "function") {
    buffer = await m.download();
  }
  if (!buffer && typeof conn?.downloadM === "function") {
    buffer = await conn.downloadM(payload.info.media, "video");
  }
  if (!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array) || !buffer.length) {
    throw new Error("Video tidak berhasil diunduh dari WhatsApp. Kirim ulang video atau reply langsung ke video aslinya.");
  }
  return Buffer.from(buffer);
}

async function clearSession(key) {
  const session = sessions.get(key);
  if (!session) return false;
  sessions.delete(key);
  if (session.sourcePath) await rm(session.sourcePath, { force: true }).catch(() => {});
  return true;
}

function getSession(m) {
  const key = sessionKey(m);
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    void clearSession(key);
    return null;
  }
  return session;
}

async function receiveVideo(m, conn, payloadOverride = null) {
  const payload = payloadOverride || await resolveVideoPayload(m, conn);
  if (!payload) return null;
  const maxBytesRaw = Number(process.env.ALVARETH_EDIT_MAX_INPUT_BYTES || DEFAULT_MAX_INPUT_BYTES);
  const maxBytes = Number.isSafeInteger(maxBytesRaw) && maxBytesRaw > 0 ? maxBytesRaw : DEFAULT_MAX_INPUT_BYTES;
  const declaredSizeRaw = payload.info.media?.fileLength ?? payload.info.media?.fileLengthBytes ?? payload.info.media?.fileLengthInBytes;
  const declaredSize = typeof declaredSizeRaw?.toNumber === "function" ? declaredSizeRaw.toNumber() : Number(declaredSizeRaw);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error("Ukuran video yang dilaporkan WhatsApp melebihi batas .edit sebesar " + (maxBytes / 1024 / 1024).toFixed(0) + " MB.");
  }
  const declaredDuration = Number(payload.info.media?.seconds);
  if (Number.isFinite(declaredDuration) && declaredDuration > 900) {
    throw new Error("Durasi video sumber melebihi batas .edit sebesar 15 menit.");
  }
  const buffer = await downloadVideoPayload(m, conn, payload);
  if (buffer.length > maxBytes) {
    throw new Error("Ukuran video " + (buffer.length / 1024 / 1024).toFixed(1) +
      " MB melebihi batas .edit sebesar " + (maxBytes / 1024 / 1024).toFixed(0) + " MB.");
  }

  await mkdir(editStoragePaths.uploads, { recursive: true, mode: 0o700 });
  const key = sessionKey(m);
  await clearSession(key);
  const id = randomUUID().replace(/-/g, "");
  const sourcePath = path.join(editStoragePaths.uploads, id + ".source");
  await writeFile(sourcePath, buffer, { mode: 0o600, flag: "wx" });
  const mime = String(payload.info.mime || "video/mp4");
  const session = {
    sender: String(m.sender || ""),
    chat: String(m.chat || ""),
    sourcePath,
    sourceName: String(payload.info.media?.fileName || "WhatsApp video").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100),
    mime,
    sizeBytes: buffer.length,
    createdAt: Date.now(),
    awaitingJson: false,
    settings: normalizeEditSettings({})
  };
  sessions.set(key, session);
  session.expiryTimer = setTimeout(() => {
    if (sessions.get(key) === session) void clearSession(key);
  }, SESSION_TTL_MS + 1000);
  session.expiryTimer.unref?.();
  console.log("[EDIT] Video diterima", JSON.stringify({
    chat: session.chat,
    sender: session.sender,
    bytes: session.sizeBytes,
    mime: session.mime
  }));
  return session;
}

function menuRow(prefix, title, description, command) {
  return { header: "", title, description, id: prefix + "edit" + (command ? " " + command : "") };
}

async function sendNativeMenu(m, conn, title, description, sections, fallback) {
  if (!conn || typeof conn.sendMessage !== "function") return m.reply(fallback);
  try {
    await conn.sendMessage(m.chat, {
      text: [
        "🎬 *ALVARETH AI EDITOR*",
        "",
        description,
        "",
        "🔒 Akses khusus owner."
      ].join("\n"),
      footer: "Alvareth Bot • Raw Video Editor",
      optionText: "Pilih tindakan",
      optionTitle: title,
      nativeFlow: [{ text: title, sections, icon: "document" }],
      interactiveAsTemplate: false
    }, { quoted: m });
  } catch (error) {
    console.warn("[EDIT] Menu interaktif gagal; memakai fallback teks:", error?.message || error);
    await m.reply(fallback);
  }
}

async function showMainMenu(m, conn, prefix) {
  const session = getSession(m);
  const source = session
    ? "Video siap diproses • " + session.sourceName + " • " + (session.sizeBytes / 1024 / 1024).toFixed(1) + " MB"
    : "Kirim video dengan caption " + prefix + "edit atau reply video dengan perintah " + prefix + "edit.";
  const sections = [
    {
      title: "Mulai editing",
      rows: [
        menuRow(prefix, "⚡ Auto Edit", "Potong jeda panjang, format short, normalisasi audio.", "auto"),
        menuRow(prefix, "⚙️ Pengaturan", "Atur rasio, durasi, dan pemotongan jeda.", "settings"),
        menuRow(prefix, "🧠 Panduan GPT Plus", "Buat edit decision JSON dari GPT Plus.", "guide"),
        menuRow(prefix, "📋 Import JSON", "Gunakan timeline dan arahan editing buatan GPT.", "json"),
        menuRow(prefix, "📊 Status pekerjaan", "Lihat antrean dan hasil edit.", "status"),
        menuRow(prefix, "✖️ Batalkan sesi", "Hapus video sumber dari sesi aktif.", "cancel")
      ]
    }
  ];
  const fallback = [
    "🎬 *ALVARETH AI EDITOR*",
    source,
    "",
    prefix + "edit auto",
    prefix + "edit settings",
    prefix + "edit guide",
    prefix + "edit json",
    prefix + "edit status",
    prefix + "edit cancel"
  ].join("\n");
  return sendNativeMenu(m, conn, "Video Editor", source, sections, fallback);
}

async function showSettingsMenu(m, conn, prefix) {
  const session = getSession(m);
  if (!session) return m.reply("Kirim atau reply video terlebih dahulu, lalu ketik " + prefix + "edit.");
  const settings = session.settings;
  const sections = [
    {
      title: "Rasio video",
      rows: [
        menuRow(prefix, (settings.ratio === "9:16" ? "✓ " : "") + "9:16 • Reels / TikTok / Shorts", "Portrait vertical.", "ratio 9:16"),
        menuRow(prefix, (settings.ratio === "16:9" ? "✓ " : "") + "16:9 • YouTube", "Landscape horizontal.", "ratio 16:9"),
        menuRow(prefix, (settings.ratio === "1:1" ? "✓ " : "") + "1:1 • Square", "Format persegi.", "ratio 1:1"),
        menuRow(prefix, (settings.ratio === "4:5" ? "✓ " : "") + "4:5 • Feed", "Portrait feed.", "ratio 4:5")
      ]
    },
    {
      title: "Durasi maksimum",
      rows: [
        menuRow(prefix, "30 detik", "Short sangat ringkas.", "duration 30"),
        menuRow(prefix, "60 detik", "Default short-form.", "duration 60"),
        menuRow(prefix, "90 detik", "Short lebih panjang.", "duration 90"),
        menuRow(prefix, "180 detik", "Batas maksimum output.", "duration 180")
      ]
    },
    {
      title: "Pemotongan jeda",
      rows: [
        menuRow(prefix, "Jeda: " + (settings.removeSilence ? "ON" : "OFF"), "Tekan untuk mengubah.", "silence toggle"),
        menuRow(prefix, "Kembali ke menu", "Simpan pengaturan sesi.", "menu")
      ]
    }
  ];
  const description = [
    "Rasio: " + settings.ratio,
    "Durasi maksimum: " + settings.maxDurationSeconds + " detik",
    "Potong jeda panjang: " + (settings.removeSilence ? "ON" : "OFF"),
    "Musik otomatis: OFF sampai aset dengan lisensi terverifikasi tersedia."
  ].join("\n");
  return sendNativeMenu(m, conn, "Pengaturan Editing", description, sections, description + "\n\nGunakan .edit ratio 9:16, .edit duration 60, atau .edit silence toggle.");
}

function parseJsonInput(value) {
  if (String(value || "").length > MAX_PROMPT_CHARS) {
    throw new Error("JSON terlalu panjang. Batas input .edit adalah " + MAX_PROMPT_CHARS + " karakter.");
  }
  try {
    return JSON.parse(String(value || ""));
  } catch (error) {
    throw new Error("JSON tidak valid: " + error.message + ". Periksa tanda kutip dan koma, lalu kirim ulang.");
  }
}

async function queuePlan(m, conn, session, inputPlan) {
  try {
    const job = await enqueueEditJob({
      sourcePath: session.sourcePath,
      sender: m.sender,
      chat: m.chat,
      plan: inputPlan,
      settings: session.settings,
      onProgress: current => {
        if (current.progress === 1 || current.progress === 100 || current.progress % 20 === 0) {
          console.log("[EDIT:" + current.id + "] Rendering " + current.progress + "%");
        }
      },
      onComplete: async current => {
        const result = current.result || {};
        const caption = [
          "✅ *ALVARETH EDIT SELESAI*",
          "🎬 " + current.title,
          "⏱️ " + Number(result.duration || 0).toFixed(1) + " detik",
          "📐 " + result.width + "×" + result.height + " • " + result.fps + " FPS",
          "✂️ " + result.segmentCount + " segmen",
          "🆔 " + current.id,
          current.deliveryError ? "" : "File master MP4 sudah divalidasi."
        ].filter(Boolean).join("\n");
        try {
          await sendLocalFile(conn, m.chat, current.outputPath, {
            jobId: current.id,
            mimetype: "video/mp4",
            caption,
            seconds: Math.max(1, Math.round(Number(result.duration) || 1)),
            quoted: m
          });
        } catch (error) {
          await sendText(conn, m.chat,
            "✅ Render selesai, tetapi pengiriman WhatsApp gagal.\n" +
            describeWhatsAppUploadError(error) + "\n\n" +
            "Hasil tetap tersimpan. Kirim ulang dengan .edit send " + current.id
          );
        }
      },
      onError: async current => {
        await sendText(conn, m.chat,
          "❌ *EDIT GAGAL*\nID: " + current.id + "\nTahap: " + current.stage +
          "\nDetail: " + String(current.error || "Kesalahan tidak diketahui").slice(0, 900)
        );
      }
    });
    session.awaitingJson = false;
    return m.reply(
      "⏳ *EDIT MASUK ANTREAN*\n" +
      "ID: " + job.id + "\n" +
      "Judul: " + job.title + "\n" +
      "Mode: " + (inputPlan?.edit?.segments?.length ? "Custom timeline" : "Auto / planned edit") + "\n\n" +
      "Bot akan mengirim MP4 setelah rendering dan pemeriksaan kualitas selesai."
    );
  } catch (error) {
    return m.reply("❌ JSON atau pekerjaan edit ditolak:\n" + String(error?.message || error).slice(0, 1000));
  }
}

async function showGuide(m, prefix) {
  return m.reply([
    "🧠 *PANDUAN PROMPT GPT PLUS — ALVARETH .EDIT*",
    "",
    "Buka panduan lengkap yang berisi prompt siap salin, schema JSON, batas teknis, dan contoh edit:",
    "https://github.com/lightevil96-svg/Alvareth-Bot/blob/main/docs/EDIT_PROMPT_GUIDE.md",
    "",
    "Cara pakai:",
    "1. Upload video sumber ke GPT Plus jika fitur unggah/video tersedia. Jika tidak, berikan transkrip dan timecode; jangan minta GPT menebak timestamp.",
    "2. Salin prompt dari dokumen panduan dan berikan tujuan, platform, gaya, bagian yang wajib dipertahankan, serta CTA.",
    "3. Minta GPT menghasilkan satu JSON valid sesuai schemaVersion 1.",
    "4. Di chat bot, reply video dengan " + prefix + "edit jika belum ada sesi.",
    "5. Tekan Import JSON, lalu tempel JSON sebagai pesan berikutnya.",
    "",
    "Auto Edit tersedia tanpa JSON, tetapi hanya memakai pemotongan jeda audio dan pengaturan format dasar. Ia tidak mengklaim memahami isi atau memilih momen terbaik secara semantik."
  ].join("\n"));
}

function formatJobStatus(job) {
  const state = {
    queued: "Menunggu antrean",
    rendering: "Sedang render",
    completed: "Selesai",
    failed: "Gagal"
  }[job.status] || job.status;
  return "• " + job.id + " — " + state + " (" + job.progress + "%)" +
    (job.error ? "\n  " + job.error.slice(0, 180) : "");
}

async function sendCompletedJob(m, conn, id) {
  const output = await getEditOutput(id, m.sender);
  if (!output) return m.reply("Hasil tidak ditemukan, belum selesai, atau bukan milik owner ini. Gunakan .edit status untuk melihat pekerjaan.");
  try {
    await sendLocalFile(conn, m.chat, output.path, {
      jobId: id,
      mimetype: "video/mp4",
      caption: "🎬 *ALVARETH EDIT — KIRIM ULANG*\n" + output.title + "\nID: " + id,
      seconds: Math.max(1, Math.round(Number(output.result?.duration) || 1)),
      quoted: m
    });
  } catch (error) {
    return m.reply("Pengiriman ulang gagal: " + describeWhatsAppUploadError(error));
  }
}

async function handleCommand(m, context = {}) {
  const conn = context.conn || global.conn;
  const prefix = context.usedPrefix || ".";
  const raw = String(context.text || "").trim();
  const firstSpace = raw.search(/\s/);
  const action = (firstSpace < 0 ? raw : raw.slice(0, firstSpace)).toLowerCase() || "menu";
  const argument = firstSpace < 0 ? "" : raw.slice(firstSpace + 1).trim();

  if (action === "guide") return showGuide(m, prefix);
  if (action === "status") {
    const jobs = listEditJobs(m.sender, 10);
    return m.reply(jobs.length
      ? "📊 *STATUS ALVARETH EDIT*\n\n" + jobs.map(formatJobStatus).join("\n")
      : "Belum ada pekerjaan .edit dari owner ini.");
  }
  if (action === "cancel") {
    const removed = await clearSession(sessionKey(m));
    return m.reply(removed ? "✅ Sesi video .edit dibatalkan dan file sumber sementara dihapus." : "Tidak ada sesi .edit aktif.");
  }
  if (action === "send") return sendCompletedJob(m, conn, argument.split(/\s+/)[0]);

  const needsSource = ["menu", "auto", "settings", "json", "ratio", "duration", "silence", "reset"].includes(action);
  let session = getSession(m);
  if (needsSource) {
    const payload = await resolveVideoPayload(m, conn);
    if (payload) session = await receiveVideo(m, conn, payload);
  }

  if (action === "menu" || action === "help") return showMainMenu(m, conn, prefix);
  if (!session && needsSource) {
    return m.reply(
      "🎬 Kirim video dengan caption " + prefix + "edit atau reply langsung ke video dengan perintah " + prefix + "edit.\n" +
      "Batas ukuran sumber default 256 MB dan durasi sumber maksimal 15 menit."
    );
  }

  if (action === "settings") return showSettingsMenu(m, conn, prefix);
  if (action === "ratio") {
    if (!["9:16", "16:9", "1:1", "4:5"].includes(argument)) return m.reply("Rasio yang didukung: 9:16, 16:9, 1:1, 4:5.");
    session.settings = normalizeEditSettings({ ...session.settings, ratio: argument });
    return showSettingsMenu(m, conn, prefix);
  }
  if (action === "duration") {
    const duration = Number(argument);
    if (![30, 60, 90, 120, 180].includes(duration)) return m.reply("Durasi maksimum yang didukung: 30, 60, 90, 120, atau 180 detik.");
    session.settings = normalizeEditSettings({ ...session.settings, maxDurationSeconds: duration });
    return showSettingsMenu(m, conn, prefix);
  }
  if (action === "silence") {
    const value = argument.toLowerCase();
    const removeSilence = value === "toggle" ? !session.settings.removeSilence : ["on", "off"].includes(value) ? value === "on" : null;
    if (removeSilence === null) return m.reply("Gunakan .edit silence on, .edit silence off, atau .edit silence toggle.");
    session.settings = normalizeEditSettings({ ...session.settings, removeSilence });
    return showSettingsMenu(m, conn, prefix);
  }
  if (action === "auto") {
    const plan = createDefaultEditPlan(session.settings);
    return queuePlan(m, conn, session, plan);
  }
  if (action === "json") {
    if (argument) {
      let plan;
      try { plan = parseJsonInput(argument); } catch (error) { return m.reply(error.message); }
      return queuePlan(m, conn, session, plan);
    }
    session.awaitingJson = true;
    return m.reply(
      "📋 *TEMPEL JSON EDIT PLAN*\n\n" +
      "Kirim satu objek JSON dari GPT Plus pada pesan berikutnya. Bot tidak menjalankan model AI; JSON akan divalidasi lalu diproses oleh FFmpeg.\n" +
      "Batas " + MAX_PROMPT_CHARS + " karakter. Sesi berlaku 30 menit.\n\n" +
      "Ketik " + prefix + "edit cancel untuk membatalkan."
    );
  }
  if (action === "reset") {
    session.settings = normalizeEditSettings({});
    return showSettingsMenu(m, conn, prefix);
  }
  return showMainMenu(m, conn, prefix);
}

const handler = async (m, context = {}) => {
  if (context.isROwner !== true) return m.reply("Fitur AI Edit hanya dapat digunakan oleh owner.");
  try {
    return await handleCommand(m, context);
  } catch (error) {
    console.error("[EDIT] Command gagal:", error?.stack || error);
    return m.reply("❌ Fitur .edit gagal: " + String(error?.message || error).slice(0, 700));
  }
};

global.__alvarethEditPromptHandler = async (m, context = {}) => {
  if (context.isROwner !== true || wasBotSentMessage(m)) return false;
  const key = sessionKey(m);
  const session = sessions.get(key);
  if (!session || session.sender !== m.sender || !session.awaitingJson) return false;

  const prompt = String(m.text || "").trim();
  if (!prompt) return false;
  if (hasCommandPrefix(prompt, context.conn?.prefix ?? global.prefix)) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    await clearSession(key);
    await sendText(context.conn, m.chat, "⌛ Sesi .edit kedaluwarsa. Reply video lagi dengan .edit untuk memulai ulang.");
    return true;
  }
  try {
    const plan = parseJsonInput(prompt);
    await queuePlan(m, context.conn, session, plan);
  } catch (error) {
    await sendText(context.conn, m.chat, "❌ " + String(error?.message || error).slice(0, 900) + "\nSesi JSON tetap aktif; kirim JSON yang sudah diperbaiki atau .edit cancel.");
  }
  return true;
};

handler.help = ["edit"];
handler.tags = ["owner"];
handler.command = /^edit$/i;
handler.rowner = true;

export default handler;
