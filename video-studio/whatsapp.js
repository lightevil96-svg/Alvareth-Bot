import { resolve } from "node:path";

const ACTIONS = new Map([
  ["generate", "generate"], ["buat", "generate"], ["create", "generate"],
  ["status", "status"], ["progress", "status"], ["progres", "status"],
  ["history", "history"], ["riwayat", "history"],
  ["guide", "guide"], ["panduan", "guide"],
  ["services", "services"], ["layanan", "services"],
  ["services-menu", "servicesMenu"], ["install-menu", "installMenu"],
  ["voice", "voice"], ["suara", "voice"],
  ["hardware", "hardware"], ["specs", "hardware"], ["server", "hardware"],
  ["install", "install"], ["pasang", "install"], ["setup", "install"],
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
  "verifying-output": "Memeriksa MP4 dan audio",
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
    "verifying-output": "Memeriksa MP4 dan audio",
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
  const voiceUrl = String(env.VIDEO_STUDIO_VOXCPM_URL || "http://127.0.0.1:7861").trim();
  const voiceover = Boolean(voiceUrl);
  const videoWorkflow = String(env.VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE || "").trim();
  const imageWorkflow = String(env.VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE || "").trim();
  const musicWorkflow = String(env.VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE || "").trim();
  const workflowStatus = value => {
    if (!value) return { exists: false, configured: false, detail: "" };
    let path;
    try {
      path = resolve(value);
      if (!fileExists(path)) return { exists: false, configured: false, detail: "" };
    } catch {
      return { exists: false, configured: false, detail: "" };
    }
    if (typeof runtime.workflowCheck !== "function") {
      return { exists: true, configured: true, detail: "Workflow ComfyUI ditemukan." };
    }
    try {
      const result = runtime.workflowCheck(path);
      if (result && typeof result === "object") {
        return { exists: true, configured: Boolean(result.configured), detail: String(result.detail || "Workflow ComfyUI ditemukan.") };
      }
      return {
        exists: true,
        configured: Boolean(result),
        detail: result ? "Workflow ComfyUI lolos pemeriksaan." : "Workflow ditemukan tetapi belum lolos pemeriksaan SHA-256."
      };
    } catch (error) {
      return {
        exists: true,
        configured: false,
        detail: "Workflow ditemukan tetapi belum lolos pemeriksaan: " + String(error?.message || error).slice(0, 220)
      };
    }
  };

  const video = workflowStatus(videoWorkflow);
  const image = workflowStatus(imageWorkflow);
  const music = workflowStatus(musicWorkflow);
  let reference = image;
  if (image.exists) {
    if (!video.exists || !video.configured) {
      reference = {
        exists: true,
        configured: false,
        detail: image.configured
          ? "Workflow image tersedia, tetapi workflow video belum tersedia atau belum lolos pemeriksaan SHA-256."
          : image.detail
      };
    } else if (typeof runtime.referenceWorkflowCheck === "function") {
      try {
        const result = runtime.referenceWorkflowCheck(resolve(imageWorkflow), resolve(videoWorkflow));
        reference = result && typeof result === "object"
          ? { exists: true, configured: Boolean(result.configured), detail: String(result.detail || "Kecocokan reference workflow belum terverifikasi.") }
          : { exists: true, configured: Boolean(result), detail: result ? "Workflow reference kompatibel." : "Workflow video belum memakai placeholder {{REFERENCE_IMAGE}}." };
      } catch (error) {
        reference = { exists: true, configured: false, detail: "Pemeriksaan reference workflow gagal: " + String(error?.message || error).slice(0, 220) };
      }
    } else {
      reference = {
        exists: true,
        configured: Boolean(image.configured && video.configured),
        detail: image.configured && video.configured
          ? "Workflow image ditemukan; pastikan workflow video memakai placeholder {{REFERENCE_IMAGE}}."
          : image.detail || video.detail
      };
    }
  }

  return [
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
      detail: "Endpoint " + voiceUrl + (env.VIDEO_STUDIO_VOXCPM_URL ? "" : " (default)") + "; bot dapat menjalankan adapter lokal otomatis jika virtualenv dan model tersedia."
    },
    {
      name: "AI video footage",
      configured: video.configured,
      detail: video.exists ? video.detail : "Opsional: pasang workflow API-format ComfyUI dan isi VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE."
    },
    {
      name: "Character reference image",
      configured: reference.configured,
      detail: image.exists ? reference.detail : "Opsional: pasang workflow image generation untuk membuat referensi karakter sebelum image-to-video."
    },
    {
      name: "AI background music",
      configured: music.configured,
      detail: music.exists ? music.detail : "Opsional: pasang workflow API-format ComfyUI audio dan isi VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE."
    }
  ];
}