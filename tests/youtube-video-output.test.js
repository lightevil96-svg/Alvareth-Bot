import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extractSelectedCommandId } from '../lib/interactive-command.js'

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, 'Missing source section: ' + startMarker)
  return source.slice(start, end).trim().replace(/^export /, '')
}

async function createQualityHelpers() {
  const source = await readFile(new URL('../lib/scrape/youtube.js', import.meta.url), 'utf8')
  const sections = [
    extractBetween(source, 'function getHeight(format) {', 'function getFps(format) {'),
    extractBetween(source, 'function getFps(format) {', 'function getWidth(format) {'),
    extractBetween(source, 'function getWidth(format) {', 'function getFormatPixels(format) {'),
    extractBetween(source, 'function getFormatPixels(format) {', 'function getVideoBitrate(format) {'),
    extractBetween(source, 'function getVideoBitrate(format) {', 'function compareVideoFormats(a, b) {'),
    extractBetween(source, 'function compareVideoFormats(a, b) {', 'export async function getYoutubeInfo('),
    extractBetween(source, 'function getVideoFormats(info) {', 'function pickBestVideo(info, maxBytes = Infinity) {'),
    extractBetween(source, 'function getAudioBitrate(format) {', 'function pickAudioForBitrate(info, targetBitrate = 320) {'),
    extractBetween(source, 'function getAudioFormats(info) {', 'function selectYtDlpFormats(info) {'),
    extractBetween(source, 'function selectYtDlpFormats(info) {', 'function formatInventorySummary('),
    extractBetween(source, 'function validateYoutubeBestFallbackQuality(', 'export async function downloadYoutubeVideoBest(')
  ]
  const code = sections.join('\n') +
    '\nreturn { selectYtDlpFormats, validateYoutubeBestFallbackQuality };'
  return new Function(code)()
}

async function createYoutubeHelpers() {
  const source = await readFile(new URL('../lib/scrape/youtube.js', import.meta.url), 'utf8')
  const runFfmpeg = extractBetween(source, 'function runFfmpeg(args) {', '// Read the dimensions')
  const inspectVideo = extractBetween(source, 'async function inspectVideoStream(filePath) {', 'async function inspectAudioStream(filePath) {')
  const inspectAudio = extractBetween(source, 'async function inspectAudioStream(filePath) {', 'export function buildWhatsAppVideoTranscodeArgs(')
  const buildArgs = extractBetween(source, 'export function buildWhatsAppVideoTranscodeArgs(', '/**\n * Re-encode a downloaded YouTube video')
  const render = extractBetween(source, 'export async function renderYoutubeVideoForWhatsApp(', 'async function mergeVideoAudio(')
  const code = [
    'const { spawn, path, fsp, fileTypeFromFile, console } = deps;',
    runFfmpeg,
    inspectVideo,
    inspectAudio,
    buildArgs,
    render,
    'return { buildWhatsAppVideoTranscodeArgs, renderYoutubeVideoForWhatsApp };'
  ].join('\n')
  return new Function('deps', code)({
    spawn,
    path,
    fsp: await import('node:fs/promises'),
    fileTypeFromFile: async () => ({ mime: 'video/mp4' }),
    console: { warn() {} }
  })
}

test('WhatsApp video transcode forces H.264, yuv420p, AAC and faststart', async () => {
  const { buildWhatsAppVideoTranscodeArgs } = await createYoutubeHelpers()
  const args = buildWhatsAppVideoTranscodeArgs('/tmp/source.webm', '/tmp/output.mp4')
  const hasPair = (key, value) => {
    const index = args.indexOf(key)
    return index >= 0 && args[index + 1] === value
  }
  assert.ok(hasPair('-c:v', 'libx264'))
  assert.ok(hasPair('-pix_fmt', 'yuv420p'))
  assert.ok(hasPair('-c:a', 'aac'))
  assert.ok(hasPair('-movflags', '+faststart'))
  assert.ok(hasPair('-map', '0:v:0'))
  assert.ok(args.includes('0:a:0?'))
})


test('highest-quality inventory selects the best video stream and pairs separate audio', async () => {
  const { selectYtDlpFormats } = await createQualityHelpers()
  const selection = selectYtDlpFormats({
    formats: [
      {
        format_id: '18',
        width: 640,
        height: 360,
        fps: 30,
        vcodec: 'avc1.42001E',
        acodec: 'mp4a.40.2',
        ext: 'mp4',
        protocol: 'https'
      },
      {
        format_id: '137',
        width: 1920,
        height: 1080,
        fps: 30,
        vcodec: 'avc1.640028',
        acodec: 'none',
        ext: 'mp4',
        protocol: 'https'
      },
      {
        format_id: '140',
        vcodec: 'none',
        acodec: 'mp4a.40.2',
        abr: 128,
        ext: 'm4a'
      }
    ]
  })

  assert.equal(selection.video.height, 1080)
  assert.equal(selection.video.width, 1920)
  assert.equal(selection.selector, '137+140')
})

test('highest-quality API fallback rejects 360p when YouTube maximum is unknown', async () => {
  const { validateYoutubeBestFallbackQuality } = await createQualityHelpers()
  assert.throws(
    () => validateYoutubeBestFallbackQuality({ ytDlpTopHeight: 0, fallbackHeight: 360 }),
    /yt-dlp belum berhasil memverifikasi daftar resolusi YouTube/
  )
})

test('highest-quality API fallback rejects a downgrade below verified YouTube metadata', async () => {
  const { validateYoutubeBestFallbackQuality } = await createQualityHelpers()
  assert.throws(
    () => validateYoutubeBestFallbackQuality({ ytDlpTopHeight: 1080, fallbackHeight: 360 }),
    /metadata YouTube menemukan 1080p/
  )
})

test('360p is accepted only when yt-dlp confirms 360p is the maximum', async () => {
  const { validateYoutubeBestFallbackQuality } = await createQualityHelpers()
  assert.deepEqual(
    validateYoutubeBestFallbackQuality({ ytDlpTopHeight: 360, fallbackHeight: 360 }),
    { qualityVerified: true, sourceMaxQuality: 360 }
  )
})

test('higher API-only fallback is labelled unverified instead of claiming a YouTube maximum', async () => {
  const { validateYoutubeBestFallbackQuality } = await createQualityHelpers()
  assert.deepEqual(
    validateYoutubeBestFallbackQuality({ ytDlpTopHeight: 0, fallbackHeight: 720 }),
    { qualityVerified: false, sourceMaxQuality: 720 }
  )
})

test('VP9/Opus source is rendered into a playable H.264/AAC MP4', async t => {
  const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  const ffprobeCheck = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' })
  if (ffmpegCheck.error || ffmpegCheck.status !== 0 || ffprobeCheck.error || ffprobeCheck.status !== 0) {
    t.skip('ffmpeg/ffprobe are not installed')
    return
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'alvareth-youtube-video-'))
  try {
    const source = path.join(root, 'source.webm')
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '64k',
      '-shortest', '-y', source
    ], { encoding: 'utf8' })
    if (generated.error || generated.status !== 0) {
      t.skip('FFmpeg build does not include libvpx-vp9/libopus')
      return
    }

    const { renderYoutubeVideoForWhatsApp } = await createYoutubeHelpers()
    const result = await renderYoutubeVideoForWhatsApp({
      path: source,
      outputDir: root,
      title: 'fixture',
      quality: 360
    })
    const probe = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height:format=duration',
      '-of', 'json',
      result.path
    ], { encoding: 'utf8' })
    assert.equal(probe.status, 0, probe.stderr)
    const metadata = JSON.parse(probe.stdout)
    const video = metadata.streams.find(stream => stream.codec_type === 'video')
    const audio = metadata.streams.find(stream => stream.codec_type === 'audio')

    assert.equal(video.codec_name, 'h264')
    assert.equal(video.pix_fmt, 'yuv420p')
    assert.equal(video.width, 640)
    assert.equal(video.height, 360)
    assert.equal(audio.codec_name, 'aac')
    assert.equal(result.renderedForWhatsApp, true)
    assert.equal(result.videoCodec, 'h264')
    assert.equal(result.audioCodec, 'aac')
    assert.equal(result.quality, 360)
    assert.ok(result.duration > 0)
    assert.ok((await stat(result.path)).size > 0)
    await assert.rejects(stat(source), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('.ytmp4 offers highest quality and .play routes its video choice through the same renderer', async () => {
  const [ytmp4, play, ytmp3, youtube] = await Promise.all([
    readFile(new URL('../plugins/downloader/ytmp4.js', import.meta.url), 'utf8'),
    readFile(new URL('../plugins/downloader/play.js', import.meta.url), 'utf8'),
    readFile(new URL('../plugins/downloader/ytmp3.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/scrape/youtube.js', import.meta.url), 'utf8')
  ])

  assert.ok(ytmp4.includes('if (!hasExplicitQuality)'))
  assert.ok(ytmp4.includes('Kualitas Tertinggi (HD)'))
  assert.ok(ytmp4.includes('id: bestId'))
  assert.ok(ytmp4.includes('renderYoutubeVideoForWhatsApp(result)'))
  assert.ok(ytmp4.includes('sendLocalFile(conn, m.chat, result.path'))
  assert.ok(ytmp4.includes('kualitas tertinggi YouTube terverifikasi'))
  assert.ok(ytmp4.includes('belum terverifikasi ke YouTube'))
  assert.ok(youtube.includes("probeYtDlpFormats(binaryPath, normalizedUrl, 'ytmp4 kualitas tertinggi'"))
  assert.ok(youtube.includes('validateYoutubeBestFallbackQuality({'))
  assert.ok(!ytmp4.includes('MAX_INLINE_VIDEO_BYTES'))
  assert.ok(!ytmp4.includes('document: buffer'))

  const dollar = String.fromCharCode(36)
  const tick = String.fromCharCode(96)
  assert.ok(play.includes('const videoBest = ' + tick + dollar + '{prefix}ytmp4 ' + dollar + '{video.url}|best' + tick))
  assert.ok(play.includes('const videoLow = ' + tick + dollar + '{prefix}ytmp4 ' + dollar + '{video.url}|360' + tick))
  assert.ok(play.includes('const audioBest = ' + tick + dollar + '{prefix}ytmp3 ' + dollar + '{video.url}|320' + tick))
  assert.ok(play.includes('dirender ke H.264/AAC'))
  assert.ok(ytmp3.includes('downloadYoutubeAudioYtDlp'))
  assert.ok(ytmp3.includes('encodeAudioBufferToMp3'))
})

test('WhatsApp native-flow selection preserves the .ytmp4 highest-quality command', () => {
  const selectedId = '.ytmp4 https://youtu.be/example|best'
  const response = {
    ephemeralMessage: {
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: selectedId })
          }
        }
      }
    }
  }
  assert.equal(extractSelectedCommandId(response), selectedId)
})
