import { randomBytes, timingSafeEqual } from "crypto"
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs"
import { homedir } from "os"
import { join, resolve } from "path"
import { createVideoJob, getVideoJob, getVideoOutput, listVideoJobs, startVideoQueue } from "./queue.js"
import { getVideoStudioLimits } from "./validate.js"
import { planVideoPrompt } from "./prompt/planner.js"
import { compileVideoPlan } from "./prompt/compile.js"

const DATA_DIR = process.env.ALVARETH_DATA_DIR ? resolve(process.env.ALVARETH_DATA_DIR) : join(homedir(), ".alvareth-bot-data")
const VIDEO_DIR = join(DATA_DIR, "video-studio")
const API_KEY_FILE = join(VIDEO_DIR, "api-key")

function loadApiKey() {
  const configured = String(process.env.VIDEO_STUDIO_API_KEY || "").trim()
  if (configured.length >= 32) return configured
  mkdirSync(VIDEO_DIR, { recursive: true })
  if (existsSync(API_KEY_FILE)) {
    const saved = readFileSync(API_KEY_FILE, "utf8").trim()
    if (saved.length >= 32) return saved
  }
  const generated = randomBytes(32).toString("hex")
  writeFileSync(API_KEY_FILE, generated + "\n", { mode: 0o600, flag: "wx" })
  try { chmodSync(API_KEY_FILE, 0o600) } catch {}
  console.log("[VIDEO STUDIO] API key otomatis dibuat dan disimpan di " + API_KEY_FILE)
  console.log("[VIDEO STUDIO] Salin key dari file tersebut ke kolom API key di LightJurnal. Jangan bagikan key ini.")
  return generated
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""))
  const right = Buffer.from(String(b || ""))
  return left.length === right.length && timingSafeEqual(left, right)
}

export function mountVideoStudioApi(app) {
  const apiKey = loadApiKey()
  const allowedOrigins = new Set((process.env.VIDEO_STUDIO_ALLOWED_ORIGINS || "https://lightjurnal.my.id").split(",").map(value => value.trim()).filter(Boolean))
  app.use("/api/video-studio", (req, res, next) => {
    const origin = req.headers.origin
    if (origin) {
      if (!allowedOrigins.has(origin)) return res.status(403).json({ error: "Origin tidak diizinkan." })
      res.setHeader("Access-Control-Allow-Origin", origin)
      res.setHeader("Vary", "Origin")
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    }
    if (req.method === "OPTIONS") return res.sendStatus(204)
    next()
  })
  app.get("/api/video-studio/health", (_req, res) => res.json({
    service: "Alvareth Video Studio",
    status: "ok",
    configured: apiKey.length >= 32,
    media: {
      voiceover: Boolean(process.env.VIDEO_STUDIO_ELEVENLABS_API_KEY && process.env.VIDEO_STUDIO_ELEVENLABS_VOICE_ID),
      stockFootage: Boolean(process.env.VIDEO_STUDIO_PEXELS_API_KEY)
    }
  }))
  app.use("/api/video-studio", (req, res, next) => {
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "")
    if (!safeEqual(supplied, apiKey)) return res.status(401).json({ error: "API key tidak valid." })
    next()
  })
  startVideoQueue()
  app.get("/api/video-studio/limits", (_req, res) => res.json(getVideoStudioLimits()))
  app.get("/api/video-studio/jobs", (_req, res) => res.json({ jobs: listVideoJobs(30) }))
  app.post("/api/video-studio/plan", async (req, res) => {
    try {
      const plan = await planVideoPrompt(req.body && req.body.prompt)
      return res.json({ plan })
    } catch (error) {
      return res.status(Number(error && error.statusCode) || 502).json({ error: error && error.message || "AI gagal menyusun storyboard." })
    }
  })
  app.post("/api/video-studio/jobs", (req, res) => {
    try {
      const input = req.body && req.body.plan ? compileVideoPlan(req.body.plan) : req.body
      return res.status(202).json({ job: createVideoJob(input) })
    } catch (error) {
      return res.status(400).json({ error: error && error.message || "Proyek tidak valid." })
    }
  })
  app.get("/api/video-studio/jobs/:id", (req, res) => {
    const job = getVideoJob(req.params.id)
    if (!job) return res.status(404).json({ error: "Pekerjaan tidak ditemukan." })
    res.json({ job })
  })
  app.get("/api/video-studio/jobs/:id/download", (req, res) => {
    const output = getVideoOutput(req.params.id)
    if (!output) return res.status(404).json({ error: "Video belum tersedia." })
    res.setHeader("Content-Type", "video/mp4")
    res.setHeader("Content-Disposition", "attachment; filename=\"lightjurnal-" + req.params.id + ".mp4\"")
    createReadStream(output.path).pipe(res)
  })
}
