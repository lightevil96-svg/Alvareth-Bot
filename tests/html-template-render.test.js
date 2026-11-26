import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  parseHtmlTemplateManifest,
  findHtmlTemplate,
  findRenderBrowser,
  buildHtmlTemplateFfmpegArgs,
  renderHtmlTemplate
} from '../lib/html-template-render.js'

const UPLOADED_MANIFEST = {
  id: 'anna-yanami-lo-gueh-end',
  title: 'Lo Gueh End - Anna Yanami Kinetic Typography & JJ',
  entry: 'render.html',
  width: 1080,
  height: 1080,
  fps: 60,
  duration: 43.37,
  requiredPhotos: 4,
  photoDescriptions: [
    'Foto #1 (Utama / Cover lagu & Kartu Gueh 2403)',
    'Foto #2 (Kartu Ehh 1107 & Split Grid)',
    'Foto #3 (Kartu Ehh 0707 & IG Carousel)',
    'Foto #4 (Kartu Ehh :3 & Penutup JJ)'
  ],
  audioFile: null
}

const FIXTURE_HTML = [
  '<!DOCTYPE html><html><head><meta charset="utf-8">',
  '<style>html,body{margin:0;width:320px;height:320px;overflow:hidden}canvas{display:block;width:320px;height:320px}</style>',
  '</head><body><canvas id="c" width="320" height="320"></canvas><script>',
  'const ctx = document.getElementById("c").getContext("2d");',
  'var userPortraits = [null, null];',
  'window.renderFrameAt = function(t) {',
  '  ctx.fillStyle = t < 0.5 ? "#ff0000" : "#0000ff";',
  '  ctx.fillRect(0, 0, 320, 320);',
  '  const img = userPortraits[0];',
  '  if (img) ctx.drawImage(img, 0, 0, 320, 320);',
  '  ctx.fillStyle = "#ffffff"; ctx.font = "40px sans-serif";',
  '  ctx.fillText("t=" + t.toFixed(2), 20, 160);',
  '};',
  'window.setRenderPhotos = async function(srcs) {',
  '  await Promise.all(srcs.map((src, i) => new Promise(resolve => {',
  '    const im = new Image();',
  '    im.onload = () => { userPortraits[i] = im; resolve(); };',
  '    im.onerror = () => resolve();',
  '    im.src = src;',
  '  })));',
  '  renderFrameAt(0);',
  '};',
  'renderFrameAt(0);',
  '</script></body></html>',
  ''
].join('\n')

const FIXTURE_MANIFEST = {
  id: 'test-template',
  title: 'Template Tes',
  entry: 'render.html',
  width: 320,
  height: 320,
  fps: 10,
  duration: 1,
  requiredPhotos: 2,
  photoDescriptions: ['Foto #1 (merah)', 'Foto #2 (biru)'],
  audioFile: null
}

// 1x1 PNGs (red, blue) as photo fixtures.
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')
const BLUE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64')

test('parseHtmlTemplateManifest accepts the uploaded Anna Yanami manifest', () => {
  const manifest = parseHtmlTemplateManifest(UPLOADED_MANIFEST)
  assert.equal(manifest.id, 'anna-yanami-lo-gueh-end')
  assert.equal(manifest.width, 1080)
  assert.equal(manifest.height, 1080)
  assert.equal(manifest.fps, 60)
  assert.equal(manifest.duration, 43.37)
  assert.equal(manifest.totalFrames, 2602)
  assert.equal(manifest.requiredPhotos, 4)
  assert.equal(manifest.photoDescriptions.length, 4)
  assert.equal(manifest.audioFile, null)
})

test('parseHtmlTemplateManifest accepts a JSON string', () => {
  const manifest = parseHtmlTemplateManifest(JSON.stringify(FIXTURE_MANIFEST))
  assert.equal(manifest.id, 'test-template')
  assert.equal(manifest.totalFrames, 10)
})

test('parseHtmlTemplateManifest rejects bad entry, dimensions, fps, duration and photo counts', () => {
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, entry: '../evil.html' }), /tidak boleh keluar/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, entry: 'render.sh' }), /entry harus berupa file \.html/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, width: 0 }), /Lebar template/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, height: 5000 }), /Tinggi template/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, fps: 0 }), /FPS template/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, duration: 0 }), /durasi/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, duration: 301 }), /durasi/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, requiredPhotos: 13 }), /Jumlah foto/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, photoDescriptions: ['satu'] }), /tepat 2 deskripsi/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, audioFile: '../lagu.mp3' }), /tidak boleh keluar/)
  assert.throws(() => parseHtmlTemplateManifest('bukan json'), /bukan JSON/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, id: 'bad id!' }), /id template/)
})

test('findHtmlTemplate locates manifest + entry and rejects render.sh packages', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-template-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(FIXTURE_MANIFEST))
  await writeFile(path.join(directory, 'render.html'), FIXTURE_HTML)

  const found = await findHtmlTemplate(directory)
  assert.equal(found.manifest.id, 'test-template')
  assert.equal(found.entryPath, path.join(directory, 'render.html'))
  assert.equal(found.audioPath, null)

  await writeFile(path.join(directory, 'render.sh'), '#!/bin/bash\necho hi\n')
  await assert.rejects(findHtmlTemplate(directory), /render\.sh dan manifest\.json/)
})

test('findHtmlTemplate rejects a package without manifest or without render hooks', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-template-missing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(findHtmlTemplate(directory), /manifest\.json tidak ditemukan/)

  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(FIXTURE_MANIFEST))
  await writeFile(path.join(directory, 'render.html'), '<html><body>no hooks</body></html>')
  await assert.rejects(findHtmlTemplate(directory), /renderFrameAt.*setRenderPhotos/)
})

test('findRenderBrowser honors an explicit executable env var and rejects a bad one', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-browser-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fake = path.join(directory, 'chrome-headless-shell')
  await writeFile(fake, '#!/bin/sh\necho fake\n')
  await chmod(fake, 0o755)

  const found = await findRenderBrowser({
    env: { ...process.env, ALVARETH_RENDER_BROWSER_EXECUTABLE: fake, PATH: '' }
  })
  assert.equal(found, fake)

  await assert.rejects(
    findRenderBrowser({ env: { ...process.env, ALVARETH_RENDER_BROWSER_EXECUTABLE: '/tidak/ada/chrome' } }),
    /tidak ditemukan/
  )
  await assert.rejects(
    findRenderBrowser({ env: { ...process.env, ALVARETH_RENDER_BROWSER_EXECUTABLE: 'relative/chrome' } }),
    /path absolut/
  )
})

test('findRenderBrowser finds a browser on PATH', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-browser-path-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fake = path.join(directory, 'chromium')
  await writeFile(fake, '#!/bin/sh\necho fake\n')
  await chmod(fake, 0o755)

  const found = await findRenderBrowser({
    env: { ...process.env, PATH: directory, ALVARETH_RENDER_BROWSER_EXECUTABLE: '', ALVARETH_REMOTION_BROWSER_EXECUTABLE: '', CHROME_PATH: '', CHROMIUM_PATH: '' }
  })
  assert.equal(found, fake)
})

test('buildHtmlTemplateFfmpegArgs encodes highest-quality H.264 with and without audio', () => {
  const videoOnly = buildHtmlTemplateFfmpegArgs({ fps: 60, outputPath: '/tmp/out.mp4' })
  assert.deepEqual(videoOnly, [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-framerate', '60', '-i', 'pipe:0',
    '-map', '0:v:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-crf', '16', '-preset', 'slow', '-tune', 'animation',
    '-movflags', '+faststart', '/tmp/out.mp4'
  ])

  const withAudio = buildHtmlTemplateFfmpegArgs({ fps: 30, outputPath: '/tmp/out.mp4', audioPath: '/tmp/lagu.mp3' })
  assert.ok(withAudio.includes('-i'))
  assert.ok(withAudio.includes('/tmp/lagu.mp3'))
  assert.ok(withAudio.includes('-c:a'))
  assert.ok(withAudio.includes('aac'))
  assert.ok(withAudio.includes('-shortest'))
})

function probe(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,codec_name',
      '-show_entries', 'format=duration', '-of', 'json', filePath
    ], (error, stdout) => {
      if (error) return reject(error)
      resolve(JSON.parse(stdout))
    })
  })
}

const liveBrowser = String(process.env.ALVARETH_TEST_RENDER_BROWSER || '').trim()

test('renderHtmlTemplate renders a fixture template to MP4 at manifest size and fps', { skip: !liveBrowser }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-template-render-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const packageDirectory = path.join(directory, 'package')
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(path.join(packageDirectory, 'manifest.json'), JSON.stringify(FIXTURE_MANIFEST))
  await writeFile(path.join(packageDirectory, 'render.html'), FIXTURE_HTML)
  const photo1 = path.join(directory, 'photo-1.png')
  const photo2 = path.join(directory, 'photo-2.png')
  await writeFile(photo1, RED_PNG)
  await writeFile(photo2, BLUE_PNG)

  const outputPath = path.join(directory, 'render-result.mp4')
  const frames = []
  const result = await renderHtmlTemplate({
    browserExecutable: liveBrowser,
    packageDir: packageDirectory,
    entryPath: path.join(packageDirectory, 'render.html'),
    manifest: parseHtmlTemplateManifest(FIXTURE_MANIFEST),
    photoPaths: [photo1, photo2],
    outputPath,
    onProgress: value => frames.push(value.frame)
  })

  assert.equal(result.frames, 10)
  assert.equal(result.width, 320)
  assert.equal(result.height, 320)
  assert.equal(result.fps, 10)
  assert.ok(frames.length > 0)
  assert.ok(frames.at(-1) === 10)
  const info = await stat(outputPath)
  assert.ok(info.size > 1000, 'output MP4 should not be empty')

  const probeResult = await probe(outputPath)
  const stream = probeResult.streams.find(item => item.codec_name === 'h264')
  assert.ok(stream, 'output should contain an H.264 stream')
  assert.equal(stream.width, 320)
  assert.equal(stream.height, 320)
  assert.equal(stream.r_frame_rate, '10/1')
  assert.ok(Number(probeResult.format.duration) >= 0.9, 'duration should be about 1s, got ' + probeResult.format.duration)
  assert.ok(await readFile(outputPath).then(buffer => buffer.length > 0))
})
