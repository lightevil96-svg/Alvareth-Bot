import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getTikTokOutputQualities,
  getTikTokScaleFilter,
  parseTikTokSlideDurations
} from '../lib/tiktok-workflow.js'
import { extractTikTokLivePhotoVideoUrl } from '../lib/tiktok-live-photo.js'

test('TikTok quality options are limited to source resolution and lower standard tiers', () => {
  assert.deepEqual(getTikTokOutputQualities(1080, 1920), [1080, 720, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(720, 1280), [720, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(576, 1024), [576, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(1920, 1080), [1080, 720, 480, 360])
  assert.deepEqual(getTikTokOutputQualities(0, 1080), [])
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
    { imageURL: { urlList: ['https://cdn.example/still-3.jpeg'] } }
  ]
  assert.deepEqual(images.map(extractTikTokLivePhotoVideoUrl), [liveVideo, null, null])
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

test('TikTok Live Photo actions only render photos that have an original motion clip', async () => {
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

  assert.match(menu, /images\.length === 1 && liveVideos\[0\]/)
  assert.match(menu, /Live Photo → video/)
  assert.match(selectedMenu, /filter\(index => Boolean\(liveVideos\[index\]\)\)/)
  assert.match(slideshow, /res\.liveVideos\?\.\[0\]/)
  assert.match(custom, /res\.liveVideos\?\.\[0\]/)
  assert.match(selected, /res\.liveVideos\?\.\[photoIndex - 1\]/)
  assert.match(selected, /sendTikTokSinglePhotoVideo/)
  assert.match(plugin, /tidak akan membuat video statis/)
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
