import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getTikTokOutputQualities,
  getTikTokScaleFilter,
  parseTikTokSlideDurations
} from '../lib/tiktok-workflow.js'

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

test('single TikTok photo is looped for the original soundtrack without restarting the audio', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  const renderer = plugin
    .split('async function renderSinglePhotoWithMusic')[1]
    .split('async function renderTikTokPhotoSlideshow')[0]
  assert.match(renderer, /'-loop', '1'/)
  assert.match(renderer, /duration = Math\.min\(audioDuration, 60\)/)
  assert.match(renderer, /'-shortest'/)
  assert.doesNotMatch(renderer, /'-stream_loop', '-1', '-i', audioPath/)

  const sender = plugin
    .split('async function sendTikTokSinglePhotoVideo')[1]
    .split('async function sendTikTokPhotoAlbum')[0]
  assert.match(sender, /renderSinglePhotoWithMusic\(imageUrl, audioUrl, outputPath\)/)
  assert.match(sender, /Foto diulang terus selama musik diputar/)
  assert.match(sender, /Musik asli diputar terus tanpa restart/)
})

test('single-photo TikTok posts and selected photos use the same looping video renderer', async () => {
  const plugin = await readFile(new URL('../plugins/downloader/tiktok.js', import.meta.url), 'utf8')
  const menu = plugin
    .split('async function sendTikTokPhotoPostMenu')[1]
    .split('async function sendTikTokSlideshowDurationMenu')[0]
  const slideshow = plugin
    .split('if (isSlideshowCommand)')[1]
    .split('if (isSlideshowCustomCommand)')[0]
  const custom = plugin
    .split('if (isSlideshowCustomCommand)')[1]
    .split('let targetQuality = null')[0]
  const selected = plugin
    .split('if (isPhotoToVideoCommand)')[1]
    .split('if (isPhotoOnlyCommand)')[0]
  assert.match(menu, /images\.length === 1 \? '2\. Foto → video loop'/)
  assert.match(menu, /ttfoto2video/)
  assert.match(slideshow, /res\.images\.length === 1[\s\S]*sendTikTokSinglePhotoVideo/)
  assert.match(custom, /res\.images\.length === 1[\s\S]*sendTikTokSinglePhotoVideo/)
  assert.match(selected, /sendTikTokSinglePhotoVideo/)
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
