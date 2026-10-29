import axios from 'axios'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, copyFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type'
import { downloadYoutubeVideo, cleanupDownload } from '../../lib/scrape/youtube.js'

const MAX_INPUT = 500 * 1024 * 1024
const MAX_OUTPUT = 100 * 1024 * 1024
const MAX_DURATION = 1800
const FFMPEG_TIMEOUT = 15 * 60 * 1000
const active = new Set()

function apiKey() {
  const root = process.env.ALVARETH_DATA_DIR ? resolve(process.env.ALVARETH_DATA_DIR) : join(homedir(), '.alvareth-bot-data')
  try {
    const config = JSON.parse(readFileSync(join(root, 'ragebait', 'config.json'), 'utf8'))
    return typeof config.apiKey === 'string' ? config.apiKey : ''
  } catch { return '' }
}

function run(command, args, timeout = 180000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = '', settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolvePromise({ stdout, stderr })
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(command + ' melewati batas waktu.')) }, timeout)
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-12000) })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000) })
    child.once('error', error => finish(new Error(command + ' tidak tersedia: ' + error.message)))
    child.once('close', code => code === 0 ? finish() : finish(new Error(command + ' gagal (' + code + '): ' + stderr.slice(-900))))
  })
}

function urlFrom(text) {
  const candidates = String(text || '').match(/https?:\/\/[^\s<>"'|]+/gi) || []
  for (const raw of candidates) {
    try {
      const url = new URL(raw.replace(/[),\].!?;:]+$/g, ''))
      const host = url.hostname.toLowerCase()
      if (!['http:', 'https:'].includes(url.protocol) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        host === '127.0.0.1' || host === '::1' || /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) continue
      return url.toString()
    } catch {}
  }
  return ''
}

async function downloadToFile(url, kind, dir, filename) {
  const response = await axios.get(url, {
    responseType: 'stream', timeout: 120000, maxContentLength: MAX_INPUT, maxBodyLength: MAX_INPUT, maxRedirects: 0,
    headers: { 'User-Agent': 'AlvarethBot/1.0', Accept: kind === 'video' ? 'video/*,application/octet-stream' : 'audio/*,application/octet-stream' },
    validateStatus: status => status >= 200 && status < 300
  })
  const contentLength = Number(response.headers?.['content-length'] || 0)
  if (contentLength > MAX_INPUT) { response.data.destroy(); throw new Error('File melebihi batas 500 MB.') }
  const output = join(dir, filename)
  let total = 0
  response.data.on('data', chunk => {
    total += chunk.length
    if (total > MAX_INPUT) response.data.destroy(new Error('File melebihi batas 500 MB.'))
  })
  const { createWriteStream } = await import('node:fs')
  const { pipeline } = await import('node:stream/promises')
  try { await pipeline(response.data, createWriteStream(output)) }
  catch (error) { await rm(output, { force: true }).catch(() => {}); throw error }
  const info = await stat(output)
  const detected = await fileTypeFromFile(output)
  const mime = detected?.mime || String(response.headers?.['content-type'] || '').split(';')[0].toLowerCase()
  if (!info.size || (kind === 'video' ? !mime.startsWith('video/') : !(mime.startsWith('audio/') || mime === 'application/octet-stream'))) {
    await rm(output, { force: true }).catch(() => {})
    throw new Error('Tautan bukan file ' + kind + ' langsung. Tautan halaman media sosial tidak didukung.')
  }
  return { path: output, ext: detected?.ext || (kind === 'video' ? 'mp4' : 'mp3') }
}
function isYoutubeUrl(value) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host) || host.endsWith('.youtube.com') || host.endsWith('.youtube-nocookie.com')
  } catch { return false }
}

async function sourceVideo(m, instruction, dir) {
  const media = m.quoted && typeof m.quoted.download === 'function' ? m.quoted : m
  const type = String(media?.mediaType || media?.mtype || '').toLowerCase()
  const inputPath = join(dir, 'source.mp4')
  if (type.includes('video') || media?.message?.videoMessage || media?.msg?.videoMessage) {
    const buffer = await media.download()
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_INPUT) throw new Error('Video WhatsApp kosong atau melebihi batas 500 MB.')
    const detected = await fileTypeFromBuffer(buffer)
    if (detected?.mime && !detected.mime.startsWith('video/')) throw new Error('Pesan yang dibalas bukan video.')
    await writeFile(inputPath, buffer)
    return { path: inputPath, ext: detected?.ext || 'mp4' }
  }
  const url = urlFrom(instruction)
  if (!url) throw new Error('Balas video WhatsApp dengan perintah .editvideo instruksi, atau sertakan tautan langsung ke file video / tautan YouTube.')
  if (isYoutubeUrl(url)) {
    let result
    try {
      result = await downloadYoutubeVideo(url, 360)
      const info = await stat(result.path)
      if (!info.size || info.size > MAX_INPUT) throw new Error('Video YouTube hasil unduhan melebihi batas 500 MB.')
      const detected = await fileTypeFromFile(result.path)
      if (!detected?.mime?.startsWith('video/')) throw new Error('Unduhan YouTube bukan file video yang valid.')
      await copyFile(result.path, inputPath)
      return { path: inputPath, ext: detected.ext || 'mp4', sourceTitle: result.title }
    } finally {
      if (result?.outputDir) await cleanupDownload(result.outputDir).catch(() => {})
    }
  }
  return downloadToFile(url, 'video', dir, 'source.mp4')
}
async function planEdit(key, instruction) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b', temperature: 0.1, max_tokens: 350,
        messages: [
          { role: 'system', content: 'Ubah instruksi edit video menjadi JSON saja dengan skema {"start":number|null,"end":number|null,"crop":"none"|"vertical"|"square"|"landscape","text":string|null,"subtitle":string|null,"highlight":boolean,"musicUrl":string|null,"musicVolume":number}. "potong dari 5 sampai 12 detik" => start=5,end=12. 9:16/vertikal/TikTok/Reels => vertical; 1:1 => square; 16:9 => landscape. text = teks overlay; subtitle hanya jika teks subtitle diberikan eksplisit, jangan mengaku bisa transkripsi otomatis. highlight berarti peningkatan kontras/saturasi/tajam. Musik hanya dari URL audio langsung yang diberikan pengguna. Field tak diminta null/none/false. Clamp waktu >=0 dan volume 0.05-1.' },
          { role: 'user', content: String(instruction).slice(0, 600) }
        ]
      }),
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error('Groq API: ' + String(data?.error?.message || response.status).slice(0, 160))
    const raw = data?.choices?.[0]?.message?.content || ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('AI tidak menghasilkan rencana edit yang valid.')
    const p = JSON.parse(match[0])
    return {
      start: p.start == null ? null : Math.max(0, Math.min(MAX_DURATION, Number(p.start))),
      end: p.end == null ? null : Math.max(0, Math.min(MAX_DURATION, Number(p.end))),
      crop: ['none', 'vertical', 'square', 'landscape'].includes(p.crop) ? p.crop : 'none',
      text: typeof p.text === 'string' ? p.text.slice(0, 120) : null,
      subtitle: typeof p.subtitle === 'string' ? p.subtitle.slice(0, 400) : null,
      highlight: p.highlight === true,
      musicUrl: typeof p.musicUrl === 'string' ? urlFrom(p.musicUrl) : '',
      musicVolume: Math.max(0.05, Math.min(1, Number(p.musicVolume) || 0.2))
    }
  } finally { clearTimeout(timer) }
}

function esc(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%').replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\n/g, '\\n')
}

async function processVideo(input, instruction, key, dir) {
  const plan = await planEdit(key, instruction)
  const inputPath = input.path
  const outputPath = join(dir, 'edited.mp4')
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', inputPath], 20000)
  const duration = Number(JSON.parse(probe.stdout || '{}')?.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) throw new Error('Durasi video harus terbaca dan maksimal 30 menit.')
  const start = plan.start == null ? 0 : Math.min(plan.start, duration - 0.1)
  const end = plan.end == null ? duration : Math.min(plan.end, duration)
  if (end <= start || end - start < 0.2) throw new Error('Rentang trim tidak valid; waktu akhir harus lebih besar dari waktu awal.')
  const filters = []
  if (plan.crop === 'vertical') filters.push('scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280')
  if (plan.crop === 'square') filters.push('scale=720:720:force_original_aspect_ratio=increase,crop=720:720')
  if (plan.crop === 'landscape') filters.push('scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720')
  if (plan.highlight) filters.push('eq=contrast=1.08:saturation=1.12,unsharp=5:5:0.45:3:3:0.2')
  if (plan.text) filters.push("drawtext=text='" + esc(plan.text) + "':fontcolor=white:fontsize=42:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-70")
  if (plan.subtitle) filters.push("drawtext=text='" + esc(plan.subtitle) + "':fontcolor=white:fontsize=30:borderw=2:bordercolor=black:box=1:boxcolor=black@0.45:x=(w-text_w)/2:y=h-text_h-35")
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', inputPath]
  let musicPath = ''
  if (plan.musicUrl) {
    const music = await downloadToFile(plan.musicUrl, 'audio', dir, 'music.mp3')
    musicPath = music.path
    args.push('-stream_loop', '-1', '-i', musicPath)
  }
  if (filters.length) args.push('-vf', filters.join(','))
  args.push('-t', String(end - start), '-map', '0:v:0')
  if (musicPath) args.push('-filter_complex', '[1:a]volume=' + plan.musicVolume + '[music]', '-map', '[music]')
  else args.push('-map', '0:a?')
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outputPath)
  await run('ffmpeg', args, FFMPEG_TIMEOUT)
  const outputStat = await stat(outputPath)
  if (!outputStat.size || outputStat.size > MAX_OUTPUT) throw new Error('Hasil kosong atau melebihi batas kirim WhatsApp 100 MB. Coba clip lebih pendek atau resolusi lebih rendah.')
  return { path: outputPath, plan, seconds: end - start }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const instruction = String(text || '').trim()
  if (!instruction || /^(help|menu)$/i.test(instruction)) return m.reply([
    '*🎬 AI EDIT VIDEO — Alvareth Bot*',
    'Balas video WhatsApp dengan:',
    '.editvideo buat vertikal 9:16, potong dari 3 sampai 15 detik, tambah teks "Tips Hari Ini", buat lebih tajam',
    '',
    'Bisa juga pakai tautan YouTube panjang:',
    '.editvideo https://www.youtube.com/watch?v=VIDEO_ID | ambil bagian paling menarik, crop vertikal 9:16, tambah subtitle manual "Jangan menyerah" dan buat lebih tajam',
    '',
    'Atau gunakan tautan langsung:',
    '.editvideo https://domain.com/video.mp4 | crop vertikal dan tambah teks "Halo"',
    '',
    'Fitur: crop, trim, teks overlay, subtitle manual, highlight warna, tambah musik dari URL audio langsung.',
    'Batas: video maks. 500 MB dan 30 menit; hasil maks. 100 MB.',
    'AI memakai API key Groq yang disimpan lewat .ragebait apikey. FFmpeg dan ffprobe wajib tersedia di server.',
    'Tautan YouTube panjang didukung melalui pengunduh yang sudah ada. Batas 500 MB/30 menit; hasil maksimal 100 MB. Tautan halaman TikTok/Instagram tetap tidak didukung langsung.'
  ].join('\n'))
  if (active.has(m.chat)) return m.reply('⏳ Masih ada pekerjaan edit video di chat ini. Tunggu hingga selesai.')
  const key = apiKey()
  if (!key) return m.reply('⚠️ API key Groq belum tersedia. Atur dengan .ragebait apikey gsk_xxx terlebih dahulu.')
  active.add(m.chat)
  let dir
  try {
    await m.react('🎬')
    await m.reply('⏳ AI sedang memahami instruksi dan memproses video. Mohon tunggu.')
    const url = urlFrom(instruction)
    let editInstruction = instruction
    if (url) editInstruction = instruction.replace(url, '').replace(/^\s*[|,;:-]\s*/, '').replace(/\s*[|]\s*/, ' ').trim()
    dir = await mkdtemp(join(tmpdir(), 'alvareth-editvideo-'))
    const input = await sourceVideo(m, instruction, dir)
    const result = await processVideo(input, editInstruction, key, dir)
    const p = result.plan
    const edits = [
      p.crop !== 'none' ? 'Crop: ' + p.crop : '',
      p.start !== null || p.end !== null ? 'Trim: ' + result.seconds.toFixed(1) + ' detik' : '',
      p.text ? 'Teks overlay' : '', p.subtitle ? 'Subtitle manual' : '',
      p.highlight ? 'Highlight warna' : '', p.musicUrl ? 'Musik tambahan' : ''
    ].filter(Boolean)
    await conn.sendMessage(m.chat, {
      video: { url: result.path }, mimetype: 'video/mp4', fileName: 'alvareth-edited.mp4',
      caption: '✅ *Edit video selesai*\n' + (edits.length ? edits.join('\n') : 'Video diproses ulang tanpa efek tambahan') + '\n\nDiedit dengan AI + FFmpeg.'
    }, { quoted: m, noAlvarethPreview: true })
    await m.react('✅')
  } catch (error) {
    console.error('[EditVideo]', error?.stack || error)
    await m.reply('❌ Gagal mengedit video: ' + String(error?.message || error).slice(0, 450) + '\n\nPastikan FFmpeg/ffprobe terpasang. Batas video 500 MB / 30 menit.')
    await m.react('⚠️').catch(() => {})
  } finally {
    active.delete(m.chat)
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

handler.help = ['editvideo']
handler.tags = ['tools']
handler.command = /^(editvideo|vedit)$/i
export default handler
