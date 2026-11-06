import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { renderEditVideo } from "./engine.js";
import { validateEditPlan } from "./schema.js";

const DATA_ROOT = path.resolve(process.env.ALVARETH_DATA_DIR || path.join(homedir(), ".alvareth-bot-data"));
const EDIT_ROOT = path.join(DATA_ROOT, "video-edit");
const UPLOAD_DIR = path.join(EDIT_ROOT, "uploads");
const RENDER_DIR = path.join(EDIT_ROOT, "renders");
const WORK_DIR = path.join(EDIT_ROOT, "work");
const state = global.__alvarethEditQueueState || (global.__alvarethEditQueueState = {
  jobs: new Map(),
  pending: [],
  running: false
});

function publicJob(job) {
  return {
    id: job.id,
    title: job.title,
    sender: job.sender,
    chat: job.chat,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputPath: job.status === "completed" ? job.outputPath : null,
    result: job.result || null,
    error: job.error || null,
    deliveryError: job.deliveryError || null,
    warnings: Array.isArray(job.warnings) ? job.warnings.slice(0, 5) : []
  };
}

async function ensureDirectories() {
  await Promise.all([
    mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 }),
    mkdir(RENDER_DIR, { recursive: true, mode: 0o700 }),
    mkdir(WORK_DIR, { recursive: true, mode: 0o700 })
  ]);
}

function pruneHistory() {
  if (state.jobs.size < 50) return;
  const terminal = Array.from(state.jobs.values())
    .filter(job => ["completed", "failed"].includes(job.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (state.jobs.size >= 50 && terminal.length) {
    const old = terminal.shift();
    if (old.outputPath) void rm(old.outputPath, { force: true }).catch(() => {});
    state.jobs.delete(old.id);
  }
}

async function pump() {
  if (state.running) return;
  const job = state.pending.shift();
  if (!job) return;
  state.running = true;
  job.status = "rendering";
  job.stage = "analisis-media";
  job.updatedAt = new Date().toISOString();
  try {
    await ensureDirectories();
    const workDir = path.join(WORK_DIR, job.id);
    job.stage = "rendering";
    const result = await renderEditVideo({
      sourcePath: job.sourcePath,
      outputPath: job.outputPath,
      workDir,
      inputPlan: job.plan,
      settings: job.settings,
      onProgress: progress => {
        job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
        job.stage = "rendering";
        job.updatedAt = new Date().toISOString();
        job.onProgress?.(publicJob(job));
      },
      onWarning: warning => {
        job.warnings.push(String(warning).slice(0, 240));
      }
    });
    job.result = result;
    job.status = "completed";
    job.stage = "completed";
    job.progress = 100;
    job.updatedAt = new Date().toISOString();
    try {
      await job.onComplete?.(publicJob(job));
    } catch (error) {
      job.deliveryError = String(error?.message || error).slice(0, 500);
      job.updatedAt = new Date().toISOString();
    }
  } catch (error) {
    job.status = "failed";
    job.stage = "failed";
    job.error = String(error?.message || error).slice(0, 1400);
    job.updatedAt = new Date().toISOString();
    await rm(job.outputPath, { force: true }).catch(() => {});
    try { await job.onError?.(publicJob(job)); } catch {}
  } finally {
    state.running = false;
    setImmediate(pump);
  }
}

export function enqueueEditJob(input) {
  if (!input || typeof input !== "object") throw new Error("Data pekerjaan edit tidak valid.");
  if (typeof input.sourcePath !== "string" || !input.sourcePath.trim()) throw new Error("File sumber belum tersedia.");
  const active = Array.from(state.jobs.values()).filter(job => ["queued", "rendering"].includes(job.status)).length;
  if (active >= 3) throw new Error("Antrean .edit penuh. Maksimal 3 pekerjaan dapat menunggu atau dirender bersamaan.");
  pruneHistory();
  const settings = input.settings || {};
  const plan = validateEditPlan(input.plan, { settings });
  const id = randomUUID().replace(/-/g, "").slice(0, 10);
  const now = new Date().toISOString();
  const job = {
    id,
    title: plan.title,
    sender: String(input.sender || ""),
    chat: String(input.chat || ""),
    sourcePath: input.sourcePath,
    outputPath: path.join(RENDER_DIR, id + ".mp4"),
    plan,
    settings,
    status: "queued",
    stage: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
    deliveryError: null,
    warnings: [],
    onProgress: input.onProgress,
    onComplete: input.onComplete,
    onError: input.onError
  };
  state.jobs.set(id, job);
  state.pending.push(job);
  setImmediate(pump);
  return publicJob(job);
}

export function getEditJob(id, sender) {
  const job = state.jobs.get(String(id || ""));
  if (!job || (sender && job.sender !== sender)) return null;
  return publicJob(job);
}

export function listEditJobs(sender, limit = 10) {
  return Array.from(state.jobs.values())
    .filter(job => !sender || job.sender === sender)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 10)))
    .map(publicJob);
}

export async function getEditOutput(id, sender) {
  const job = state.jobs.get(String(id || ""));
  if (!job || job.sender !== sender || job.status !== "completed" || !job.outputPath) return null;
  try {
    const info = await stat(job.outputPath);
    return info.isFile() && info.size > 0 ? { path: job.outputPath, title: job.title, result: job.result } : null;
  } catch {
    return null;
  }
}

export const editStoragePaths = Object.freeze({ root: EDIT_ROOT, uploads: UPLOAD_DIR, renders: RENDER_DIR });
