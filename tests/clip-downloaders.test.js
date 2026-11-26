import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getYoutubeVideoId,
  pickPipedStreams,
  parseCobaltResponse,
  buildDirectSeekFfmpegArgs
} from '../lib/scrape/youtube.js'

const youtubeSource = await readFile(new URL('../lib/scrape/youtube.js', import.meta.url), 'utf8')
const clipPipeline = youtubeSource.slice(youtubeSource.indexOf('export async function downloadYoutubeClip'))

test('YouTube video ID is read from watch, short, shorts, live and embed URLs', () => {
  assert.equal(getYoutubeVideoId('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), 'aqz-KE-bpKQ')
  assert.equal(getYoutubeVideoId('https://youtu.be/aqz-KE-bpKQ?t=120'), 'aqz-KE-bpKQ')
  assert.equal(getYoutubeVideoId('https://www.youtube.com/shorts/aqz-KE-bpKQ'), 'aqz-KE-bpKQ')
  assert.equal(getYoutubeVideoId('https://www.youtube.com/live/aqz-KE-bpKQ'), 'aqz-KE-bpKQ')
  assert.equal(getYoutubeVideoId('https://www.youtube.com/embed/aqz-KE-bpKQ'), 'aqz-KE-bpKQ')
  assert.throws(() => getYoutubeVideoId('https://www.youtube.com/'), /Tidak dapat membaca ID video/)
  assert.throws(() => getYoutubeVideoId('bukan url'), /Tidak dapat membaca ID video/)
})

test('Piped stream picker prefers the tallest video and the best audio', () => {
  const picked = pickPipedStreams({
    videoStreams: [
      { url: 'https://x/720.mp4', quality: '720p', format: 'MPEG_4', codec: 'avc1.64001f', fps: 30, height: 720, videoOnly: false },
      { url: 'https://x/1080.webm', quality: '1080p', format: 'WEBM', codec: 'vp09.00.51.08', fps: 30, height: 1080, videoOnly: true },
      { url: 'https://x/360.mp4', quality: '360p', format: 'MPEG_4', codec: 'avc1.42001e', fps: 30, height: 360, videoOnly: true },
      { url: 'not-a-url', quality: '2160p', format: 'WEBM', codec: 'vp09.00.51.08', fps: 30, height: 2160, videoOnly: true }
    ],
    audioStreams: [
      { url: 'https://x/a128.m4a', format: 'M4A', codec: 'mp4a.40.2', bitrate: 128 },
      { url: 'https://x/a256.opus', format: 'WEBM', codec: 'opus', bitrate: 256 }
    ]
  })
  assert.equal(picked.videoUrl, 'https://x/1080.webm')
  assert.equal(picked.height, 1080)
  assert.equal(picked.videoCodec, 'vp09.00.51.08')
  assert.equal(picked.audioUrl, 'https://x/a256.opus')
  assert.equal(picked.audioCodec, 'opus')
  assert.equal(picked.videoOnly, true)
})

test('Piped stream picker accepts a muxed video without a separate audio stream', () => {
  const picked = pickPipedStreams({
    videoStreams: [
      { url: 'https://x/720.mp4', quality: '720p', format: 'MPEG_4', codec: 'avc1.64001f', fps: 30, height: 720, videoOnly: false }
    ],
    audioStreams: []
  })
  assert.equal(picked.videoUrl, 'https://x/720.mp4')
  assert.equal(picked.audioUrl, null)
  assert.equal(picked.videoOnly, false)
})

test('Piped stream picker rejects video-only streams without audio and empty payloads', () => {
  assert.throws(() => pickPipedStreams({
    videoStreams: [{ url: 'https://x/720.webm', quality: '720p', format: 'WEBM', codec: 'vp09.00.51.08', fps: 30, height: 720, videoOnly: true }],
    audioStreams: []
  }), /tidak mengembalikan stream audio/)
  assert.throws(() => pickPipedStreams({ videoStreams: [], audioStreams: [] }), /tidak mengembalikan stream video/)
  assert.throws(() => pickPipedStreams({}), /tidak mengembalikan stream video/)
})

test('Cobalt response parser accepts redirect, tunnel and picker payloads', () => {
  assert.deepEqual(
    parseCobaltResponse({ status: 'redirect', url: 'https://cdn.example/video.mp4' }),
    { url: 'https://cdn.example/video.mp4', status: 'redirect' }
  )
  assert.deepEqual(
    parseCobaltResponse({ status: 'tunnel', url: 'https://co.example/tunnel/abc' }),
    { url: 'https://co.example/tunnel/abc', status: 'tunnel' }
  )
  assert.deepEqual(
    parseCobaltResponse({ status: 'picker', picker: [{ url: 'https://cdn.example/a.mp4' }, { url: 'https://cdn.example/b.mp4' }] }),
    { url: 'https://cdn.example/a.mp4', status: 'picker' }
  )
  assert.throws(() => parseCobaltResponse({ status: 'error', text: 'rate limited' }), /rate limited/)
  assert.throws(() => parseCobaltResponse({ status: 'redirect' }), /tidak mengembalikan URL unduhan/)
  assert.throws(() => parseCobaltResponse({ status: 'picker', picker: [] }), /tanpa URL unduhan/)
  assert.throws(() => parseCobaltResponse(null), /tidak mengembalikan respons JSON/)
})

test('direct-seek FFmpeg args seek before the input so only the range is fetched', () => {
  const args = buildDirectSeekFfmpegArgs({
    videoUrl: 'https://cdn.example/v.mp4',
    audioUrl: 'https://cdn.example/a.m4a',
    startSeconds: 1500,
    durationSeconds: 120,
    videoCodec: 'avc1.640028',
    audioCodec: 'mp4a.40.2',
    width: 1920,
    height: 1080,
    hasAudio: true,
    outputPath: '/tmp/clip.mp4'
  })
  // -ss must come BEFORE each -i (input seek -> HTTP Range); -ss after -i
  // would download the whole file first.
  const firstSeek = args.indexOf('-ss')
  const firstInput = args.indexOf('-i')
  assert.ok(firstSeek >= 0 && firstSeek < firstInput, 'seek pertama harus sebelum input pertama')
  assert.equal(args[firstSeek + 1], '1500')
  assert.equal(args[args.indexOf('-t') + 1], '120')
  assert.ok(args.includes('https://cdn.example/v.mp4'))
  assert.ok(args.includes('https://cdn.example/a.m4a'))
  assert.ok(args.includes('0:v:0') && args.includes('1:a:0'))
  assert.ok(args.includes('copy'), 'H.264 + AAC harus stream-copy')
  assert.ok(!args.includes('libx264'), 'tidak boleh re-encode bila codec sudah kompatibel')
  assert.equal(args.at(-1), '/tmp/clip.mp4')
})

test('direct-seek FFmpeg args re-encode VP9/Opus and handle video-only sources', () => {
  const encoded = buildDirectSeekFfmpegArgs({
    videoUrl: 'https://cdn.example/v.webm',
    audioUrl: 'https://cdn.example/a.opus',
    startSeconds: 60,
    durationSeconds: 30,
    videoCodec: 'vp09.00.51.08',
    audioCodec: 'opus',
    width: 1280,
    height: 720,
    hasAudio: true,
    outputPath: '/tmp/clip.mp4'
  })
  assert.ok(encoded.includes('libx264'))
  assert.ok(encoded.includes('aac'))
  assert.ok(!encoded.includes('copy'))

  const videoOnly = buildDirectSeekFfmpegArgs({
    videoUrl: 'https://cdn.example/v.mp4',
    audioUrl: null,
    startSeconds: 10,
    durationSeconds: 5,
    videoCodec: 'avc1.640028',
    audioCodec: '',
    width: 1280,
    height: 720,
    hasAudio: false,
    outputPath: '/tmp/clip.mp4'
  })
  assert.ok(!videoOnly.includes('1:a:0'))
  assert.ok(!videoOnly.includes('0:a:0?'))
  assert.ok(!videoOnly.includes('-c:a'))
})

test('strategies run range-aware downloaders first, full downloads last', () => {
  const ids = [...clipPipeline.matchAll(/id: '([a-z0-9-]+)'/g)].map(match => match[1])
  assert.deepEqual(ids, [
    'yt-dlp-direct-seek',
    'yt-dlp-best-quality',
    'piped-direct-seek',
    'cobalt-api',
    'qbyte-api-fallback'
  ])
  const first = clipPipeline.slice(clipPipeline.indexOf("id: 'yt-dlp-direct-seek'"), clipPipeline.indexOf("id: 'yt-dlp-best-quality'"))
  assert.match(first, /'-g', '-f', candidate\.selector/)
  assert.match(first, /downloadClipViaDirectUrls\(/)
  const second = clipPipeline.slice(clipPipeline.indexOf("id: 'yt-dlp-best-quality'"), clipPipeline.indexOf("id: 'piped-direct-seek'"))
  assert.match(second, /'--download-sections', section/)
  const third = clipPipeline.slice(clipPipeline.indexOf("id: 'piped-direct-seek'"), clipPipeline.indexOf("id: 'cobalt-api'"))
  assert.match(third, /fetchPipedStreams\(/)
  assert.match(third, /downloadClipViaDirectUrls\(/)
  const fourth = clipPipeline.slice(clipPipeline.indexOf("id: 'cobalt-api'"), clipPipeline.indexOf("id: 'qbyte-api-fallback'"))
  assert.match(fourth, /requestCobaltDownloadUrl\(/)
  assert.match(fourth, /downloadRemoteFileToPath\(/)
  assert.match(clipPipeline, /Semua downloader YouTube Clip gagal \(urutan: URL langsung \+ seek, yt-dlp sections, Piped, Cobalt, Qbyte\)/)
})

test('real FFmpeg input seek cuts a 5 s clip out of a 30 s local file', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error ||
      spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).error) {
    t.skip('ffmpeg/ffprobe binaries are not installed')
    return
  }
  const root = await mkdtemp(path.join(tmpdir(), 'alvareth-clip-seek-'))
  try {
    const sourcePath = path.join(root, 'source.mp4')
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
      // Short GOP (1 s) so the keyframe pre-roll of an input seek stays
      // under a second; real YouTube sources have a 2-5 s GOP.
      '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
      '-movflags', '+faststart',
      '-y', sourcePath
    ], { encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)

    const outputPath = path.join(root, 'clip.mp4')
    const args = buildDirectSeekFfmpegArgs({
      videoUrl: sourcePath,
      audioUrl: null,
      startSeconds: 10,
      durationSeconds: 5,
      videoCodec: 'avc1.640028',
      audioCodec: 'mp4a.40.2',
      width: 640,
      height: 360,
      hasAudio: true,
      outputPath
    })
    const cut = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
    assert.equal(cut.status, 0, cut.stderr)

    const probed = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height,codec_name:format=duration',
      '-of', 'json', outputPath
    ], { encoding: 'utf8' })
    assert.equal(probed.status, 0, probed.stderr)
    const data = JSON.parse(probed.stdout)
    const duration = Number(data.format?.duration)
    assert.ok(duration >= 4.5 && duration <= 6.5, `klip harus ~5 detik, dapat ${duration} detik`)
    const video = data.streams.find(stream => stream.codec_type === 'video')
    const audio = data.streams.find(stream => stream.codec_type === 'audio')
    assert.equal(video?.width, 640)
    assert.equal(video?.height, 360)
    assert.equal(video?.codec_name, 'h264')
    assert.ok(audio, 'klip harus membawa track audio')
    assert.equal(audio?.codec_name, 'aac')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
