import { resolve } from "node:path";

const ACTIONS = new Map([
  ["generate", "generate"], ["buat", "generate"], ["create", "generate"],
  ["status", "status"], ["progress", "status"], ["progres", "status"],
  ["history", "history"], ["riwayat", "history"],
  ["guide", "guide"], ["panduan", "guide"],
  ["services", "services"], ["layanan", "services"],
  ["cancel", "cancel"], ["batal", "cancel"],
  ["send", "send"], ["kirim", "send"]
]);

export function parseRemotionCommand(value) {
  const raw = String(value || "").trim();
  if (!raw) return { action: "menu" };

  const match = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const token = String(match?.[1] || "").toLowerCase();
  const rest = String(match?.[2] || "").trim();
  const action = ACTIONS.get(token);

  if (!action) return { action: "generate", prompt: raw };
  if (action === "generate") return { action, prompt: rest };
  if (action === "send") return { action, jobId: rest };
  return { action, argument: rest };
}

const STAGE_LABELS = Object.freeze({
  queued: "Menunggu antrean",
  "preparing-media": "Menyiapkan aset lokal",
  "preparing-voiceover": "Membuat narasi VoxCPM2 dan subtitle",
  "generating-ai-video": "Membuat footage AI lokal",
  rendering: "Merender komposisi MP4 dengan sound design",
  completed: "Selesai",
  failed: "Gagal"
});

export function remotionStageLabel(stage) {
  const key = String(stage || "").trim();
  return STAGE_LABELS[key] || (key ? key.replace(/[-_]/g, " ") : "Menyiapkan pekerjaan");
}

export function formatRemotionJob(job) {
  if (!job || typeof job !== "object") return "Pekerjaan tidak ditemukan.";
  const statusLabels = {
    queued: "Dalam antrean",
    rendering: "Sedang diproses",
    completed: "Selesai",
    failed: "Gagal"
  };
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  return [
    "ID: " + String(job.id || "-"),
    "Judul: " + String(job.title || "Video tanpa judul"),
    "Status: " + (statusLabels[job.status] || String(job.status || "Tidak diketahui")),
    "Tahap: " + remotionStageLabel(job.stage),
    "Progres render: " + progress + "%",
    "Durasi: " + (Number(job.durationSeconds) || 0) + " detik",
    "Rasio: " + String(job.ratio || "-"),
    "Scene: " + (Number(job.sceneCount) || 0)
  ].join("\n");
}

export function getRemotionProviderReadiness(env = {}, fileExists = () => false, runtime = {}) {
  const plannerUrl = String(env.VIDEO_STUDIO_AI_BASE_URL || "http://127.0.0.1:11434/v1").trim();
  const plannerModel = String(env.VIDEO_STUDIO_AI_MODEL || "qwen3:8b").trim();
  const voxcpmBin = String(env.VIDEO_STUDIO_VOXCPM_BIN || "voxcpm").trim();
  const videoWorkflow = String(env.VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE || "").trim();
  const imageWorkflow = String(env.VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE || "").trim();
  const exists = value => {
    if (!value) return false;
    try { return Boolean(fileExists(resolve(value))); }
    catch { return false; }
  };

  return [
    {
      name: "Local storyboard LLM (Ollama)",
      configured: Boolean(plannerUrl && plannerModel && runtime.ollamaModelReady),
      detail: runtime.ollamaModelReady
        ? "Ollama dan model " + plannerModel + " terdeteksi secara lokal."
        : "Instal Ollama, unduh " + plannerModel + ", lalu pastikan endpoint lokal " + plannerUrl + " aktif."
    },
    {
      name: "Remotion + FFmpeg",
      configured: Boolean(runtime.remotionInstalled && runtime.ffmpegInstalled),
      detail: runtime.remotionInstalled && runtime.ffmpegInstalled
        ? "Paket Remotion dan ffmpeg/ffprobe terdeteksi."
        : "Periksa node_modules Remotion serta instalasi ffmpeg dan ffprobe di Linux."
    },
    {
      name: "VoxCPM2 + word timestamps",
      configured: Boolean(runtime.voxcpmInstalled),
      detail: runtime.voxcpmInstalled
        ? "VoxCPM2 CLI terdeteksi (" + voxcpmBin + "); TTS dan Stable-ts berjalan lokal."
        : "Instal pip install 'voxcpm[timestamps]' pada Python 3.10–3.12, lalu pastikan perintah voxcpm tersedia."
    },
    {
      name: "ComfyUI video workflow",
      configured: exists(videoWorkflow),
      detail: exists(videoWorkflow)
        ? "Workflow video lokal ditemukan. Gunakan model dan weights open-license; WAN tidak digunakan."
        : "Opsional: pasang workflow API-format CogVideoX-2B atau model lokal lain yang lisensinya sesuai."
    },
    {
      name: "Character reference image",
      configured: exists(imageWorkflow),
      detail: exists(imageWorkflow)
        ? "Workflow ComfyUI image ditemukan; workflow video juga harus memakai placeholder {{REFERENCE_IMAGE}}."
        : "Opsional: pasang workflow image generation untuk membuat referensi karakter sebelum image-to-video."
    },
    {
      name: "Event-based sound effects",
      configured: Boolean(runtime.remotionInstalled),
      detail: "13 efek suara procedural lokal; dipicu oleh soundEvents pada timeline. Tidak membutuhkan API atau kuota."
    },
    {
      name: "Background music",
      configured: false,
      detail: "Nonaktif secara default. Video tetap dirender dengan narasi dan sound effects; musik hanya ditambahkan jika nanti ada track yang dipilih."
    }
  ];
}
