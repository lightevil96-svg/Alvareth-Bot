import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { renderVideoProject } from "./renderer.js";
import { validateVideoProject } from "./validate.js";
import { prepareVideoMedia } from "./media/pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "remotion", "public", "generated");
const DATA_DIR = process.env.ALVARETH_DATA_DIR ? resolve(process.env.ALVARETH_DATA_DIR) : join(homedir(), ".alvareth-bot-data");
const VIDEO_DIR = join(DATA_DIR, "video-studio");
const JOBS_FILE = join(VIDEO_DIR, "jobs.json");
const OUTPUT_DIR = join(VIDEO_DIR, "renders");
const jobs = new Map();
let running = false;
let started = false;

function persist() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const temp = JOBS_FILE + ".tmp";
  writeFileSync(temp, JSON.stringify(Array.from(jobs.values()), null, 2));
  renameSync(temp, JOBS_FILE);
}
function publicJob(job) {
  const project = job.project;
  return {
    id: job.id,
    title: project.title,
    mode: project.mode,
    status: job.status,
    stage: job.stage || job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    durationSeconds: project.durationSeconds,
    sceneCount: project.scenes.length,
    ratio: project.ratio,
    planSummary: project.planSummary || "",
    voiceoverEnabled: Boolean(project.voiceoverTracks?.length),
    captionsEnabled: Boolean(project.captions?.length),
    footageCount: Number(project.footageCount || project.scenes.filter(scene => scene.footageSrc).length || 0),
    aiFootageCount: Number(project.aiFootageCount || 0),
    soundEffectsEnabled: project.soundEffects !== false,
    musicEnabled: Boolean(project.musicTrackSrc),
    mediaWarnings: Array.isArray(project.mediaWarnings) ? project.mediaWarnings : [],
    mediaCredits: Array.isArray(project.mediaCredits) ? project.mediaCredits : [],
    error: job.error || null,
    hasOutput: job.status === "completed" && Boolean(job.outputPath)
  };
}
function cleanupGeneratedAssets(jobId) {
  const folder = join(GENERATED_DIR, String(jobId || ""));
  if (folder.startsWith(GENERATED_DIR + sep)) {
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) { console.warn("[VIDEO STUDIO] Gagal membersihkan aset sementara:", error.message); }
  }
}
function cleanupJobFiles(job) {
  if (job?.outputPath && existsSync(job.outputPath)) {
    try { unlinkSync(job.outputPath); } catch (error) { console.warn("[VIDEO STUDIO] Gagal membersihkan MP4 lama:", error.message); }
  }
  cleanupGeneratedAssets(job?.id);
}
function update(job, values) {
  Object.assign(job, values, { updatedAt: new Date().toISOString() });
  persist();
}
async function pump() {
  if (running) return;
  const next = Array.from(jobs.values()).find(job => job.status === "queued");
  if (!next) return;
  running = true;
  const outputPath = join(OUTPUT_DIR, next.id + ".mp4");
  try {
    update(next, { status: "rendering", stage: "preparing-media", progress: 0, error: null, outputPath });
    const prepared = await prepareVideoMedia(next.project, next.id, stage => {
      const labels = {
        voiceover: "preparing-voiceover",
        "ai-video": "generating-ai-video",
        footage: "searching-footage",
        "ai-music": "generating-ai-music"
      };
      update(next, { stage: labels[stage] || "preparing-media" });
    });
    next.project = validateVideoProject(prepared);
    update(next, { project: next.project, stage: "rendering" });
    await renderVideoProject(next.project, outputPath, progress => {
      if (progress !== next.progress) update(next, { stage: "rendering", progress });
    });
    const sizeBytes = statSync(outputPath).size;
    cleanupGeneratedAssets(next.id);
    update(next, { status: "completed", stage: "completed", progress: 100, sizeBytes, outputPath });
    console.log("[VIDEO STUDIO] Render selesai: " + next.id + " (" + sizeBytes + " bytes)");
  } catch (error) {
    try { if (existsSync(outputPath)) unlinkSync(outputPath); }
    catch (cleanupError) { console.warn("[VIDEO STUDIO] Gagal membersihkan render parsial:", cleanupError.message); }
    cleanupGeneratedAssets(next.id);
    update(next, { status: "failed", stage: "failed", error: String(error?.message || error).slice(0, 500), outputPath: null });
    console.error("[VIDEO STUDIO] Render gagal " + next.id + ":", error);
  } finally {
    running = false;
    setImmediate(pump);
  }
}
export function startVideoQueue() {
  if (started) return;
  started = true;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(JOBS_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(JOBS_FILE, "utf8"));
      if (Array.isArray(saved)) for (const job of saved.slice(-100)) {
        if (!job || typeof job.id !== "string" || !job.project) continue;
        if (job.status === "rendering") {
          job.status = "failed";
          job.stage = "failed";
          job.error = "Proses bot berhenti ketika rendering berlangsung.";
          job.outputPath = null;
          cleanupGeneratedAssets(job.id);
        }
        jobs.set(job.id, job);
      }
    } catch (error) { console.error("[VIDEO STUDIO] Database antrean tidak dapat dibaca:", error.message); }
  }
  persist();
  setImmediate(pump);
}
function pruneHistory() {
  if (jobs.size < 100) return;
  const terminal = Array.from(jobs.values()).filter(job => ["completed", "failed"].includes(job.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (jobs.size >= 100 && terminal.length) {
    const old = terminal.shift();
    cleanupJobFiles(old);
    jobs.delete(old.id);
  }
}

export function createVideoJob(input) {
  pruneHistory();
  if (jobs.size >= 100) throw new Error("Riwayat render penuh. Hapus riwayat lama sebelum membuat pekerjaan baru.");
  const active = Array.from(jobs.values()).filter(job => ["queued", "rendering"].includes(job.status)).length;
  if (active >= 5) throw new Error("Antrean penuh. Tunggu pekerjaan sebelumnya selesai.");
  const project = validateVideoProject(input);
  const now = new Date().toISOString();
  const job = { id: randomUUID(), project, status: "queued", stage: "queued", progress: 0, createdAt: now, updatedAt: now, outputPath: null, error: null };
  jobs.set(job.id, job);
  persist();
  setImmediate(pump);
  return publicJob(job);
}
export function getVideoJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}
export function listVideoJobs(limit = 20) {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(publicJob);
}
export function getVideoOutput(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "completed" || !job.outputPath || !existsSync(job.outputPath)) return null;
  return { path: job.outputPath, title: job.project.title };
}
