import axios from 'axios'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, copyFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type'
import { downloadYoutubeVideo, cleanupDownload } from '../../lib/scrape/youtube.js'

const MAX_DURATION = Number.POSITIVE_INFINITY
// Long jobs are allowed; this watchdog only terminates a process that appears stuck.
const FFMPEG_TIMEOUT = 6 * 60 * 60 * 1000
const active = new Set()

function apiKey() {
  const root = process.env.ALVARETH_DATA_DIR ? resolve(process.env.ALVARETH_DATA_DIR) : join(homedir(), '.alvareth-bot-data')
  try {
    const config = JSON.parse(readFileSync(join(root, 'ragebait', 'config.json'), 'utf8'))
    return typeof config.apiKey === 'string' ? config.apiKey : ''
  } catch { return '' }
}

function run(command, args, timeout = 180000, onProgress = null) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = '', settled = false, progressFields = {}
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolvePromise({ stdout, stderr })
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(command + ' melewati batas waktu.')) }, timeout)
    child.stdout.on('data', chunk => {
      const data = chunk.toString()
      stdout = (stdout + data).slice(-250000)
      if (typeof onProgress === 'function') {
        for (const line of data.split(/\r?\n/)) {
          const sep = line.indexOf('=')
          if (sep < 1) continue
          progressFields[line.slice(0, sep)] = line.slice(sep + 1).trim()
          if (line.startsWith('progress=')) {
            const raw = Number(progressFields.out_time_ms || 0)
            if (Number.isFinite(raw) && raw >= 0) {
              try { onProgress(raw / 1000000, progressFields) } catch {}
            }
          }
        }
      }
    })
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

async function downloadToFile(url, kind, dir, filename, onProgress = null) {
  const response = await axios.get(url, {
    responseType: 'stream', timeout: 120000, maxContentLength: -1, maxBodyLength: -1, maxRedirects: 0,
    headers: { 'User-Agent': 'AlvarethBot/1.0', Accept: kind === 'video' ? 'video/*,application/octet-stream' : 'audio/*,application/octet-stream' },
    validateStatus: status => status >= 200 && status < 300
  })
  const output = join(dir, filename)
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
  const length = Math.min(duration, Math.max(8, requestedDuration || 45))
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

async function sourceVideo(m, instruction, dir, reportProgress = () => {}, logDownloadProgress = () => {}) {
  const media = m.quoted && typeof m.quoted.download === 'function' ? m.quoted : m
  const type = String(media?.mediaType || media?.mtype || '').toLowerCase()
  const inputPath = join(dir, 'source.mp4')
  if (type.includes('video') || media?.message?.videoMessage || media?.msg?.videoMessage) {
    reportProgress(8, 'Mengunduh video WhatsApp')
    const buffer = await media.download()
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Video WhatsApp kosong atau tidak dapat diunduh.')
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
      result = await downloadYoutubeVideo(url, 2160, (percent, detail) => {
        const amount = Number(percent)
        if (Number.isFinite(amount) && amount >= 0 && amount <= 100) {
          reportProgress(7 + amount * 0.07, 'Mengunduh video YouTube')
          logDownloadProgress(amount, detail || 'Download YouTube')
        } else if (detail) logDownloadProgress(null, String(detail))
      })
      const info = await stat(result.path)
      if (!info.size) throw new Error('Video YouTube hasil unduhan kosong.')
      const detected = await fileTypeFromFile(result.path)
      if (!detected?.mime?.startsWith('video/')) throw new Error('Unduhan YouTube bukan file video yang valid.')
      await copyFile(result.path, inputPath)
      return { path: inputPath, ext: detected.ext || 'mp4', sourceTitle: result.title }
    } finally {
      if (result?.outputDir) await cleanupDownload(result.outputDir).catch(() => {})
    }
  }
  reportProgress(8, 'Mengunduh file video dari tautan')
  return downloadToFile(url, 'video', dir, 'source.mp4', percent => reportProgress(7 + percent * 0.08, 'Mengunduh file video dari tautan'))
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
      targetDuration: targetDuration == null ? null : Math.max(8, targetDuration),
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

async function processVideo(input, instruction, key, dir, reportProgress = () => {}) {
  reportProgress(18, 'AI memahami instruksi edit')
  const plan = await planEdit(key, instruction)
  const inputPath = input.path
  const outputPath = join(dir, 'edited.mp4')
  reportProgress(25, 'Memeriksa metadata video')
  const probe = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json', inputPath
  ], 20000)
  const probeData = JSON.parse(probe.stdout || '{}')
  const duration = Number(probeData?.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Durasi video tidak terbaca atau file video tidak valid.')
  const videoStream = (probeData.streams || []).find(stream => stream.codec_type === 'video') || {}
  const hasAudio = (probeData.streams || []).some(stream => stream.codec_type === 'audio')
  let analysis = null
  if (plan.smartClip || plan.soundEffects) {
    reportProgress(32, 'Menganalisis pergantian adegan dan audio')
    analysis = await analyzeMedia(inputPath)
    reportProgress(43, 'Analisis selesai; menyiapkan efek')
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
    reportProgress(45, 'Membuat subtitle otomatis')
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
    reportProgress(48, 'Mengunduh musik tambahan')
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
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath)
  reportProgress(50, 'FFmpeg mulai merender video')
  await run('ffmpeg', args, FFMPEG_TIMEOUT, seconds => {
    const percent = Math.max(50, Math.min(94, 50 + (seconds / Math.max(clipDuration, 0.1)) * 44))
    reportProgress(percent, 'Merender video dengan FFmpeg')
  })
  reportProgress(96, 'Memvalidasi hasil render')
  const outputStat = await stat(outputPath)
  if (!outputStat.size) throw new Error('FFmpeg menghasilkan file video kosong.')
  return { path: outputPath, plan, seconds: clipDuration, start, end, sceneCount: analysis?.scenes?.length || 0, whooshCount: whooshTimes.length }
}
const handler = async (m, { conn, text, usedPrefix, command, isOwner }) => {
  if (!isOwner) return m.reply('🔒 Fitur AI Edit Video ini khusus owner bot.')
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
    'Progres ditampilkan di pesan status secara berkala; render FFmpeg memakai persentase aktual. Kapasitas disk, RAM/CPU TokoPanel, jaringan, dan batas WhatsApp tetap berlaku.',
    'AI memakai API key Groq dari .ragebait apikey. FFmpeg dan ffprobe wajib tersedia. Subtitle otomatis butuh whisper.cpp + WHISPER_MODEL_PATH.',
    'Tautan YouTube watch, live, shorts, dan youtu.be dicoba melalui downloader API lalu otomatis fallback ke yt-dlp resmi. Tautan halaman TikTok/Instagram tetap tidak didukung langsung.'
  ].join('\n'))
  if (active.has(m.chat)) return m.reply('⏳ Masih ada pekerjaan edit video di chat ini. Tunggu hingga selesai.')
  const key = apiKey()
  if (!key) return m.reply('⚠️ API key Groq belum tersedia. Atur dengan .ragebait apikey gsk_xxx terlebih dahulu.')
  active.add(m.chat)
  let dir
  try {
    await m.react('🎬')
    let progressMessage = null
    let progressEditSupported = true
    let fallbackProgressValue = -10
    let fallbackProgressAt = 0
    let lastProgress = -1
    let lastProgressAt = 0
    const startedAt = Date.now()
    let latestTerminalStage = 'Menyiapkan pekerjaan'
    let latestTerminalPercent = 0
    let lastTerminalStage = ''
    let lastTerminalBucket = -1
    let lastTerminalAt = 0
    let renderStartedAt = 0
    let progressHeartbeat = null
    const formatElapsed = milliseconds => {
      const seconds = Math.max(0, Math.floor(milliseconds / 1000))
      return String(Math.floor(seconds / 3600)).padStart(2, '0') + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
    }
    const terminalProgress = (percent, stage, force = false, heartbeat = false) => {
      const now = Date.now()
      const value = Math.max(0, Math.min(100, Number(percent) || 0))
      latestTerminalStage = stage
      latestTerminalPercent = value
      if (stage === 'FFmpeg mulai merender video' && !renderStartedAt) renderStartedAt = now
      const bucket = Math.floor(value / 2)
      const stageChanged = stage !== lastTerminalStage
      if (!force && !stageChanged && bucket === lastTerminalBucket && now - lastTerminalAt < 7000) return
      const filled = Math.round(value / 5)
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
      const elapsed = now - startedAt
      let etaText = ''
      if (renderStartedAt && value > 50 && value < 95) {
        const renderRatio = Math.max(0.01, Math.min(0.99, (value - 50) / 44))
        const renderElapsed = now - renderStartedAt
        const etaMs = renderElapsed * (1 - renderRatio) / renderRatio
        if (Number.isFinite(etaMs) && etaMs >= 0) etaText = ' | estimasi render tersisa ' + formatElapsed(etaMs)
      }
      console.log('[AI-EDIT] [' + new Date(now).toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' }) + '] ' + bar + ' ' + Math.floor(value) + '% | ' + stage + ' | berjalan ' + formatElapsed(elapsed) + etaText + (heartbeat ? ' | MASIH BERJALAN' : ''))
      lastTerminalStage = stage
      lastTerminalBucket = bucket
      lastTerminalAt = now
    }
    const logDownloadProgress = (percent, detail = '') => {
      const now = Date.now()
      if (typeof percent === 'number' && Number.isFinite(percent)) {
        const bucket = Math.floor(Math.min(100, Math.max(0, percent)) / 5)
        if (bucket === logDownloadProgress.lastBucket && now - logDownloadProgress.lastAt < 5000) return
        logDownloadProgress.lastBucket = bucket
        logDownloadProgress.lastAt = now
        console.log('[AI-EDIT] [' + new Date(now).toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' }) + '] DOWNLOAD ' + percent.toFixed(1) + '% | ' + String(detail || 'YouTube').slice(0, 180) + ' | berjalan ' + formatElapsed(now - startedAt))
      } else if (detail && detail !== logDownloadProgress.lastDetail) {
        logDownloadProgress.lastDetail = detail
        console.log('[AI-EDIT] [' + new Date(now).toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' }) + '] ' + String(detail).slice(0, 220) + ' | berjalan ' + formatElapsed(now - startedAt))
      }
    }
    logDownloadProgress.lastBucket = -1
    logDownloadProgress.lastAt = 0
    logDownloadProgress.lastDetail = ''
    const progressBar = percent => {
      const filled = Math.round(Math.max(0, Math.min(100, percent)) / 5)
      return '█'.repeat(filled) + '░'.repeat(20 - filled)
    }
    const reportProgress = async (percent, stage) => {
      const value = Math.max(0, Math.min(100, Math.floor(percent)))
      const now = Date.now()
      terminalProgress(value, stage)
      if (value === lastProgress && now - lastProgressAt < 5000) return
      if (value < lastProgress || (now - lastProgressAt < 2500 && value < 100)) return
      lastProgress = value
      lastProgressAt = now
      const message = '🎬 *AI EDIT VIDEO — PROGRES REAL-TIME*\n\n' +
        progressBar(value) + ' *' + value + '%*\n' +
        '🔄 ' + stage + '\n\n' +
        'Persentase render diperbarui dari progres FFmpeg. Tahap unduhan/analisis menggunakan progres tahap karena tidak semua downloader menyediakan persentase byte.'
      if (!progressMessage) {
        try { progressMessage = await conn.sendMessage(m.chat, { text: message }, { quoted: m }) } catch {}
        return
      }
      if (progressEditSupported) {
        try {
          await conn.sendMessage(m.chat, { text: message, edit: progressMessage.key })
          return
        } catch {
          // This Baileys fork might not implement edit-message payloads.
          progressEditSupported = false
        }
      }
      // Fallback for older Baileys forks: post a new status only every 10% or
      // 10 seconds, rather than spamming a message for each FFmpeg progress tick.
      if (value - fallbackProgressValue >= 10 || now - fallbackProgressAt >= 10000 || value >= 98) {
        try {
          progressMessage = await conn.sendMessage(m.chat, { text: message }, { quoted: m })
          fallbackProgressValue = value
          fallbackProgressAt = now
        } catch {}
      }
    }
    await reportProgress(3, 'Menyiapkan pekerjaan')
    progressHeartbeat = setInterval(() => terminalProgress(latestTerminalPercent, latestTerminalStage, true, true), 15000)
    const url = urlFrom(instruction)
    let editInstruction = instruction
    if (url) editInstruction = instruction.replace(url, '').replace(/^\s*[|,;:-]\s*/, '').replace(/\s*[|]\s*/, ' ').trim()
    dir = await mkdtemp(join(tmpdir(), 'alvareth-editvideo-'))
    await reportProgress(7, 'Mengunduh atau membaca video sumber')
    const input = await sourceVideo(m, instruction, dir, reportProgress, logDownloadProgress)
    await reportProgress(16, 'Video sumber siap')
    const result = await processVideo(input, editInstruction, key, dir, reportProgress)
    const p = result.plan
    const edits = [
      p.crop !== 'none' ? 'Crop: ' + p.crop : '',
      p.start !== null || p.end !== null ? 'Trim: ' + result.seconds.toFixed(1) + ' detik' : '',
      p.text ? 'Teks overlay' : '', p.subtitle ? 'Subtitle manual' : '',
      p.highlight ? 'Highlight warna' : '', p.musicUrl ? 'Musik tambahan (dicampur dengan audio asli)' : '', p.autoCaptions ? 'Subtitle otomatis' : '', p.autoZoom ? 'Zoom dinamis' : '', p.transitions ? 'Fade awal/akhir' : '', p.soundEffects ? 'Efek whoosh per pergantian adegan' : '', p.smartClip ? 'Smart clip' : ''
    ].filter(Boolean)
    await reportProgress(98, 'Mengirim video hasil edit ke WhatsApp')
    await conn.sendMessage(m.chat, {
      video: { url: result.path }, mimetype: 'video/mp4', fileName: 'alvareth-edited.mp4',
      caption: '✅ *Edit video selesai*\n' + (edits.length ? edits.join('\n') : 'Video diproses ulang tanpa efek tambahan') + (p.smartClip ? '\nKlip dipilih otomatis dari aktivitas audio dan pergantian adegan (heuristik).' : '') + (p.autoZoom ? '\nZoom dinamis diterapkan ke area tengah; tidak melacak wajah.' : '') + (p.transitions ? '\nFade halus pada awal/akhir video.' : '') + (p.soundEffects ? '\nEfek whoosh dibuat pada ' + result.whooshCount + ' pergantian adegan.' : '') + '\n\nDiedit dengan AI + FFmpeg.'
    }, { quoted: m, noAlvarethPreview: true })
    await reportProgress(100, 'Selesai')
    console.log('[AI-EDIT] Selesai 100% | total waktu ' + formatElapsed(Date.now() - startedAt))
    if (progressMessage?.key) await conn.sendMessage(m.chat, { text: '✅ *Edit video selesai — 100%*', edit: progressMessage.key }).catch(() => {})
    await m.react('✅')
  } catch (error) {
    console.error('[AI-EDIT] GAGAL setelah ' + (typeof startedAt === 'number' ? Math.floor((Date.now() - startedAt) / 1000) + ' detik' : 'waktu tidak diketahui') + ':', error?.stack || error)
    await m.reply('❌ Gagal mengedit video: ' + String(error?.message || error).slice(0, 450) + '\n\nPastikan FFmpeg/ffprobe terpasang, ruang disk cukup, dan server tidak kehabisan RAM/CPU.')
    await m.react('⚠️').catch(() => {})
  } finally {
    if (progressHeartbeat) clearInterval(progressHeartbeat)
    active.delete(m.chat)
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

handler.help = ['editvideo']
handler.tags = ['tools']
handler.command = /^(editvideo|vedit)$/i
handler.owner = true
export default handler
