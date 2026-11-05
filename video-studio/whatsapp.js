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
  "preparing-media": "Menyiapkan aset video",
  "preparing-voiceover": "Membuat voice-over dan timing subtitle",
  "generating-ai-video": "Membuat footage AI",
  "searching-footage": "Mencari footage stok",
  "generating-ai-music": "Membuat musik AI",
  rendering: "Merender komposisi MP4",
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
  const plannerKey = Boolean(String(env.VIDEO_STUDIO_AI_API_KEY || env.OPENAI_API_KEY || "").trim());
  const fallbackUrl = String(env.VIDEO_STUDIO_AI_FALLBACK_URL || "https://api-faa.my.id/faa/gpt-promt").trim();
  const voiceover = Boolean(
    String(env.VIDEO_STUDIO_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY || "").trim() &&
    String(env.VIDEO_STUDIO_ELEVENLABS_VOICE_ID || "").trim()
  );
  const pexels = Boolean(String(env.VIDEO_STUDIO_PEXELS_API_KEY || env.PEXELS_API_KEY || "").trim());
  const videoWorkflow = String(env.VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE || "").trim();
  const musicWorkflow = String(env.VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE || "").trim();
  const exists = value => {
    if (!value) return false;
    try { return Boolean(fileExists(resolve(value))); }
    catch { return false; }
  };

  return [
    {
      name: "AI prompt planner",
      configured: plannerKey || Boolean(fallbackUrl),
      detail: plannerKey ? "API key OpenAI-compatible tersedia." : "Fallback endpoint tersedia; konektivitas belum diuji."
    },
    {
      name: "Remotion + FFmpeg",
      configured: Boolean(runtime.remotionInstalled && runtime.ffmpegInstalled),
      detail: runtime.remotionInstalled && runtime.ffmpegInstalled
        ? "Paket Remotion dan ffmpeg/ffprobe terdeteksi."
        : "Periksa node_modules Remotion serta instalasi ffmpeg dan ffprobe di Linux."
    },
    {
      name: "Voice-over + subtitle sinkron",
      configured: voiceover,
      detail: voiceover ? "ElevenLabs API key dan Voice ID tersedia." : "Opsional: isi VIDEO_STUDIO_ELEVENLABS_API_KEY dan VIDEO_STUDIO_ELEVENLABS_VOICE_ID."
    },
    {
      name: "Stock footage",
      configured: pexels,
      detail: pexels ? "Pexels API key tersedia." : "Opsional: isi VIDEO_STUDIO_PEXELS_API_KEY."
    },
    {
      name: "AI video footage",
      configured: exists(videoWorkflow),
      detail: exists(videoWorkflow) ? "Workflow ComfyUI video ditemukan." : "Opsional: pasang workflow API-format ComfyUI dan isi VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE."
    },
    {
      name: "AI background music",
      configured: exists(musicWorkflow),
      detail: exists(musicWorkflow) ? "Workflow ComfyUI audio ditemukan." : "Opsional: pasang workflow API-format ComfyUI audio dan isi VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE."
    }
  ];
}
