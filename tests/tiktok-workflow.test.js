import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getTikTokOutputQualities,
  compareTikTokResolution,
  getTikTokScaleFilter,
  parseTikTokSlideDurations
} from '../lib/tiktok-workflow.js'
import { extractTikTokLivePhotoVideoUrl } from '../lib/tiktok-live-photo.js'
import { buildTikTokProviderFallback } from '../lib/tiktok-provider-fallback.js'

test('TikTok quality options are limited to source resolution and lower standard tiers', () => {
  assert.deepEqual(getTikTokOutputQualities(1080, 1920), [1080, 720, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(720, 1280), [720, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(576, 1024), [576, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(1920, 1080), [1080, 720, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(0, 1080), [])
})

test('TikTok resolution comparison selects the highest actual dimensions without a 567p ceiling', () => {
  assert.ok(compareTikTokResolution(
    { width: 1080, height: 1920 },
    { width: 1008, height: 567 }
  ) > 0)
  assert.ok(compareTikTokResolution(
    { width: 2160, height: 3840 },
    { width: 1080, height: 1920 }
  ) > 0)
  assert.equal(compareTikTokResolution(
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 }
  ), 0)
})

test('TikTok scale filter preserves portrait and landscape orientation without upscaling', () => {
  const portrait = getTikTokScaleFilter(720, 1280, 480)
  assert.match(portrait, /min\(iw,480\)/)
  assert.match(portrait, /min\(ih,480\)/)
  const landscape = getTikTokScaleFilter(1920, 1080, 720)
  assert.match(landscape, /min\(ih,720\)/)
  assert.match(landscape, /min\(iw,720\)/)
  assert.match(getTikTokScaleFilter(720, 1280, 1080), /min\(iw,720\)/)
  assert.throws(() => getTikTokScaleFilter(0, 1080, 720), /dimensi/i)
})

test('uniform slide duration applies to every photo and validates count', () => {
  assert.deepEqual(parseTikTokSlideDurations([2, 2, 2], 3), [2, 2, 2])
  assert.deepEqual(parseTikTokSlideDurations('2,3,1,4', 4), [2, 3, 1, 4])
  assert.deepEqual(parseTikTokSlideDurations('2 3 1', 3), [2, 3, 1])
  assert.throws(() => parseTikTokSlideDurations('2,3', 3), /jumlah durasi/i)
  assert.throws(() => parseTikTokSlideDurations('2,0,1', 3), /1–60/i)
  assert.throws(() => parseTikTokSlideDurations('61,1', 2), /1–60/i)
  assert.throws(() => parseTikTokSlideDurations('60,60,60,60,60,1', 6), /300 detik/i)
})
test('TikTok plugin registers photo actions, slideshow, and FFmpeg quality rendering', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  assert.ok(plugin.includes('ttphotoall'))
  assert.ok(plugin.includes('ttfotopilih'))
  assert.ok(plugin.includes('ttslideshowcustom'))
  assert.ok(plugin.includes('ttquality'))
  assert.ok(plugin.includes('renderTikTokPhotoSlideshow'))
  assert.match(plugin, /'-c:v',\s*'libx264'/)
  assert.match(plugin, /Render ulang MP4/)
})

test('TikTok photo parser extracts original Live Photo motion clips in image order', () => {
  const liveVideo = 'https://cdn.example/live-photo-1.mp4'
  const images = [
    {
      imageURL: { urlList: ['https://cdn.example/still-1.jpeg'] },
      live_photo_info: {
        is_live_photo: true,
        live_photo: {
          download_no_watermark_addr: { url_list: [liveVideo] }
        }
      }
    },
    {
      imageURL: { urlList: ['https://cdn.example/still-2.jpeg'] },
      live_photo_info: {
        is_live_photo: false,
        live_photo: {
          play_addr: { url_list: ['https://cdn.example/not-live.mp4'] }
        }
      }
    },
    { imageURL: { urlList: ['https://cdn.example/still-3.jpeg'] } },
    {
      imageURL: { urlList: ['https://cdn.example/still-4.jpeg'] },
      clip_type: 3,
      video: { play_addr: { url_list: ['https://cdn.example/direct-live.mp4'] } }
    }
  ]
  assert.deepEqual(images.map(extractTikTokLivePhotoVideoUrl), [
    liveVideo, null, null, 'https://cdn.example/direct-live.mp4'
  ])
})

test('single TikTok Live Photo loops its original motion clip while music plays once', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  const renderer = plugin
    .split('async function renderTikTokLivePhotoWithMusic')[1]
    .split('async function renderTikTokPhotoSlideshow')[0]
  assert.match(renderer, /'-stream_loop', '-1', '-i', liveVideoPath/)
  assert.match(renderer, /duration = Math\.min\(audioDuration, 60\)/)
  assert.match(renderer, /'-shortest'/)
  assert.doesNotMatch(renderer, /'-loop', '1'/)
  assert.doesNotMatch(renderer, /'-stream_loop', '-1', '-i', audioPath/)

  const sender = plugin
    .split('async function sendTikTokSinglePhotoVideo')[1]
    .split('async function sendTikTokPhotoAlbum')[0]
  assert.match(sender, /renderTikTokLivePhotoWithMusic\(liveVideoUrl, audioUrl, outputPath\)/)
  assert.match(sender, /Gerakan asli Live Photo diulang sampai musik selesai/)
  assert.match(sender, /Musik asli diputar satu kali tanpa restart/)
})

test('Live Photo extractor reads official live_photo_info and direct image.video payloads', () => {
  const officialLiveVideo = 'https://cdn.example/official-live-photo.mp4'
  const directLiveVideo = 'https://cdn.example/direct-live-photo.mp4'
  assert.equal(extractTikTokLivePhotoVideoUrl({
    live_photo_info: {
      is_live_photo: true,
      live_photo: { play_addr: { url_list: [officialLiveVideo] } }
    }
  }), officialLiveVideo)
  assert.equal(extractTikTokLivePhotoVideoUrl({
    clip_type: 3,
    video: { download_no_watermark_addr: { url_list: [directLiveVideo] } }
  }), directLiveVideo)
  assert.equal(extractTikTokLivePhotoVideoUrl({
    clip_type: 2,
    video: { play_addr: { url_list: ['https://cdn.example/still-not-motion.mp4'] } }
  }), null)
})

test('Live Photo extractor reads the canonical nested live_photo.video shape', () => {
  const nestedLiveVideo = 'https://cdn.example/nested-live-photo.mp4'
  // Official LivePhotoStruct: live_photo_info.live_photo.video.play_addr.
  // The previous extractor only followed a fixed key list and returned
  // null for this shape, so real Live Photo posts were reported as
  // having no motion clip at all.
  assert.equal(extractTikTokLivePhotoVideoUrl({
    imageURL: { urlList: ['https://cdn.example/still-1.jpeg'] },
    live_photo_info: {
      is_live_photo: true,
      live_photo: {
        video: { play_addr: { url_list: [nestedLiveVideo] } }
      }
    }
  }), nestedLiveVideo)
  assert.equal(extractTikTokLivePhotoVideoUrl({
    live_photo_info: {
      is_live_photo: true,
      live_photo: {
        video: { download_no_watermark_addr: { url_list: ['https://cdn.example/nested-dl.mp4'] } }
      }
    }
  }), 'https://cdn.example/nested-dl.mp4')
  // A still image stored beside the clip (image first in the object)
  // must not win over the video.
  assert.equal(extractTikTokLivePhotoVideoUrl({
    live_photo_info: {
      is_live_photo: true,
      live_photo: {
        image: { display_image: { url_list: ['https://cdn.example/still-first.jpeg'] } },
        video: { play_addr: { url_list: ['https://cdn.example/live-after-still.mp4'] } }
      }
    }
  }), 'https://cdn.example/live-after-still.mp4')
  // Only a still image and no clip at all means null, not the still URL.
  assert.equal(extractTikTokLivePhotoVideoUrl({
    live_photo_info: {
      is_live_photo: true,
      live_photo: {
        image: { url_list: ['https://cdn.example/only-still.jpeg'] }
      }
    }
  }), null)
})

test('Still photos render as moving video and Live Photo output is motion-checked', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  const stillRenderer = plugin
    .split('async function renderTikTokStillPhotoVideo')[1]
    .split('async function sendTikTokSinglePhotoVideo')[0]
  assert.match(stillRenderer, /zoompan/)
  assert.match(stillRenderer, /scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560/)
  assert.match(stillRenderer, /'-loop', '1', '-framerate', '30'/)
  assert.match(stillRenderer, /duration = Math\.min\(audioDuration, 60\)/)

  const motionCheck = plugin
    .split('async function videoHasMotion')[1]
    .split('async function renderTikTokStillPhotoVideo')[0]
  assert.match(motionCheck, /-f', 'rawvideo', '-pix_fmt', 'rgb24'/)
  assert.match(motionCheck, /total \/ frames\[0\]\.length >= 1\.0/)

  const sender = plugin
    .split('async function sendTikTokSinglePhotoVideo')[1]
    .split('async function sendTikTokPhotoAlbum')[0]
  assert.match(sender, /videoHasMotion\(outputPath, liveRendered\.duration\)/)
  assert.match(sender, /renderTikTokStillPhotoVideo\(imageUrl, audioUrl, outputPath, durationSeconds\)/)
  assert.match(sender, /Foto diam berhasil dijadikan video bergerak \(efek zoom\)/)
  assert.match(sender, /bukan klip Live Photo asli/)
  assert.match(sender, /mode = 'still'/)
})

test('TikTok photo menu always offers select-one-photo and all-photo video actions', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  const menu = plugin
    .split('async function sendTikTokPhotoPostMenu')[1]
    .split('async function sendTikTokSlideshowDurationMenu')[0]
  const selectedMenu = plugin
    .split('async function sendPhotoToVideoActionMenus')[1]
    .split('async function cleanupStaleTikTokTemps')[0]
  const slideshow = plugin
    .split('if (isSlideshowCommand)')[1]
    .split('if (isSlideshowCustomCommand)')[0]
  const custom = plugin
    .split('if (isSlideshowCustomCommand)')[1]
    .split('let targetQuality = null')[0]
  const selected = plugin
    .split('if (isPhotoToVideoCommand)')[1]
    .split('if (isPhotoOnlyCommand)')[0]

  assert.match(menu, /title: '2\. Pilih satu foto untuk dijadikan video'/)
  assert.match(menu, /id: usedPrefix \+ 'ttfotopilih ' \+ url/)
  assert.match(menu, /title: '3\. Semua foto → video'/)
  assert.match(selectedMenu, /images\.map\(\(_image, index\) => index\)/)
  assert.doesNotMatch(selectedMenu, /filter\(index => Boolean\(liveVideos\[index\]\)\)/)
  // Still photos are no longer refused: every row offers video, with the
  // still-photo rows honestly labelled as a zoom effect, not Live Photo.
  assert.match(selectedMenu, /efek zoom/)
  assert.match(slideshow, /res\.liveVideos\?\.\[0\]/)
  assert.match(custom, /res\.liveVideos\?\.\[0\]/)
  assert.match(selected, /res\.liveVideos\?\.\[photoIndex - 1\]/)
  assert.match(selected, /sendTikTokSinglePhotoVideo/)
  assert.match(selected, /imageUrl: res\.images\[photoIndex - 1\]/)
  assert.match(slideshow, /imageUrl: res\.images\[0\]/)
  assert.match(custom, /imageUrl: res\.images\[0\]/)
  assert.doesNotMatch(plugin, /tidak akan membuat video statis/)
  assert.doesNotMatch(plugin, /tidak memiliki klip gerak Live Photo asli\. Bot hanya menemukan gambar diam/)
  assert.doesNotMatch(plugin, /tidak memiliki klip gerak Live Photo asli\. Pilih foto yang ditandai Live Photo/)
  assert.doesNotMatch(plugin, /renderSinglePhotoWithMusic/)
})

test('TikTok downloads send caption-free MP4s and a single menu for the initial result', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  const download = plugin.split('const fileName = safeFilename(title + (isQualityCommand')[1]
    .split('} else if (!res.audio)')[0]
  const [sendMedia, sendMenu] = download.split('if (!isQualityCommand && prepared.sourceInfo)')
  assert.match(sendMedia, /document: prepared\.buffer/)
  assert.match(sendMedia, /video: prepared\.buffer/)
  assert.doesNotMatch(sendMedia, /caption\s*:/)
  assert.doesNotMatch(download, /sendTikTokCaptionCopyButton/)
  assert.match(sendMenu, /sendTikTokVideoQualityMenu[\s\S]*caption: res\.caption/)
  assert.match(plugin, /const buttons = buildTikTokVideoMenuButtons\(menuOptions\)[\s\S]*nativeFlow: buttons/)
})


test('TikTok provider fallback preserves canonical video links when TikWM has no media data', () => {
  const url = 'https://www.tiktok.com/@creator/video/1234567890123456789?lang=en'
  const result = buildTikTokProviderFallback(url)

  assert.equal(result.type, 'video')
  assert.equal(result.isPhotoPost, false)
  assert.equal(result.videoId, '1234567890123456789')
  assert.equal(result.sourceUrl, url)
  assert.deepEqual(result.videoCandidates, [])
  assert.equal(result.providerFallback, true)
})

test('TikTok provider fallback marks canonical photo links as photos, never video candidates', () => {
  const result = buildTikTokProviderFallback('https://www.tiktok.com/@creator/photo/1234567890123456789')

  assert.equal(result.type, 'image')
  assert.equal(result.isPhotoPost, true)
  assert.equal(result.video, null)
  assert.deepEqual(result.videoCandidates, [])
  assert.deepEqual(result.images, [])
})

test('TikTok provider fallback rejects unresolved short links and non-TikTok URLs', () => {
  assert.equal(buildTikTokProviderFallback('https://vt.tiktok.com/ZSptkEoRP/'), null)
  assert.equal(buildTikTokProviderFallback('https://example.com/video/1234567890123456789'), null)
})

test('TikTok plugin dispatches metadata-only provider fallback and protects photo posts', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  assert.match(plugin, /res\.providerFallback === true/)
  assert.match(plugin, /\(res\.isPhotoPost \|\| res\.type === 'image'\) && !hasPhotoPost/)
})

test('Ken Burns still-photo render actually moves (frames differ over time)', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) {
    t.skip('ffmpeg is not installed')
    return
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tiktok-kenburns-test-'))
  try {
    const still = path.join(dir, 'still.jpg')
    const out = path.join(dir, 'out.mp4')
    const makeStill = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=720x1280:rate=30',
      '-frames:v', '1', still
    ], { stdio: 'ignore' })
    assert.equal(makeStill.status, 0, 'test still image must be created')

    const duration = 5
    const totalFrames = duration * 30
    const render = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', '30', '-t', String(duration), '-i', still,
      '-vf', 'scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,' +
        "zoompan=z='1+0.15*on/" + totalFrames + "':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-an', '-movflags', '+faststart', out
    ], { stdio: 'ignore' })
    assert.equal(render.status, 0, 'Ken Burns render must succeed')

    const frames = []
    for (const at of ['0.5', '2.5', '4.5']) {
      const frame = path.join(dir, 'frame-' + at + '.png')
      const grab = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', at, '-i', out, '-frames:v', '1', frame
      ], { stdio: 'ignore' })
      assert.equal(grab.status, 0, 'frame at ' + at + 's must be extractable')
      frames.push(await readFile(frame))
    }
    assert.ok(!frames[0].equals(frames[1]), 'frames at 0.5s and 2.5s must differ (video moves)')
    assert.ok(!frames[1].equals(frames[2]), 'frames at 2.5s and 4.5s must differ (video keeps moving)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Motion check method: a one-frame video scores ~0, a moving video scores >1', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) {
    t.skip('ffmpeg is not installed')
    return
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tiktok-motion-check-test-'))
  const meanAbsDiff = async (video, firstAt, secondAt) => {
    const frames = []
    for (const at of [firstAt, secondAt]) {
      const frame = path.join(dir, 'frame-' + at + '.raw')
      assert.equal(spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', at, '-i', video, '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame
      ], { stdio: 'ignore' }).status, 0)
      frames.push(await readFile(frame))
    }
    assert.equal(frames[0].length, frames[1].length)
    let total = 0
    for (let index = 0; index < frames[0].length; index++) {
      total += Math.abs(frames[0][index] - frames[1][index])
    }
    return total / frames[0].length
  }
  try {
    const still = path.join(dir, 'still.jpg')
    const held = path.join(dir, 'still-video.mp4')
    assert.equal(spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=720x1280:rate=30',
      '-frames:v', '1', still
    ], { stdio: 'ignore' }).status, 0)
    // One JPEG frame held for 3 seconds: a valid MP4 that never moves.
    // This is the class of source the old code sent as "Live Photo".
    assert.equal(spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', '30', '-t', '3', '-i', still,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', held
    ], { stdio: 'ignore' }).status, 0)

    const heldScore = await meanAbsDiff(held, '0.6', '2.1')
    assert.ok(heldScore < 1.0, 'held still video must score below the motion threshold, got ' + heldScore)

    const moving = path.join(dir, 'moving.mp4')
    assert.equal(spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=720x1280:rate=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', moving
    ], { stdio: 'ignore' }).status, 0)
    const movingScore = await meanAbsDiff(moving, '0.5', '2.5')
    assert.ok(movingScore >= 1.0, 'moving video must score at or above the motion threshold, got ' + movingScore)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
