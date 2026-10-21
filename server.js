import express from 'express'

const app = global.app = express()

export default function connect(port = Number(process.env.PORT || 3000)) {
  app.disable('x-powered-by')
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alvareth Bot</title>
<style>body{font-family:system-ui,sans-serif;background:#10131a;color:#e8edf5;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:620px;padding:2rem;border:1px solid #303746;border-radius:20px;background:#181e29}h1{margin-top:0}code{color:#77e0bf}</style></head>
<body><main class="card"><h1>Alvareth Bot</h1><p>WhatsApp Multi-Device Bot</p><p>Server berjalan. Endpoint health: <code>/health</code></p></main></body></html>`))
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', bot: 'Alvareth Bot', uptime: Math.floor(process.uptime()) }))
  app.get('/ping', (_req, res) => res.status(200).send('pong'))
  const server = app.listen(port, () => console.log(`[Alvareth Bot] HTTP server listen on ${port}`))
  return server
}
