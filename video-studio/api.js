import { timingSafeEqual } from 'crypto'
import { createReadStream } from 'fs'
import { createVideoJob, getVideoJob, getVideoOutput, listVideoJobs, startVideoQueue } from './queue.js'
import { getVideoStudioLimits } from './validate.js'

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

export function mountVideoStudioApi(app) {
  const allowedOrigins = new Set((process.env.VIDEO_STUDIO_ALLOWED_ORIGINS || 'https://lightjurnal.my.id').split(',').map(value => value.trim()).filter(Boolean))
  app.use('/api/video-studio', (req, res, next) => {
    const origin = req.headers.origin
    if (origin) {
      if (!allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origin tidak diizinkan.' })
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
  app.get('/api/video-studio/health', (_req, res) => res.json({ service: 'Alvareth Video Studio', status: 'ok', configured: Boolean(process.env.VIDEO_STUDIO_API_KEY) }))
  app.use('/api/video-studio', (req, res, next) => {
    const expected = process.env.VIDEO_STUDIO_API_KEY
    if (!expected || expected.length < 32) return res.status(503).json({ error: 'Video Studio API belum dikonfigurasi dengan API key minimal 32 karakter.' })
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\\s+/i, '')
    if (!safeEqual(supplied, expected)) return res.status(401).json({ error: 'API key tidak valid.' })
    next()
  })
  startVideoQueue()
  app.get('/api/video-studio/limits', (_req, res) => res.json(getVideoStudioLimits()))
  app.get('/api/video-studio/jobs', (_req, res) => res.json({ jobs: listVideoJobs(30) }))
  app.post('/api/video-studio/jobs', (req, res) => {
    try { res.status(202).json({ job: createVideoJob(req.body) }) }
    catch (error) { res.status(400).json({ error: error.message || 'Proyek tidak valid.' }) }
  })
  app.get('/api/video-studio/jobs/:id', (req, res) => {
    const job = getVideoJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'Pekerjaan tidak ditemukan.' })
    res.json({ job })
  })
  app.get('/api/video-studio/jobs/:id/download', (req, res) => {
    const output = getVideoOutput(req.params.id)
    if (!output) return res.status(404).json({ error: 'Video belum tersedia.' })
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Disposition', `attachment; filename="lightjurnal-${req.params.id}.mp4"`)
    createReadStream(output.path).pipe(res)
  })
}
