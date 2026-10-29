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
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-250000) })
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

async function analyzeMedia(inputPath) {
  // Low-rate scene sampling + silence detection; no full-resolution frame dump is written.
  const result = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-i', inputPath,
    '-vf', "fps=1,scale=160:-2,select='gt(scene,0.20)',showinfo",
    '-af', 'silencedetect=noise=-35dB:d=0.6',
    '-f', 'null', '-'
  ], Math.min(FFMPEG_TIMEOUT, 10 * 60 * 1000))
  const scenes = [...result.stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)]
    .map(m => Number(m[1])).filter(Number.isFinite)
  const starts = [...result.stderr.matchAll(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/g)].map(m => Number(m[1]))
  const ends = [...result.stderr.matchAll(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/g)].map(m => Number(m[1]))
  const silences = []
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    if (ends[i] > starts[i]) silences.push({ start: starts[i], end: ends[i] })
  }
  return { scenes: [...new Set(scenes)].sort((a, b) => a - b), silences }
}

function chooseHighlightWindow(duration, analysis, requestedDuration) {
  const length = Math.min(duration, Math.max(8, Math.min(180, requestedDuration || 45)))
  if (duration <= length + 0.5) return { start: 0, end: duration }
  const step = Math.max(1, Math.min(4, length / 12))
  let best = { start: 0, end: length, score: -Infinity }
  for (let start = 0; start + length <= duration + 0.001; start += step) {
    const end = start + length
    const cuts = analysis.scenes.filter(t => t >= start && t <= end).length
    let silenceSeconds = 0
    for (const silence of analysis.silences) {
      silenceSeconds += Math.max(0, Math.min(end, silence.end) - Math.max(start, silence.start))
    }
    const activeRatio = Math.max(0, 1 - Math.min(length, silenceSeconds) / length)
    // Heuristic only: prefers speech/audio activity and scene changes, not semantic AI recognition.
    const sceneDensity = Math.min(2.5, cuts / Math.max(1, length / 10))
    const score = activeRatio * 1.4 + sceneDensity * 0.6 - start / Math.max(duration, 1) * 0.03
    if (score > best.score) best = { start, end, score }
  }
  return { start: best.start, end: best.end }
}

async function generateAutoSubtitles(inputPath, dir, start, clipDuration) {
  const model = String(process.env.WHISPER_MODEL_PATH || '').trim()
  const binary = String(process.env.WHISPER_CPP_BIN || 'whisper-cli').trim()
  if (!model) throw new Error('Subtitle otomatis butuh whisper.cpp dan model Whisper lokal. Pasang whisper.cpp, lalu set WHISPER_MODEL_PATH ke file model GGML. Fitur edit lain tetap bisa dipakai tanpa subtitle otomatis.')
  const audioPath = join(dir, 'speech-16k.wav')
  const subtitleBase = join(dir, 'captions')
  const subtitlePath = subtitleBase + '.srt'
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', inputPath,
    '-t', String(clipDuration), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath
  ], FFMPEG_TIMEOUT)
  await run(binary, ['-m', model, '-f', audioPath, '-osrt', '-of', subtitleBase, '-l', 'auto'], FFMPEG_TIMEOUT)
  const info = await stat(subtitlePath).catch(() => null)
  if (!info?.size || info.size > 4 * 1024 * 1024) throw new Error('Whisper tidak menghasilkan file subtitle SRT yang valid.')
  return subtitlePath
}

async function createWhoosh(dir) {
  const output = join(dir, 'scene-whoosh.wav')
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'anoisesrc=color=pink:sample_rate=44100:duration=0.35',
    '-af', 'highpass=f=700,lowpass=f=7000,afade=t=in:st=0:d=0.04,afade=t=out:st=0.08:d=0.27,volume=0.12',
    '-c:a', 'pcm_s16le', output
  ], 30000)
  return output
}

function escapeFilterPath(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
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
        model: 'openai/gpt-oss-120b', temperature: 0.1, max_tokens: 500,
        messages: [
          { role: 'system', content: 'Ubah instruksi edit video menjadi JSON saja dengan skema {"start":number|null,"end":number|null,"crop":"none"|"vertical"|"square"|"landscape","text":string|null,"subtitle":string|null,"autoCaptions":boolean,"smartClip":boolean,"targetDuration":number|null,"highlight":boolean,"musicUrl":string|null,"musicVolume":number,"autoZoom":boolean,"transitions":boolean,"soundEffects":boolean}. "potong dari 5 sampai 12 detik" => start=5,end=12. "ambil bagian paling menarik", "buat highlight", "jadikan klip Reels otomatis" => smartClip=true. Jika target durasi disebut, targetDuration dalam detik. 9:16/vertikal/TikTok/Reels => vertical; 1:1 => square; 16:9 => landscape. text = teks overlay; subtitle = teks subtitle manual hanya jika disediakan eksplisit. autoCaptions=true hanya jika diminta subtitle otomatis/transkripsi. highlight berarti peningkatan kontras/saturasi/tajam. autoZoom=true jika diminta zoom dinamis. transitions=true jika diminta transisi/fade. soundEffects=true hanya jika diminta efek suara/SFX. Musik hanya dari URL audio langsung yang diberikan pengguna. Field tak diminta null/none/false. Clamp waktu >=0 dan volume 0.05-1.' },
          { role: 'user', content: String(instruction).slice(0, 800) }
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
    const words = String(instruction || '').toLowerCase()
    const smartClip = p.smartClip === true || /bagian paling menarik|momen paling menarik|highlight otomatis|smart clip|auto.?clip|klip otomatis|reels otomatis|shorts otomatis|ambil bagian terbaik|potong bagian menarik|momen paling viral|bagian paling viral|cut best moments|ambil momen terbaik/.test(words)
    const autoCaptions = p.autoCaptions === true || /subtitle otomatis|caption otomatis|auto.?caption|transkrip otomatis|transkripsikan|buat subtitle otomatis|kasih subtitle otomatis/.test(words)
    const autoZoom = p.autoZoom === true || /zoom dinamis|auto.?zoom|zoom otomatis|efek zoom|punch.?in/.test(words)
    const transitions = p.transitions === true || /transisi|transition|fade in|fade out|fade halus/.test(words)
    const soundEffects = p.soundEffects === true || /sound effect|sound effects|efek suara|sfx|whoosh/.test(words)
    let targetDuration = p.targetDuration == null ? null : Number(p.targetDuration)
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) targetDuration = null
    if (targetDuration == null) {
      const sec = words.match(/(\d{1,3})\s*(?:detik|seconds?|secs?|s\b)/i)
      const min = words.match(/(\d{1,2})\s*(?:menit|minutes?|mins?|m\b)/i)
      if (sec) targetDuration = Number(sec[1])
      else if (min) targetDuration = Number(min[1]) * 60
    }
    return {
      start: p.start == null ? null : Math.max(0, Math.min(MAX_DURATION, Number(p.start))),
      end: p.end == null ? null : Math.max(0, Math.min(MAX_DURATION, Number(p.end))),
      crop: ['none', 'vertical', 'square', 'landscape'].includes(p.crop) ? p.crop : 'none',
      text: typeof p.text === 'string' ? p.text.slice(0, 120) : null,
      subtitle: typeof p.subtitle === 'string' ? p.subtitle.slice(0, 400) : null,
      autoCaptions, smartClip,
      targetDuration: targetDuration == null ? null : Math.max(8, Math.min(180, targetDuration)),
      highlight: p.highlight === true,
      musicUrl: typeof p.musicUrl === 'string' ? urlFrom(p.musicUrl) : '',
      musicVolume: Math.max(0.05, Math.min(1, Number(p.musicVolume) || 0.2)),
      autoZoom, transitions, soundEffects
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
  const probe = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json', inputPath
  ], 20000)
  const probeData = JSON.parse(probe.stdout || '{}')
  const duration = Number(probeData?.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) throw new Error('Durasi video harus terbaca dan maksimal 30 menit.')
  const videoStream = (probeData.streams || []).find(stream => stream.codec_type === 'video') || {}
  const hasAudio = (probeData.streams || []).some(stream => stream.codec_type === 'audio')
  let analysis = null
  if (plan.smartClip || plan.soundEffects) {
    analysis = await analyzeMedia(inputPath)
  }
  let start = plan.start == null ? 0 : Math.min(plan.start, duration - 0.1)
  let end = plan.end == null ? duration : Math.min(plan.end, duration)
  if (plan.smartClip && plan.start == null && plan.end == null) {
    const window = chooseHighlightWindow(duration, analysis || { scenes: [], silences: [] }, plan.targetDuration)
    start = window.start
    end = window.end
  }
  if (end <= start || end - start < 0.2) throw new Error('Rentang trim tidak valid; waktu akhir harus lebih besar dari waktu awal.')
  const clipDuration = end - start
  const filters = []
  if (plan.crop === 'vertical') filters.push('scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280')
  if (plan.crop === 'square') filters.push('scale=720:720:force_original_aspect_ratio=increase,crop=720:720')
  if (plan.crop === 'landscape') filters.push('scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720')
  if (plan.highlight) filters.push('eq=contrast=1.08:saturation=1.12,unsharp=5:5:0.45:3:3:0.2')
  if (plan.autoZoom) {
    let outW = Number(videoStream.width) || 1280
    let outH = Number(videoStream.height) || 720
    if (plan.crop === 'vertical') { outW = 720; outH = 1280 }
    else if (plan.crop === 'square') { outW = 720; outH = 720 }
    else if (plan.crop === 'landscape') { outW = 1280; outH = 720 }
    else {
      const scale = Math.min(1, 1280 / outW, 1280 / outH)
      outW = Math.max(2, Math.floor(outW * scale / 2) * 2)
      outH = Math.max(2, Math.floor(outH * scale / 2) * 2)
    }
    filters.push("zoompan=z='min(zoom+0.00025,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=" + outW + 'x' + outH + ':fps=30')
  }
  if (plan.text) filters.push("drawtext=text='" + esc(plan.text) + "':fontcolor=white:fontsize=42:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-70")
  if (plan.subtitle) filters.push("drawtext=text='" + esc(plan.subtitle) + "':fontcolor=white:fontsize=30:borderw=2:bordercolor=black:box=1:boxcolor=black@0.45:x=(w-text_w)/2:y=h-text_h-35")
  let generatedSubtitle = ''
  if (plan.autoCaptions) {
    if (!hasAudio) throw new Error('Video tidak memiliki audio untuk ditranskripsikan.')
    generatedSubtitle = await generateAutoSubtitles(inputPath, dir, start, clipDuration)
    filters.push("subtitles=filename='" + escapeFilterPath(generatedSubtitle) + "':force_style='FontName=Arial,FontSize=23,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=35'")
  }
  if (plan.transitions) {
    const fade = Math.min(0.35, clipDuration / 4)
    filters.push('fade=t=in:st=0:d=' + fade.toFixed(3))
    filters.push('fade=t=out:st=' + Math.max(0, clipDuration - fade).toFixed(3) + ':d=' + fade.toFixed(3))
  }

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', inputPath]
  let musicPath = ''
  if (plan.musicUrl) {
    const music = await downloadToFile(plan.musicUrl, 'audio', dir, 'music.mp3')
    musicPath = music.path
    args.push('-stream_loop', '-1', '-i', musicPath)
  }

  let whooshTimes = []
  if (plan.soundEffects && hasAudio && analysis?.scenes?.length) {
    const candidates = analysis.scenes.filter(t => t > start + 0.5 && t < end - 0.5)
      .map(t => t - start).filter(t => t > 0 && t < clipDuration)
    // Cap processing cost and avoid noisy repeated effects on closely spaced cuts.
    const stride = Math.max(1, Math.ceil(candidates.length / 8))
    for (let i = 0; i < candidates.length && whooshTimes.length < 8; i += stride) {
      const t = candidates[i]
      if (!whooshTimes.length || t - whooshTimes[whooshTimes.length - 1] >= 2.5) whooshTimes.push(t)
    }
  }
  let whooshPath = ''
  if (whooshTimes.length) whooshPath = await createWhoosh(dir)
  const effectInputIndexes = []
  for (const _time of whooshTimes) {
    effectInputIndexes.push(args.filter((v, i) => v === '-i').length)
    args.push('-i', whooshPath)
  }

  if (filters.length) args.push('-vf', filters.join(','))
  args.push('-t', String(clipDuration), '-map', '0:v:0')
  const needsAudioMix = Boolean(musicPath || whooshTimes.length)
  if (needsAudioMix) {
    const graph = []
    const labels = []
    if (hasAudio) {
      graph.push('[0:a:0]volume=' + (musicPath ? '0.82' : '1') + '[abase]')
      labels.push('[abase]')
    }
    if (musicPath) {
      graph.push('[1:a:0]volume=' + plan.musicVolume + '[amusic]')
      labels.push('[amusic]')
    }
    for (let i = 0; i < whooshTimes.length; i++) {
      const inputIndex = effectInputIndexes[i]
      const delay = Math.round(whooshTimes[i] * 1000)
      graph.push('[' + inputIndex + ':a:0]adelay=' + delay + '|' + delay + ',volume=0.55[asfx' + i + ']')
      labels.push('[asfx' + i + ']')
    }
    if (labels.length) {
      graph.push(labels.join('') + 'amix=inputs=' + labels.length + ':duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]')
      args.push('-filter_complex', graph.join(';'), '-map', '[aout]')
    } else if (hasAudio) args.push('-map', '0:a:0')
  } else if (hasAudio) args.push('-map', '0:a:0')
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath)
  await run('ffmpeg', args, FFMPEG_TIMEOUT)
  const outputStat = await stat(outputPath)
  if (!outputStat.size || outputStat.size > MAX_OUTPUT) throw new Error('Hasil kosong atau melebihi batas kirim WhatsApp 100 MB. Coba clip lebih pendek atau resolusi lebih rendah.')
  return { path: outputPath, plan, seconds: clipDuration, start, end, sceneCount: analysis?.scenes?.length || 0, whooshCount: whooshTimes.length }
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
    'Fitur: crop, trim, teks, subtitle manual/otomatis, highlight warna, zoom dinamis, fade masuk/keluar, dan whoosh saat pergantian adegan.',
    'Batas: video maks. 500 MB dan 30 menit; hasil maks. 100 MB.',
    'AI memakai API key Groq dari .ragebait apikey. FFmpeg dan ffprobe wajib tersedia. Subtitle otomatis butuh whisper.cpp + WHISPER_MODEL_PATH.',
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
      p.highlight ? 'Highlight warna' : '', p.musicUrl ? 'Musik tambahan (dicampur dengan audio asli)' : '', p.autoCaptions ? 'Subtitle otomatis' : '', p.autoZoom ? 'Zoom dinamis' : '', p.transitions ? 'Fade awal/akhir' : '', p.soundEffects ? 'Efek whoosh per pergantian adegan' : '', p.smartClip ? 'Smart clip' : ''
    ].filter(Boolean)
    await conn.sendMessage(m.chat, {
      video: { url: result.path }, mimetype: 'video/mp4', fileName: 'alvareth-edited.mp4',
      caption: '✅ *Edit video selesai*\n' + (edits.length ? edits.join('\n') : 'Video diproses ulang tanpa efek tambahan') + (p.smartClip ? '\nKlip dipilih otomatis dari aktivitas audio dan pergantian adegan (heuristik).' : '') + (p.autoZoom ? '\nZoom dinamis diterapkan ke area tengah; tidak melacak wajah.' : '') + (p.transitions ? '\nFade halus pada awal/akhir video.' : '') + (p.soundEffects ? '\nEfek whoosh dibuat pada ' + result.whooshCount + ' pergantian adegan.' : '') + '\n\nDiedit dengan AI + FFmpeg.'
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
