import axios from 'axios'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileTypeFromBuffer } from 'file-type'

const MAX_INPUT = 80 * 1024 * 1024
const MAX_OUTPUT = 48 * 1024 * 1024
const MAX_DURATION = 180
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

async function download(url, kind) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer', timeout: 45000, maxContentLength: MAX_INPUT, maxBodyLength: MAX_INPUT, maxRedirects: 0,
    headers: { 'User-Agent': 'AlvarethBot/1.0', Accept: kind === 'video' ? 'video/*,application/octet-stream' : 'audio/*,application/octet-stream' },
    validateStatus: status => status >= 200 && status < 300
  })
  const buffer = Buffer.from(response.data)
  if (!buffer.length || buffer.length > MAX_INPUT) throw new Error('File kosong atau melebihi batas 80 MB.')
  const detected = await fileTypeFromBuffer(buffer)
  const mime = detected?.mime || String(response.headers?.['content-type'] || '').split(';')[0].toLowerCase()
  if (kind === 'video' ? !mime.startsWith('video/') : !(mime.startsWith('audio/') || mime === 'application/octet-stream')) {
    throw new Error('Tautan bukan file ' + kind + ' langsung. Tautan halaman media sosial tidak didukung.')
  }
  return { buffer, ext: detected?.ext || (kind === 'video' ? 'mp4' : 'mp3') }
}

async function sourceVideo(m, instruction) {
  const media = m.quoted && typeof m.quoted.download === 'function' ? m.quoted : m
  const type = String(media?.mediaType || media?.mtype || '').toLowerCase()
  if (type.includes('video') || media?.message?.videoMessage || media?.msg?.videoMessage) {
    const buffer = await media.download()
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_INPUT) throw new Error('Video WhatsApp kosong atau melebihi batas 80 MB.')
    const detected = await fileTypeFromBuffer(buffer)
    if (detected?.mime && !detected.mime.startsWith('video/')) throw new Error('Pesan yang dibalas bukan video.')
    return { buffer, ext: detected?.ext || 'mp4' }
  }
  const url = urlFrom(instruction)
  if (!url) throw new Error('Balas video WhatsApp dengan perintah .editvideo instruksi, atau sertakan tautan langsung ke file video.')
  return download(url, 'video')
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
  const inputPath = join(dir, 'input.' + String(input.ext || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 8))
  const outputPath = join(dir, 'edited.mp4')
  await writeFile(inputPath, input.buffer)
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', inputPath], 20000)
  const duration = Number(JSON.parse(probe.stdout || '{}')?.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) throw new Error('Durasi video harus terbaca dan maksimal 180 detik (3 menit).')
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
    const music = await download(plan.musicUrl, 'audio')
    musicPath = join(dir, 'music.' + String(music.ext || 'mp3').replace(/[^a-z0-9]/gi, '').slice(0, 8))
    await writeFile(musicPath, music.buffer)
    args.push('-stream_loop', '-1', '-i', musicPath)
  }
  if (filters.length) args.push('-vf', filters.join(','))
  args.push('-t', String(end - start), '-map', '0:v:0')
  if (musicPath) args.push('-filter_complex', '[1:a]volume=' + plan.musicVolume + '[music]', '-map', '[music]')
  else args.push('-map', '0:a?')
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outputPath)
  await run('ffmpeg', args)
  const buffer = await readFile(outputPath)
  if (!buffer.length || buffer.length > MAX_OUTPUT) throw new Error('Hasil kosong atau melebihi batas kirim WhatsApp 48 MB. Coba video lebih pendek atau resolusi lebih rendah.')
  return { buffer, plan, seconds: end - start }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  const instruction = String(text || '').trim()
  if (!instruction || /^(help|menu)$/i.test(instruction)) return m.reply([
    '*🎬 AI EDIT VIDEO — Alvareth Bot*',
    'Balas video WhatsApp dengan:',
    '.editvideo buat vertikal 9:16, potong dari 3 sampai 15 detik, tambah teks "Tips Hari Ini", buat lebih tajam',
    '',
    'Atau gunakan tautan langsung:',
    '.editvideo https://domain.com/video.mp4 | crop vertikal dan tambah teks "Halo"',
    '',
    'Fitur: crop, trim, teks overlay, subtitle manual, highlight warna, tambah musik dari URL audio langsung.',
    'Batas: video maks. 80 MB dan 180 detik; hasil maks. 48 MB.',
    'AI memakai API key Groq yang disimpan lewat .ragebait apikey. FFmpeg dan ffprobe wajib tersedia di server.',
    'Tautan halaman TikTok/Instagram/YouTube tidak didukung langsung; unduh lalu kirim videonya ke WhatsApp atau gunakan URL file video langsung.'
  ].join('\n'))
  if (active.has(m.chat)) return m.reply('⏳ Masih ada pekerjaan edit video di chat ini. Tunggu hingga selesai.')
  const key = apiKey()
  if (!key) return m.reply('⚠️ API key Groq belum tersedia. Atur dengan .ragebait apikey gsk_xxx terlebih dahulu.')
  active.add(m.chat)
  let dir
  try {
    await m.react('🎬')
    await m.reply('⏳ AI sedang memahami instruksi dan memproses video. Mohon tunggu.')
    let editInstruction = instruction
    if (urlFrom(instruction) && instruction.includes('|')) editInstruction = instruction.slice(instruction.indexOf('|') + 1).trim()
    const input = await sourceVideo(m, instruction)
    dir = await mkdtemp(join(tmpdir(), 'alvareth-editvideo-'))
    const result = await processVideo(input, editInstruction, key, dir)
    const p = result.plan
    const edits = [
      p.crop !== 'none' ? 'Crop: ' + p.crop : '',
      p.start !== null || p.end !== null ? 'Trim: ' + result.seconds.toFixed(1) + ' detik' : '',
      p.text ? 'Teks overlay' : '', p.subtitle ? 'Subtitle manual' : '',
      p.highlight ? 'Highlight warna' : '', p.musicUrl ? 'Musik tambahan' : ''
    ].filter(Boolean)
    await conn.sendMessage(m.chat, {
      video: result.buffer, mimetype: 'video/mp4', fileName: 'alvareth-edited.mp4',
      caption: '✅ *Edit video selesai*\n' + (edits.length ? edits.join('\n') : 'Video diproses ulang tanpa efek tambahan') + '\n\nDiedit dengan AI + FFmpeg.'
    }, { quoted: m, noAlvarethPreview: true })
    await m.react('✅')
  } catch (error) {
    console.error('[EditVideo]', error?.stack || error)
    await m.reply('❌ Gagal mengedit video: ' + String(error?.message || error).slice(0, 450) + '\n\nPastikan FFmpeg/ffprobe terpasang. Batas video 80 MB / 3 menit.')
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
