import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
const clipPlugin = await readFile(new URL('../plugins/downloader/clip.js', import.meta.url), 'utf8')
const youtubeSource = await readFile(new URL('../lib/scrape/youtube.js', import.meta.url), 'utf8')
const clipPipeline = youtubeSource.slice(youtubeSource.indexOf('export async function downloadYoutubeClip'))
const timestampSource = clipPlugin.match(/export function parseTimestamp\(value\) \{[\s\S]*?\n\}/)?.[0]
if (!timestampSource) throw new Error('parseTimestamp source was not found')
const parseTimestamp = new Function(timestampSource.replace(/^export /, '') + '; return parseTimestamp')()

test('timestamp parser accepts clips longer than fifteen minutes', () => {
  assert.equal(parseTimestamp('01:30:00'), 90 * 60)
  assert.equal(parseTimestamp('12:00:00'), 12 * 60 * 60)
  assert.equal(parseTimestamp('02:45:30'), 2 * 3600 + 45 * 60 + 30)
})

test('clip has no application-level duration or output-file size cap', () => {
  assert.doesNotMatch(clipPlugin, /MAX_CLIP_BYTES|MAX_CLIP_SECONDS|Durasi clip maksimal|melebihi batas 45 MB/)
  assert.doesNotMatch(clipPlugin, /maxOutputBytes\s*:/)
  assert.doesNotMatch(clipPipeline, /end\s*-\s*start\s*>\s*15\s*\*\s*60/)
})

test('Qbyte fallback enforces a 256 MB per-stream safety cap', () => {
  assert.match(clipPipeline, /'clip-api-video', outputDir, qbyteMaxBytes/)
  assert.match(clipPipeline, /'clip-api-audio', outputDir, qbyteMaxBytes/)
  assert.match(clipPipeline, /ALVARETH_CLIP_QBYTE_MAX_SOURCE_BYTES/)
  assert.match(clipPipeline, /256 \* 1024 \* 1024/)
  assert.doesNotMatch(clipPipeline, /videoFormats\.slice\(0, 12\)/)
})

test('clip yt-dlp calls have no idle or total execution deadline', () => {
  assert.doesNotMatch(clipPipeline, /idleTimeoutMs\s*:/)
  assert.doesNotMatch(clipPipeline, /6\s*\*\s*60\s*\*\s*1000/)
  assert.match(clipPipeline, /ensureYtDlpPythonRunner\(0\)/)
  assert.match(clipPipeline, /ensureYtDlpBinary\(0\)/)
  assert.match(youtubeSource, /runYtDlpWithEjsFallback\(runner, args, 0, onProgress\)/)
  assert.equal((clipPipeline.match(/downloadValidatedClipFormat\(/g) || []).length, 1)
})

test('clip FFmpeg and Qbyte HTTP calls do not set application deadlines', () => {
  assert.match(youtubeSource, /function runClipFfmpeg\(args, timeoutMs = 0/)
  assert.match(clipPipeline, /runClipFfmpeg\(ffmpegArgs, 0, options\?\.onProgress, duration\)/)
  assert.match(clipPipeline, /getClipYoutubeInfo\(normalizedUrl, options\?\.onProgress\)/)
  assert.match(youtubeSource, /return await getYoutubeInfo\(url, 0\)/)
  assert.match(clipPipeline, /const qbyteMaxBytes = Number\(process\.env\.ALVARETH_CLIP_QBYTE_MAX_SOURCE_BYTES/)
  assert.doesNotMatch(clipPipeline, /videoFormats\.slice\(0, 12\)/)
})

test('Qbyte video format selection excludes audio-only formats without video dimensions', () => {
  assert.match(youtubeSource, /\.filter\(format => getHeight\(format\) > 0 && format\.vcodec !== 'none'\)/)
  assert.match(youtubeSource, /\.filter\(format => format\.acodec && format\.acodec !== 'none' && format\.vcodec === 'none'\)/)
  assert.match(youtubeSource, /videoStream = await inspectVideoStream\(output\)/)
  assert.match(youtubeSource, /audioStream = await inspectAudioStream\(output\)/)
})

test('every accepted clip must contain a real video stream and not be black for almost the whole range', () => {
  assert.match(youtubeSource, /if \(!streamInfo\?\.width \|\| !streamInfo\?\.height\)/)
  assert.match(youtubeSource, /assertClipHasVisibleVideo\(outputPath, durationSeconds\)/)
  assert.match(youtubeSource, /blackdetect=d=/)
  assert.match(youtubeSource, /black_duration:\(\[0-9\.\]\+\)/)
  assert.match(youtubeSource, /Stream video hampir seluruhnya hitam/)
})

test('every yt-dlp strategy probes and explicitly selects its highest available source formats', () => {
  assert.equal((clipPipeline.match(/await getSharedSelection\(runner,/g) || []).length, 1)
  assert.match(clipPipeline, /sharedSelectionPromise = probeYtDlpFormats\(runner, normalizedUrl/)
  assert.equal((clipPipeline.match(/'--format', candidate\.selector/g) || []).length, 1)
  assert.equal((clipPipeline.match(/'--merge-output-format', 'mkv'/g) || []).length, 1)
  assert.equal((clipPipeline.match(/\.\.\.candidate\.extractorArgs/g) || []).length, 1)
  assert.match(youtubeSource, /'--dump-single-json'/)
  assert.match(youtubeSource, /'--remote-components', 'ejs:github'/)
  assert.match(youtubeSource, /availableQualities/)
  assert.match(youtubeSource, /Semua resolusi tersedia/)
})

test('all clip transcodes retain high source quality and map the video stream explicitly', () => {
  assert.match(clipPipeline, /'-map', '0:v:0'/)
  assert.ok(clipPipeline.includes("'0:a:0?'"))
  assert.match(clipPipeline, /'-crf', '18'/)
  assert.match(clipPipeline, /'-b:a', '192k'/)
  assert.match(clipPipeline, /alvareth-clip-best\.mp4/)
  assert.match(clipPipeline, /canCopyVideo/)
  assert.match(clipPipeline, /canCopyAudio/)
})

test('available quality inventory is metadata-only and includes all advertised resolutions', () => {
  assert.match(youtubeSource, /--dump-single-json/)
  assert.match(youtubeSource, /--skip-download/)
  assert.match(youtubeSource, /const availableQualities = \[\.\.\.qualityMap\.values\(\)\]/)
  assert.match(youtubeSource, /Semua resolusi tersedia/)
  assert.match(clipPipeline, /Memindai kualitas melalui metadata; belum ada file video yang diunduh/)
})

test('metadata is ranked first and only the highest-quality download strategy is run', () => {
  assert.equal((clipPipeline.match(/id: '(?:yt-dlp-best-quality|qbyte-api-fallback)'/g) || []).length, 2)
  assert.match(clipPipeline, /Memindai kualitas melalui metadata; belum ada file video yang diunduh/)
  assert.match(clipPipeline, /Mengunduh satu kualitas tertinggi/)
  assert.match(clipPipeline, /Tidak ada kandidat metode lain yang diunduh/)
  assert.doesNotMatch(clipPipeline, /yt-dlp-isolated-tracks|yt-dlp-sections|youtube-clipper-ffmpeg|youtube-clippy-ffmpeg/)
  assert.doesNotMatch(clipPipeline, /candidates\.sort\(compareClipCandidates\)/)
})

test('quality diagnostics expose available resolutions and warn when YouTube only returns 360p', () => {
  assert.match(youtubeSource, /jumlahVideo: selection\.videoFormats\.length/)
  assert.match(youtubeSource, /availableQualities/)
  assert.match(youtubeSource, /topHeight <= 360/)
  assert.match(youtubeSource, /hanya melihat format sampai/)
  assert.match(youtubeSource, /bitrate: Number\(stream\.bit_rate\) \|\| 0/)
  assert.match(youtubeSource, /width: streamInfo\?\.width \|\| null/)
})

test('YouTube format probing checks HLS and optional PO-token player profiles', () => {
  assert.match(youtubeSource, /web_safari HLS/)
  assert.match(youtubeSource, /mweb \+ PO Token Provider/)
  assert.match(youtubeSource, /YTDLP_POT_PROVIDER_URL/)
  assert.match(youtubeSource, /attempts\.sort\(\(a, b\) => compareAccessibleVideo\(a\.video, b\.video\)\)/)
  assert.equal((clipPipeline.match(/\.\.\.candidate\.extractorArgs/g) || []).length, 1)
})

test('source with 1080p metadata but audio-only output retries an alternate 1080p format', async () => {
  const begin = youtubeSource.indexOf('async function downloadValidatedClipFormat(')
  const end = youtubeSource.indexOf('\n/**\n * Download a YouTube time range', begin)
  assert.ok(begin >= 0 && end > begin)
  const helperCode = youtubeSource.slice(begin, end)
  const createHelper = new Function('deps', [
    'const { getWidth, getHeight, runYtDlpWithEjsFallback, getYtDlpOutputPath,',
    ' inspectVideoStream, assertClipHasVisibleVideo, fsp, console } = deps;',
    helperCode,
    'return downloadValidatedClipFormat'
  ].join('\n'))

  const downloaded = []
  const cleaned = []
  const make = files => createHelper({
    getWidth: v => v.width,
    getHeight: v => v.height,
    runYtDlpWithEjsFallback: async (runner, args, timeoutMs) => {
      assert.equal(timeoutMs, 0)
      const id = args[1]
      downloaded.push(id)
      return { stdout: files[id] }
    },
    getYtDlpOutputPath: stdout => stdout,
    inspectVideoStream: async file => {
      if (file === '/tmp/audio-only.mp4') return null
      if (file === '/tmp/360-pretending-to-be-1080.mp4') return { width: 640, height: 360 }
      return { width: 1920, height: 1080, fps: 24 }
    },
    assertClipHasVisibleVideo: async () => {},
    fsp: { rm: async dir => cleaned.push(dir), mkdir: async () => {} },
    console: { log() {}, warn() {} }
  })
  const attempts = ['616+140', '137+140'].map(selector => ({
    selector, video: { width: 1920, height: 1080, protocol: 'https' }
  }))
  const helper = make({
    '616+140': '/tmp/audio-only.mp4',
    '137+140': '/tmp/real-1080.mp4'
  })
  const result = await helper(null, 'https://youtube.com/watch?v=test', '/tmp/clip-test',
    'test method', { attempts }, selected => ['--format', selected.selector],
    async inputPath => ({ path: inputPath }), null, 90)
  assert.equal(result.path, '/tmp/real-1080.mp4')
  assert.equal(result.sourceHeight, 1080)
  assert.deepEqual(downloaded, ['616+140', '137+140'])
  assert.equal(cleaned.length, 1)
})

test('clip source validation rejects every audio-only candidate instead of sending a black video', async () => {
  const begin = youtubeSource.indexOf('async function downloadValidatedClipFormat(')
  const end = youtubeSource.indexOf('\n/**\n * Download a YouTube time range', begin)
  const helperCode = youtubeSource.slice(begin, end)
  const createHelper = new Function('deps', [
    'const { getWidth, getHeight, runYtDlpWithEjsFallback, getYtDlpOutputPath,',
    ' inspectVideoStream, assertClipHasVisibleVideo, fsp, console } = deps;',
    helperCode,
    'return downloadValidatedClipFormat'
  ].join('\n'))
  const helper = createHelper({
    getWidth: v => v.width,
    getHeight: v => v.height,
    runYtDlpWithEjsFallback: async () => ({ stdout: '/tmp/audio-only.mp4' }),
    getYtDlpOutputPath: stdout => stdout,
    inspectVideoStream: async () => null,
    assertClipHasVisibleVideo: async () => {},
    fsp: { rm: async () => {}, mkdir: async () => {} },
    console: { log() {}, warn() {} }
  })
  await assert.rejects(helper(null, '', '/tmp/clip-failed', 'test method',
    { attempts: [{ selector: '616+140', video: { width: 1920, height: 1080 } }] },
    () => ['--format', '616+140'], async p => ({ path: p }), null, 90),
  /tidak ada format video yang benar-benar dapat dipotong/)
})

test('Qbyte fallback inspects metadata and downloads only one best video/audio pair', () => {
  assert.match(clipPipeline, /const videoFormat = pickBestVideo\(info\)/)
  assert.match(clipPipeline, /const audioFormat = pickBestAudio\(info\)/)
  assert.match(clipPipeline, /downloadFormat\([\s\S]*?videoFormat[\s\S]*?qbyteMaxBytes/)
  assert.match(clipPipeline, /downloadFormat\([\s\S]*?audioFormat[\s\S]*?qbyteMaxBytes/)
  assert.match(clipPipeline, /actualStream\.height < qbyteTopHeight \* 0\.90/)
  assert.doesNotMatch(clipPipeline, /for \(const format of videoFormats/)
})


test('real FFprobe distinguishes audio-only MP4 from a decodable 720p video', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error ||
      spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).error) {
    t.skip('ffmpeg/ffprobe binaries are not installed')
    return
  }
  const start = youtubeSource.indexOf('async function inspectVideoStream(')
  const end = youtubeSource.indexOf('\nasync function inspectAudioStream(', start)
  assert.ok(start >= 0 && end > start)
  const inspect = new Function('spawn', 'console',
    youtubeSource.slice(start, end) + '\nreturn inspectVideoStream')(spawn, { warn() {} })

  const root = await mkdtemp(path.join(tmpdir(), 'alvareth-clip-ffprobe-'))
  try {
    const audioPath = path.join(root, 'audio-only.mp4')
    const videoPath = path.join(root, 'valid-720p.mp4')
    const audio = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4',
      '-c:a', 'aac', '-y', audioPath
    ], { encoding: 'utf8' })
    assert.equal(audio.status, 0, audio.stderr)

    const video = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=0.4',
      '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p',
      '-y', videoPath
    ], { encoding: 'utf8' })
    assert.equal(video.status, 0, video.stderr)

    assert.equal(await inspect(audioPath), null)
    const inspected = await inspect(videoPath)
    assert.equal(inspected.width, 1280)
    assert.equal(inspected.height, 720)
    assert.ok(inspected.fps >= 24)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('highest-quality FFmpeg finalizer receives the selected format candidate', () => {
  const strategyStart = clipPipeline.indexOf("id: 'yt-dlp-best-quality'")
  const strategyEnd = clipPipeline.indexOf("id: 'qbyte-api-fallback'", strategyStart)
  assert.ok(strategyStart >= 0 && strategyEnd > strategyStart)
  const strategy = clipPipeline.slice(strategyStart, strategyEnd)
  assert.match(strategy, /async \(inputPath, candidate\) => \{/)
  assert.match(strategy, /candidate\.video\?\.vcodec/)
  assert.match(strategy, /getWidth\(candidate\.video\)/)
})
test('clip downloads only the highest-ranked format and trims one selected section', () => {
  assert.match(clipPipeline, /id: 'yt-dlp-best-quality'/)
  assert.match(clipPipeline, /'--download-sections', section/)
  assert.match(clipPipeline, /'--format', candidate\.selector/)
  assert.match(clipPipeline, /'--merge-output-format', 'mkv'/)
  assert.match(clipPipeline, /alvareth-clip-best\.mp4/)
  assert.match(youtubeSource, /sourceStream\.height < getHeight\(video\) \* 0\.90/)
  assert.match(youtubeSource, /assertClipHasVisibleVideo\(finalPath, duration\)/)
})


test('HD source downgrade is reported rather than described as best available quality', () => {
  assert.match(clipPipeline, /sourceMaxQuality,/)
  assert.match(clipPipeline, /qualityDowngraded:/)
  assert.match(clipPlugin, /result\.qualityDowngraded/)
  assert.match(clipPlugin, /tidak berhasil diekstrak sebagai video valid/)
})


test('one metadata inventory is reused and the selected top resolution is downloaded once', () => {
  assert.match(clipPipeline, /let sharedSelectionPromise = null/)
  assert.match(clipPipeline, /if \(!sharedSelectionPromise\)/)
  assert.equal((clipPipeline.match(/await getSharedSelection\(runner,/g) || []).length, 1)
  assert.match(clipPipeline, /return sharedSelectionPromise/)
  assert.match(youtubeSource, /slice\(0, 2\)/)
  assert.match(youtubeSource, /getWidth\(item\.video\) === topWidth/)
  assert.match(youtubeSource, /getHeight\(item\.video\) === topHeight/)
})

test('private YouTube cookies are passed only as server-side file paths', async () => {
  const begin = youtubeSource.indexOf('function getClipCookiesArgs() {')
  const end = youtubeSource.indexOf('\nfunction getYtDlpPotProviderArgs()', begin)
  assert.ok(begin >= 0 && end > begin)
  const code = youtubeSource.slice(begin, end)
  const build = env => new Function('fs', 'path', 'process', code +
    '\nreturn { getClipCookiesArgs, isYoutubeVerificationError }')(fs, path, { env })
  const privateDir = await mkdtemp(path.join(tmpdir(), 'alvareth-cookie-test-'))
  const cookiePath = path.join(privateDir, 'youtube-cookies.txt')
  try {
    await writeFile(cookiePath,
      '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tPREF\tdummy\n')
    const helpers = build({ YTDLP_COOKIES_FILE: cookiePath })
    assert.deepEqual(helpers.getClipCookiesArgs(), ['--cookies', cookiePath])
    assert.equal(helpers.isYoutubeVerificationError("Sign in to confirm you're not a bot"), true)
    assert.equal(helpers.isYoutubeVerificationError('Use --cookies for authentication'), true)
    assert.equal(helpers.isYoutubeVerificationError('Requested format is not available'), false)
    assert.match(youtubeSource, /filePath = configured \|\| privatePath/)
    assert.match(clipPipeline, /getClipCookiesArgs\(\)/)
    await writeFile(cookiePath, '{"cookies": "not-netscape-format"}')
    assert.throws(() => helpers.getClipCookiesArgs(),
      error => error?.code === 'YOUTUBE_COOKIES_INVALID')
    assert.throws(() => build({ YTDLP_COOKIES_FILE: path.join(privateDir, 'missing.txt') }).getClipCookiesArgs(),
      error => error?.code === 'YOUTUBE_COOKIES_INVALID')
  } finally {
    await rm(privateDir, { recursive: true, force: true })
  }
})

test('verification failure permits only one bounded API fallback after the best yt-dlp attempt', () => {
  assert.match(clipPipeline, /id: 'yt-dlp-best-quality'/)
  assert.match(clipPipeline, /id: 'qbyte-api-fallback'/)
  assert.match(clipPipeline, /youtubeAccessError = error\?\.code === 'YOUTUBE_COOKIES_INVALID'/)
  assert.match(clipPipeline, /accessError\.code = youtubeAccessError/)
  assert.match(clipPlugin, /error\?\.code === 'YOUTUBE_AUTH_REQUIRED'/)
  assert.match(clipPlugin, /YTDLP_COOKIES_FILE/)
  assert.match(youtubeSource, /if \(isYoutubeVerificationError\(error\)\) throw error/)
  assert.match(clipPipeline, /download dibatalkan/)
})

test('Qbyte HTTP 502 is retried once but permanent errors fail without retry', async () => {
  const begin = youtubeSource.indexOf('async function getClipYoutubeInfo(')
  const end = youtubeSource.indexOf('\nfunction pickVideo(', begin)
  assert.ok(begin >= 0 && end > begin)
  const source = youtubeSource.slice(begin, end)
  const messages = []
  let calls = 0
  const getYoutubeInfo = async () => {
    calls++
    if (calls === 1) throw new Error('Gagal ambil info HTTP 502')
    return { formats: [{ format_id: '137' }] }
  }
  const helper = new Function('getYoutubeInfo', 'console', 'setTimeout',
    source + '\nreturn getClipYoutubeInfo')(getYoutubeInfo, { warn: message => messages.push(message) },
    callback => callback())
  const result = await helper('https://youtu.be/example')
  assert.equal(result.formats[0].format_id, '137')
  assert.equal(calls, 2)
  assert.equal(messages.length, 1)

  let failures = 0
  const hardFail = new Function('getYoutubeInfo', 'console', 'setTimeout',
    source + '\nreturn getClipYoutubeInfo')(async () => {
      failures++
      throw new Error('Gagal ambil info HTTP 403')
    }, { warn() {} }, callback => callback())
  await assert.rejects(hardFail('https://youtu.be/example'), /HTTP 403/)
  assert.equal(failures, 1)
})


test('invalid .clip range explains how the bot parsed each timestamp', () => {
  assert.ok(clipPlugin.includes("Bot membaca waktu mulai sebagai *' + formatTimestamp(start)"))
  assert.ok(clipPlugin.includes("waktu akhir sebagai *' + formatTimestamp(end)"))
  assert.ok(clipPlugin.includes('Contoh: .clip URL 2:03:15 2:09:34'))
})


test('.clip and global error reporter do not retry sends on a closed WhatsApp socket', async () => {
  const handlerSource = await readFile(new URL('../handler.js', import.meta.url), 'utf8')
  assert.ok(clipPlugin.includes('conn?.ws?.readyState !== undefined && conn.ws.readyState !== 1'))
  assert.ok(clipPlugin.includes('Gagal mengirim pesan WhatsApp; detail utama tetap dicatat di terminal'))
  assert.match(handlerSource, /Laporan WhatsApp dilewati karena socket tertutup/)
  assert.match(handlerSource, /statusCode === 428/)
  assert.match(handlerSource, /Fallback dibatalkan: koneksi WhatsApp sudah tertutup/)
})


test('.clip uses the shared uploader and retains completed output after send failure', async () => {
  const senderSource = await readFile(new URL('../lib/whatsapp-file-sender.js', import.meta.url), 'utf8')
  assert.ok(clipPlugin.includes('await sendLocalFile(conn, m.chat, savedPath'))
  assert.ok(clipPlugin.includes('File tetap tersimpan: downloads/clip/'))
  assert.ok(clipPlugin.includes('await cleanupDownload(outputDir)'))
  assert.ok(!clipPlugin.includes('await conn.sendMessage(m.chat, content)'))
  assert.ok(senderSource.includes('No automatic retry is performed'))
  assert.ok(senderSource.includes('mediaUploadTimeoutMs: timeoutMs'))
  assert.ok(senderSource.includes("const mediaType = isVideo ? 'video' : 'document'"))
  assert.doesNotMatch(senderSource, /inlineVideoMaxBytes|ALVARETH_WA_INLINE_VIDEO_MAX_BYTES|forceVideo/)
  assert.doesNotMatch(clipPlugin, /inlineVideoLimit|berukuran besar dikirim sebagai dokumen/)
})
