import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let child = null
let retryTimer = null
let retryDelay = 5000
let stopping = false

function log(message) {
  console.log('[VIDEO STUDIO TUNNEL] ' + message)
}

export function startVideoStudioTunnel(port) {
  if (process.env.VIDEO_STUDIO_TUNNEL === 'false') {
    log('Dinonaktifkan melalui VIDEO_STUDIO_TUNNEL=false.')
    return
  }

  const binary = process.env.CLOUDFLARED_BIN || join(process.cwd(), 'bin', 'cloudflared')
  if (!existsSync(binary)) {
    log('Binary tidak ditemukan di ' + binary + '. Letakkan cloudflared pada folder bin/.')
    return
  }

  stopping = false
  const launch = () => {
    if (stopping || child) return
    log('Menghubungkan Quick Tunnel ke http://127.0.0.1:' + port + ' ...')
    const proc = spawn(binary, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + port], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child = proc

    let outputBuffer = ''
    const consume = chunk => {
      const output = String(chunk)
      outputBuffer = (outputBuffer + output).slice(-12000)
      const urls = outputBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/ig)
      if (urls?.length) {
        const url = urls[urls.length - 1]
        log('URL HTTPS SIAP: ' + url)
        log('Masukkan URL tersebut ke kolom URL API di LightJurnal.')
        outputBuffer = ''
      }
      for (const line of output.split(/\r?\n/).filter(Boolean)) {
        if (!/trycloudflare\.com/i.test(line)) log(line)
      }
    }
    proc.stdout.on('data', consume)
    proc.stderr.on('data', consume)
    proc.on('error', error => {
      log('Gagal menjalankan cloudflared: ' + error.message)
    })
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null
      if (stopping) return
      log('Proses tunnel berhenti (code=' + code + ', signal=' + signal + '). Mencoba ulang dalam ' + Math.round(retryDelay / 1000) + ' detik.')
      retryTimer = setTimeout(() => {
        retryTimer = null
        launch()
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 60000)
    })
    proc.on('spawn', () => {
      retryDelay = 5000
      log('Proses cloudflared berjalan.')
    })
  }

  process.once('SIGTERM', () => {
    stopping = true
    if (retryTimer) clearTimeout(retryTimer)
    if (child) child.kill('SIGTERM')
  })
  process.once('SIGINT', () => {
    stopping = true
    if (retryTimer) clearTimeout(retryTimer)
    if (child) child.kill('SIGTERM')
  })
  launch()
}
