import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
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

test('Qbyte clip source streams have no 256 MB or 96 MB client cap', () => {
  assert.match(clipPipeline, /'clip-api-video', outputDir, Infinity/)
  assert.match(clipPipeline, /'clip-api-audio', outputDir, Infinity/)
  assert.doesNotMatch(clipPipeline, /256\s*\*\s*1024\s*\*\s*1024/)
  assert.doesNotMatch(clipPipeline, /96\s*\*\s*1024\s*\*\s*1024/)
})

test('clip yt-dlp calls have no idle or total execution deadline', () => {
  assert.doesNotMatch(clipPipeline, /idleTimeoutMs\s*:/)
  assert.doesNotMatch(clipPipeline, /6\s*\*\s*60\s*\*\s*1000/)
  assert.match(clipPipeline, /ensureYtDlpPythonRunner\(0\)/)
  assert.match(clipPipeline, /ensureYtDlpBinary\(0\)/)
  assert.match(youtubeSource, /runYtDlpWithEjsFallback\(runner, args, 0, onProgress\)/)
  assert.equal((clipPipeline.match(/downloadValidatedClipFormat\(/g) || []).length, 4)
})

test('clip FFmpeg and Qbyte HTTP calls do not set application deadlines', () => {
  assert.match(youtubeSource, /function runClipFfmpeg\(args, timeoutMs = 0/)
  assert.equal((clipPipeline.match(/\], 0, options\?\.onProgress, duration\)/g) || []).length, 4)
  assert.match(clipPipeline, /getYoutubeInfo\(normalizedUrl, 0\)/)
  assert.equal((clipPipeline.match(/}, 0\n        \)/g) || []).length, 1)
  assert.match(clipPipeline, /videoFormats\.slice\(0, 12\)/)
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
  assert.equal((clipPipeline.match(/probeYtDlpFormats\(runner, normalizedUrl/g) || []).length, 4)
  assert.equal((clipPipeline.match(/'--format', candidate\.selector/g) || []).length, 3)
  assert.equal((clipPipeline.match(/'--merge-output-format', 'mkv'/g) || []).length, 3)
  assert.equal((clipPipeline.match(/\.\.\.candidate\.extractorArgs/g) || []).length, 5)
  assert.match(youtubeSource, /'--dump-single-json'/)
  assert.match(youtubeSource, /'--remote-components', 'ejs:github'/)
  assert.match(youtubeSource, /videoTerbaik: formatInventorySummary/)
})

test('all clip transcodes retain high source quality and map the video stream explicitly', () => {
  assert.match(clipPipeline, /'-map', '0:v:0'/)
  assert.ok(clipPipeline.includes("'0:a:0?'"))
  assert.equal((clipPipeline.match(/'-crf', '18'/g) || []).length, 5)
  assert.equal((clipPipeline.match(/'-b:a', '192k'/g) || []).length, 5)
  assert.match(clipPipeline, /alvareth-clip-sections\.mp4/)
})

test('all downloader methods are evaluated and the best real output is selected', () => {
  assert.equal((clipPipeline.match(/id: '(?:yt-dlp-isolated-tracks|yt-dlp-sections|youtube-clipper-ffmpeg|youtube-clippy-ffmpeg|qbyte-api-ffmpeg)'/g) || []).length, 5)
  assert.match(clipPipeline, /const candidates = \[\]/)
  assert.match(clipPipeline, /candidates\.sort\(compareClipCandidates\)/)
  assert.match(youtubeSource, /function compareClipCandidates\(a, b\)/)
  assert.match(youtubeSource, /width \* height/)
  assert.match(youtubeSource, /Number\(candidate\.fps \|\| 0\)/)
  assert.match(clipPipeline, /Perbandingan kandidat kualitas/)
  assert.match(clipPipeline, /Kandidat yang lebih rendah dibersihkan/)
})

test('quality diagnostics expose available resolutions and warn when YouTube only returns 360p', () => {
  assert.match(youtubeSource, /jumlahVideo: selection\.videoFormats\.length/)
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
  assert.equal((clipPipeline.match(/\.\.\.candidate\.extractorArgs/g) || []).length, 5)
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
  const attempts = ['616+140', '270+140', '137+140'].map(selector => ({
    selector, video: { width: 1920, height: 1080, protocol: 'https' }
  }))
  const helper = make({
    '616+140': '/tmp/audio-only.mp4',
    '270+140': '/tmp/360-pretending-to-be-1080.mp4',
    '137+140': '/tmp/real-1080.mp4'
  })
  const result = await helper(null, 'https://youtube.com/watch?v=test', '/tmp/clip-test',
    'test method', { attempts }, selected => ['--format', selected.selector],
    async inputPath => ({ path: inputPath }), null, 90)
  assert.equal(result.path, '/tmp/real-1080.mp4')
  assert.equal(result.sourceHeight, 1080)
  assert.deepEqual(downloaded, ['616+140', '270+140', '137+140'])
  assert.equal(cleaned.length, 2)
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

test('Qbyte retries advertised video IDs and verifies the actual downloaded resolution', () => {
  assert.match(clipPipeline, /videoFormats\.slice\(0, 12\)/)
  assert.match(clipPipeline, /actualStream\.height < advertisedHeight \* 0\.90/)
  assert.match(clipPipeline, /Qbyte video tervalidasi/)
  assert.match(clipPipeline, /if \(!videoPath\)/)
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


test('isolated HD method downloads video-only and audio-only separately before muxing', () => {
  assert.match(clipPipeline, /id: 'yt-dlp-isolated-tracks'/)
  assert.match(clipPipeline, /candidate\.video\.format_id \|\| candidate\.video\.itag/)
  assert.match(clipPipeline, /candidate\.audio\?\.format_id \|\| candidate\.audio\?\.itag/)
  assert.match(clipPipeline, /audioStream = await inspectAudioStream\(audioPath\)/)
  assert.match(clipPipeline, /audioPath \? '1:a:0' : '0:a:0\?'/)
  assert.match(clipPipeline, /alvareth-clip-isolated\.mp4/)
  assert.match(youtubeSource, /sourceStream\.height < getHeight\(video\) \* 0\.90/)
  assert.match(youtubeSource, /assertClipHasVisibleVideo\(finalPath, duration\)/)
})

