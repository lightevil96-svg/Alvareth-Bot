import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, stat, symlink, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { promisify } from 'node:util'
import WebSocket, { WebSocketServer } from 'ws'
import {
  parseHtmlTemplateManifest,
  findHtmlTemplate,
  findRenderBrowser,
  buildHtmlTemplateFfmpegArgs,
  renderHtmlTemplate,
  CdpClient,
  ensureChromeSharedLibraries,
  detectLinuxPackageArchive,
  parseDebianPackagesIndex,
  parseLddMissingLibraries,
  parseLoaderMissingLibrary,
  extractDeb
} from '../lib/html-template-render.js'

const execFileAsync = promisify(execFile)
const HAS_AR_TAR = spawnSync('ar', ['--version']).status === 0 &&
  spawnSync('tar', ['--version']).status === 0
const HAS_DPKG_DEB = spawnSync('dpkg-deb', ['--version']).status === 0
const REAL_LIBATK_LINK = '/lib/x86_64-linux-gnu/libatk-1.0.so.0'

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
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, audioFile: '../lagu.mp3' }), /tidak boleh keluar/)
  assert.throws(() => parseHtmlTemplateManifest('bukan json'), /bukan JSON/)
  assert.throws(() => parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, id: 'bad id!' }), /id template/)
})

test('parseHtmlTemplateManifest fills missing photo descriptions with defaults instead of rejecting', () => {
  // Regression for the live failure 2026-11-27: a template with
  // requiredPhotos 6 but fewer descriptions was refused outright
  // ("photoDescriptions harus berisi tepat 6 deskripsi foto"). The
  // descriptions are only the labels the bot shows when asking for photos,
  // so incomplete ones are padded with "Foto #N", extras are dropped, and
  // empty/over-long/non-string entries fall back to the default label.
  const short = parseHtmlTemplateManifest({
    ...FIXTURE_MANIFEST,
    requiredPhotos: 6,
    photoDescriptions: ['Sampul', 'Kartu A']
  })
  assert.deepEqual(short.photoDescriptions, [
    'Sampul', 'Kartu A', 'Foto #3', 'Foto #4', 'Foto #5', 'Foto #6'
  ])

  const missing = parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, requiredPhotos: 2, photoDescriptions: undefined })
  assert.deepEqual(missing.photoDescriptions, ['Foto #1', 'Foto #2'])

  const messy = parseHtmlTemplateManifest({
    ...FIXTURE_MANIFEST,
    requiredPhotos: 2,
    photoDescriptions: ['', 'x'.repeat(201), 'Kelebihan']
  })
  assert.deepEqual(messy.photoDescriptions, ['Foto #1', 'Foto #2'])

  const none = parseHtmlTemplateManifest({ ...FIXTURE_MANIFEST, requiredPhotos: 0, photoDescriptions: ['abaikan'] })
  assert.deepEqual(none.photoDescriptions, [])
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

test('CdpClient berbicara CDP lewat paket ws tanpa WebSocket global', async t => {
  // Regression for the live failure 2026-11-27: the panel runs Node.js older
  // than 22, so the global WebSocket client did not exist and the render
  // failed before Chromium even started. The transport now uses the `ws`
  // package (already a direct dependency). This test proves the request /
  // response + event flow over a fake CDP server, with no global WebSocket
  // involved at all.
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  t.after(() => server.close())
  await new Promise(resolve => server.once('listening', resolve))
  const port = server.address().port
  server.on('connection', socket => {
    socket.on('message', raw => {
      const request = JSON.parse(String(raw))
      socket.send(JSON.stringify({ id: request.id, result: { ok: true, method: request.method } }))
      socket.send(JSON.stringify({ method: 'Page.loadEventFired', params: {} }))
    })
  })

  const socket = new WebSocket('ws://127.0.0.1:' + port)
  t.after(() => { try { socket.close() } catch {} })
  await new Promise((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('gagal terhubung ke server CDP palsu'))
  })
  const cdp = new CdpClient(socket)
  const result = await cdp.send('Runtime.evaluate', { expression: '1+1' })
  assert.equal(result.ok, true)
  assert.equal(result.method, 'Runtime.evaluate')
  const event = await cdp.waitEvent('Page.loadEventFired', 5000)
  assert.equal(event.method, 'Page.loadEventFired')
})

// --- System shared libraries for Chromium (live failure 2026-11-27:
// chrome-headless-shell exited 127 on the panel because libatk-1.0.so.0
// does not exist in the container) ---

test('parseDebianPackagesIndex reads Filename + SHA256 and ignores continuation lines', () => {
  const index = parseDebianPackagesIndex([
    'Package: libatk1.0-0',
    'Version: 2.48.4-1',
    'Filename: pool/main/liba/libatk1.0-0/libatk1.0-0_2.48.4-1_amd64.deb',
    'SHA256: ' + 'a'.repeat(64),
    'Description: ATK accessibility toolkit',
    ' This continuation line mentions Filename: pool/evil/x.deb',
    ' and must not be mistaken for a field.',
    '',
    'Package: libglib2.0-0',
    'Version: 2.74.6-2',
    'Filename: pool/main/g/glib2.0/libglib2.0-0_2.74.6-2_amd64.deb',
    ''
  ].join('\n'))
  assert.equal(index.size, 2)
  assert.equal(index.get('libatk1.0-0').filename, 'pool/main/liba/libatk1.0-0/libatk1.0-0_2.48.4-1_amd64.deb')
  assert.equal(index.get('libatk1.0-0').sha256, 'a'.repeat(64))
  assert.equal(index.get('libatk1.0-0').version, '2.48.4-1')
  assert.equal(index.get('libglib2.0-0').sha256, null)
})

test('detectLinuxPackageArchive picks Debian/Ubuntu suites and defaults to bookworm', () => {
  assert.deepEqual(detectLinuxPackageArchive('ID=debian\nVERSION_ID="12"\n'), {
    base: 'https://deb.debian.org/debian', suite: 'bookworm', kind: 'debian'
  })
  assert.deepEqual(detectLinuxPackageArchive('ID=debian\nVERSION_ID="11"\n'), {
    base: 'https://deb.debian.org/debian', suite: 'bullseye', kind: 'debian'
  })
  assert.deepEqual(detectLinuxPackageArchive('ID=ubuntu\nVERSION_ID="22.04"\n'), {
    base: 'https://archive.ubuntu.com/ubuntu', suite: 'jammy', kind: 'ubuntu'
  })
  assert.deepEqual(detectLinuxPackageArchive('ID=ubuntu\nVERSION_ID="24.04"\n'), {
    base: 'https://archive.ubuntu.com/ubuntu', suite: 'noble', kind: 'ubuntu'
  })
  assert.deepEqual(detectLinuxPackageArchive('ID=arch\n'), {
    base: 'https://deb.debian.org/debian', suite: 'bookworm', kind: 'debian'
  })
  assert.deepEqual(detectLinuxPackageArchive(''), {
    base: 'https://deb.debian.org/debian', suite: 'bookworm', kind: 'debian'
  })
})

test('parseLddMissingLibraries and parseLoaderMissingLibrary read loader output', () => {
  assert.deepEqual(parseLddMissingLibraries([
    '	linux-vdso.so.1 (0x00007fff00000000)',
    '	libatk-1.0.so.0 => not found',
    '	libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f0000000000)',
    '	libatk-bridge-2.0.so.0 => not found',
    '	libatk-1.0.so.0 => not found',
    ''
  ].join('\n')), ['libatk-1.0.so.0', 'libatk-bridge-2.0.so.0'])
  assert.equal(parseLoaderMissingLibrary(
    '/home/container/.alvareth-bot-data/render-browser/chrome-headless-shell/linux-158.0.8127.88/chrome-headless-shell-linux64/chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory\n'),
    'libatk-1.0.so.0')
  assert.equal(parseLoaderMissingLibrary('some other error'), '')
})

async function buildSyntheticDeb(t, { packageName, version, files }) {
  const work = await mkdtemp(path.join(tmpdir(), 'alvareth-deb-build-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  const root = path.join(work, 'root')
  await mkdir(root, { recursive: true })
  for (const file of files) {
    const target = path.join(root, file.path)
    await mkdir(path.dirname(target), { recursive: true })
    if (file.symlinkTo) await symlink(file.symlinkTo, target)
    else await writeFile(target, file.content)
  }
  const controlDir = path.join(work, 'control')
  await mkdir(controlDir, { recursive: true })
  await writeFile(path.join(controlDir, 'control'),
    'Package: ' + packageName + '\nVersion: ' + version + '\nArchitecture: amd64\n' +
    'Maintainer: test <test@example.invalid>\nDescription: synthetic test package\n')
  await writeFile(path.join(work, 'debian-binary'), '2.0\n')
  await execFileAsync('tar', ['-czf', path.join(work, 'control.tar.gz'), '-C', controlDir, '.'])
  await execFileAsync('tar', ['-cJf', path.join(work, 'data.tar.xz'), '-C', root, '.'])
  const debPath = path.join(work, packageName + '.deb')
  await execFileAsync('ar', ['rcs', debPath,
    path.join(work, 'debian-binary'),
    path.join(work, 'control.tar.gz'),
    path.join(work, 'data.tar.xz')], { cwd: work })
  return { debPath, bytes: await readFile(debPath) }
}

async function startPackageServer(t, { indexText, debs }) {
  const indexGz = gzipSync(Buffer.from(indexText, 'utf8'))
  const hits = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    hits.push(url.pathname)
    if (url.pathname === '/dists/bookworm/main/binary-amd64/Packages.gz') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(indexGz)
      return
    }
    const deb = debs[url.pathname]
    if (deb) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(deb)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  t.after(() => server.close())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { base: 'http://127.0.0.1:' + server.address().port, hits }
}

async function writeFakeLdd(t, directory) {
  const fake = path.join(directory, 'ldd')
  await writeFile(fake, [
    '#!/bin/sh',
    'FOUND=0',
    'OLD_IFS="$IFS"; IFS=":"',
    'for d in $LD_LIBRARY_PATH; do',
    '  if [ -n "$d" ] && [ -e "$d/libatk-1.0.so.0" ]; then FOUND=1; break; fi',
    'done',
    'IFS="$OLD_IFS"',
    'if [ "$FOUND" = "1" ]; then',
    '  echo "	libatk-1.0.so.0 => /fake/libs/libatk-1.0.so.0 (0x00007f0000000000)"',
    'else',
    '  echo "	libatk-1.0.so.0 => not found"',
    'fi',
    'echo "	libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f0000000000)"',
    'exit 0',
    ''
  ].join('\n'))
  await chmod(fake, 0o755)
  return fake
}

test('extractDeb extracts a synthetic .deb', { skip: !HAS_AR_TAR }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-deb-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { debPath } = await buildSyntheticDeb(t, {
    packageName: 'libatk1.0-0',
    version: '2.48.4-1',
    files: [
      { path: 'usr/lib/x86_64-linux-gnu/libatk-1.0.so.0.248.4', content: 'fake-libatk' },
      { path: 'usr/lib/x86_64-linux-gnu/libatk-1.0.so.0', symlinkTo: 'libatk-1.0.so.0.248.4' }
    ]
  })
  const dest = path.join(directory, 'extracted')
  const method = await extractDeb(debPath, dest, { env: process.env })
  assert.ok(method === 'dpkg-deb' || method === 'ar+tar', 'unexpected extractor: ' + method)
  assert.equal(await readFile(path.join(dest, 'usr/lib/x86_64-linux-gnu/libatk-1.0.so.0.248.4'), 'utf8'), 'fake-libatk')
  assert.equal(await readlink(path.join(dest, 'usr/lib/x86_64-linux-gnu/libatk-1.0.so.0')), 'libatk-1.0.so.0.248.4')
})

test('ensureChromeSharedLibraries installs a missing library from a local package server', {
  skip: !liveBrowser || !HAS_AR_TAR || !HAS_DPKG_DEB || !existsSync(REAL_LIBATK_LINK)
}, async t => {
  // Regression for the live failure 2026-11-27: the panel container has no
  // libatk, so chrome-headless-shell exited 127 before doing anything.
  // Here a fake `ldd` reports libatk as missing, a local HTTP server plays
  // the role of deb.debian.org, and the .deb carries the REAL system
  // libatk — afterwards the real loader must resolve libatk from the
  // installed libs dir.
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-libs-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const dataDir = path.join(directory, 'data')
  const osReleasePath = path.join(directory, 'os-release')
  await writeFile(osReleasePath, 'ID=debian\nVERSION_ID="12"\nNAME="Debian GNU/Linux"\n')

  const realTarget = await readlink(REAL_LIBATK_LINK)
  const realLib = await readFile(path.join(path.dirname(REAL_LIBATK_LINK), realTarget))
  const { bytes: debBytes } = await buildSyntheticDeb(t, {
    packageName: 'libatk1.0-0',
    version: '2.48.4-1',
    files: [
      { path: 'usr/lib/x86_64-linux-gnu/' + realTarget, content: realLib },
      { path: 'usr/lib/x86_64-linux-gnu/libatk-1.0.so.0', symlinkTo: realTarget }
    ]
  })
  const sha256 = createHash('sha256').update(debBytes).digest('hex')
  const debFilename = 'pool/main/liba/libatk1.0-0/libatk1.0-0_2.48.4-1_amd64.deb'
  const server = await startPackageServer(t, {
    indexText: [
      'Package: libatk1.0-0',
      'Version: 2.48.4-1',
      'Filename: ' + debFilename,
      'SHA256: ' + sha256,
      ''
    ].join('\n'),
    debs: { ['/' + debFilename]: debBytes }
  })
  const fakeLdd = await writeFakeLdd(t, directory)

  const result = await ensureChromeSharedLibraries(liveBrowser, {
    dataDir,
    archiveBase: server.base,
    lddCommand: fakeLdd,
    osReleasePath,
    onLog: () => {}
  })
  assert.deepEqual(result.installed, ['libatk-1.0.so.0'])
  assert.equal(result.needed, true)
  assert.ok(server.hits.includes('/dists/bookworm/main/binary-amd64/Packages.gz'))
  assert.ok(server.hits.includes('/' + debFilename))

  const libsDir = path.join(dataDir, 'render-browser', 'libs')
  assert.equal(result.libsDir, libsDir)
  const installedLib = await readFile(path.join(libsDir, 'libatk-1.0.so.0'))
  assert.ok(installedLib.equals(realLib), 'installed libatk must be the real library bytes')
  assert.equal(await readlink(path.join(libsDir, 'libatk-1.0.so.0')), realTarget)

  // The loader itself must now pick the installed copy over the system one.
  const { stdout } = await execFileAsync('ldd', [liveBrowser], {
    env: { ...process.env, LD_LIBRARY_PATH: result.ldLibraryPath }
  })
  const line = stdout.split('\n').find(item => item.includes('libatk-1.0.so.0'))
  assert.ok(line && line.includes(libsDir), 'ldd should resolve libatk from the libs dir, got: ' + String(line))
})

test('ensureChromeSharedLibraries is a no-op when nothing is missing', {
  skip: !liveBrowser
}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-libs-noop-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fakeLdd = path.join(directory, 'ldd')
  await writeFile(fakeLdd, '#!/bin/sh\necho "	libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f0000000000)"\nexit 0\n')
  await chmod(fakeLdd, 0o755)
  const osReleasePath = path.join(directory, 'os-release')
  await writeFile(osReleasePath, 'ID=debian\nVERSION_ID="12"\n')

  const result = await ensureChromeSharedLibraries(liveBrowser, {
    dataDir: path.join(directory, 'data'),
    lddCommand: fakeLdd,
    osReleasePath,
    onLog: () => {}
  })
  assert.deepEqual(result.installed, [])
  assert.equal(result.needed, false)
})

test('ensureChromeSharedLibraries falls back to the --version probe when ldd is unavailable', {
  skip: !HAS_AR_TAR
}, async t => {
  // The fake browser exits 127 with the exact loader error until the
  // library file exists in LD_LIBRARY_PATH; ldd is pointed at a path
  // that does not exist, so the probe loop must do the discovery.
  const directory = await mkdtemp(path.join(tmpdir(), 'alvareth-libs-probe-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fakeChrome = path.join(directory, 'chrome-headless-shell')
  await writeFile(fakeChrome, [
    '#!/bin/sh',
    'FOUND=0',
    'OLD_IFS="$IFS"; IFS=":"',
    'for d in $LD_LIBRARY_PATH; do',
    '  if [ -n "$d" ] && [ -e "$d/libatk-1.0.so.0" ]; then FOUND=1; break; fi',
    'done',
    'IFS="$OLD_IFS"',
    'if [ "$FOUND" = "1" ]; then echo "HeadlessChrome 158.0.8127.88"; exit 0; fi',
    'echo "fake-chrome: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory" >&2',
    'exit 127',
    ''
  ].join('\n'))
  await chmod(fakeChrome, 0o755)
  const osReleasePath = path.join(directory, 'os-release')
  await writeFile(osReleasePath, 'ID=debian\nVERSION_ID="12"\n')

  const { bytes: debBytes } = await buildSyntheticDeb(t, {
    packageName: 'libatk1.0-0',
    version: '2.48.4-1',
    files: [{ path: 'usr/lib/x86_64-linux-gnu/libatk-1.0.so.0', content: 'dummy-libatk' }]
  })
  const sha256 = createHash('sha256').update(debBytes).digest('hex')
  const debFilename = 'pool/main/liba/libatk1.0-0/libatk1.0-0_2.48.4-1_amd64.deb'
  const server = await startPackageServer(t, {
    indexText: [
      'Package: libatk1.0-0',
      'Version: 2.48.4-1',
      'Filename: ' + debFilename,
      'SHA256: ' + sha256,
      ''
    ].join('\n'),
    debs: { ['/' + debFilename]: debBytes }
  })

  const result = await ensureChromeSharedLibraries(fakeChrome, {
    dataDir: path.join(directory, 'data'),
    archiveBase: server.base,
    lddCommand: '/nonexistent/ldd',
    osReleasePath,
    onLog: () => {}
  })
  assert.deepEqual(result.installed, ['libatk-1.0.so.0'])
  assert.equal(result.needed, true)
  assert.equal(
    await readFile(path.join(result.libsDir, 'libatk-1.0.so.0'), 'utf8'), 'dummy-libatk')
})
