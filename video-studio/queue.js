import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { renderVideoProject } from './renderer.js'
import { validateVideoProject } from './validate.js'

const DATA_DIR = process.env.ALVARETH_DATA_DIR ? resolve(process.env.ALVARETH_DATA_DIR) : join(homedir(), '.alvareth-bot-data')
const VIDEO_DIR = join(DATA_DIR, 'video-studio')
const JOBS_FILE = join(VIDEO_DIR, 'jobs.json')
const OUTPUT_DIR = join(VIDEO_DIR, 'renders')
const jobs = new Map()
let running = false
let started = false

function persist() {
  mkdirSync(VIDEO_DIR, { recursive: true })
  const temp = JOBS_FILE + '.tmp'
  writeFileSync(temp, JSON.stringify(Array.from(jobs.values()), null, 2))
  renameSync(temp, JOBS_FILE)
}
function publicJob(job) {
  return { id: job.id, title: job.project.title, mode: job.project.mode, status: job.status, progress: job.progress, createdAt: job.createdAt, updatedAt: job.updatedAt, durationSeconds: job.project.durationSeconds, error: job.error || null, hasOutput: job.status === 'completed' && Boolean(job.outputPath) }
}
function update(job, values) {
  Object.assign(job, values, { updatedAt: new Date().toISOString() })
  persist()
}
async function pump() {
  if (running) return
  const next = Array.from(jobs.values()).find(job => job.status === 'queued')
  if (!next) return
  running = true
  const outputPath = join(OUTPUT_DIR, next.id + '.mp4')
  try {
    update(next, { status: 'rendering', progress: 0, error: null, outputPath })
    await renderVideoProject(next.project, outputPath, progress => { if (progress !== next.progress) update(next, { progress }) })
    const sizeBytes = statSync(outputPath).size
    update(next, { status: 'completed', progress: 100, sizeBytes, outputPath })
    console.log(`[VIDEO STUDIO] Render selesai: ${next.id} (${sizeBytes} bytes)`)
  } catch (error) {
    update(next, { status: 'failed', error: String(error?.message || error).slice(0, 500), outputPath: null })
    console.error(`[VIDEO STUDIO] Render gagal ${next.id}:`, error)
  } finally {
    running = false
    setImmediate(pump)
  }
}
export function startVideoQueue() {
  if (started) return
  started = true
  mkdirSync(OUTPUT_DIR, { recursive: true })
  if (existsSync(JOBS_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(JOBS_FILE, 'utf8'))
      if (Array.isArray(saved)) for (const job of saved.slice(-100)) {
        if (!job || typeof job.id !== 'string' || !job.project) continue
        if (job.status === 'rendering') { job.status = 'failed'; job.error = 'Proses bot berhenti ketika rendering berlangsung.'; job.outputPath = null }
        jobs.set(job.id, job)
      }
    } catch (error) { console.error('[VIDEO STUDIO] Database antrean tidak dapat dibaca:', error.message) }
  }
  persist()
  setImmediate(pump)
}
export function createVideoJob(input) {
  const active = Array.from(jobs.values()).filter(job => ['queued', 'rendering'].includes(job.status)).length
  if (active >= 5) throw new Error('Antrean penuh. Tunggu pekerjaan sebelumnya selesai.')
  const project = validateVideoProject(input)
  const now = new Date().toISOString()
  const job = { id: randomUUID(), project, status: 'queued', progress: 0, createdAt: now, updatedAt: now, outputPath: null, error: null }
  jobs.set(job.id, job)
  persist()
  setImmediate(pump)
  return publicJob(job)
}
export function getVideoJob(id) {
  const job = jobs.get(id)
  return job ? publicJob(job) : null
}
export function listVideoJobs(limit = 20) {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(publicJob)
}
export function getVideoOutput(id) {
  const job = jobs.get(id)
  if (!job || job.status !== 'completed' || !job.outputPath || !existsSync(job.outputPath)) return null
  return { path: job.outputPath, title: job.project.title }
}
