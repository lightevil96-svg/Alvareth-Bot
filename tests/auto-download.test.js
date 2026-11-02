import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveAutoDownload,
  findAutoDownloadPrefix,
  claimAutoDownloadMessage,
  runAutoDownloadJob
} from '../lib/auto-download.js'

const supported = [
  ['https://vt.tiktok.com/ZSexample/', 'downloader/tiktok.js', 'tt'],
  ['https://www.tiktok.com/@example/video/123456789/', 'downloader/tiktok.js', 'tt'],
  ['https://www.tiktok.com/@example/photo/123456789', 'downloader/tiktok.js', 'tt'],
  ['https://www.instagram.com/reel/Cexample/', 'downloader/ig.js', 'ig'],
  ['https://www.instagram.com/p/Cexample/', 'downloader/ig.js', 'ig'],
  ['https://fb.watch/shortlink/', 'downloader/facebook.js', 'fb'],
  ['https://www.facebook.com/share/v/example/', 'downloader/facebook.js', 'fb'],
  ['https://x.com/example/status/123456789', 'downloader/twitter.js', 'twitter'],
  ['https://twitter.com/example/status/123456789', 'downloader/twitter.js', 'twitter'],
  ['https://youtu.be/abcdef12345', 'downloader/ytmp4.js', 'ytmp4'],
  ['https://www.youtube.com/watch?v=abcdef12345', 'downloader/ytmp4.js', 'ytmp4'],
  ['https://youtube.com/shorts/abcdef12345', 'downloader/ytmp4.js', 'ytmp4'],
  ['https://music.youtube.com/watch?v=abcdef12345', 'downloader/ytmp3.js', 'ytmp3'],
  ['https://pin.it/shortlink', 'downloader/pindl.js', 'pindl'],
  ['https://id.pinterest.com/pin/123456789/', 'downloader/pindl.js', 'pindl'],
  ['https://open.spotify.com/track/3M0lSi5WW79CXQamgSBIjx', 'downloader/spotify.js', 'spotify'],
  ['https://soundcloud.com/artist/song', 'downloader/soundcloud.js', 'scdl'],
  ['https://on.soundcloud.com/shortlink', 'downloader/soundcloud.js', 'scdl'],
  ['https://www.capcut.com/tv2/example/', 'downloader/capcut.js', 'capcut'],
  ['https://www.mediafire.com/file/id/name.zip/file', 'downloader/mediafire.js', 'mediafire'],
  ['https://sfile.co/id123', 'downloader/sfile.js', 'sfiledl'],
  ['https://github.com/example/repo', 'downloader/gitclone.js', 'gitclone']
]

for (const [url, plugin, command] of supported) {
  test('AutoDL detects ' + url, () => {
    const route = resolveAutoDownload(url)
    assert.equal(route?.plugin, plugin)
    assert.equal(route?.command, command)
    assert.match(route?.input || '', /^https:\/\//)
  })
}

test('YouTube video uses medium resolution to avoid huge automatic downloads', () => {
  assert.match(resolveAutoDownload('https://youtu.be/abcdef12345').input, /\|720$/)
})
test('YouTube Music uses audio downloader', () => {
  assert.match(resolveAutoDownload('https://music.youtube.com/watch?v=abc123').input, /\|320$/)
})
test('Plain share captions around a single URL are supported', () => {
  const r = resolveAutoDownload('Coba lihat video ini: https://www.instagram.com/reel/ABC/?igsh=1')
  assert.equal(r?.plugin, 'downloader/ig.js')
})
test('Commands, multiple links and unsupported URLs do not auto-run', () => {
  for (const input of [
    '.tt https://vt.tiktok.com/shortlink',
    'https://youtu.be/abc https://youtu.be/def',
    'https://facebook.com.evil.example/videos/123',
    'https://www.instagram.com/profile',
    'https://youtube.com/playlist?list=xyz',
    'https://open.spotify.com/playlist/123',
    'https://github.com/lightevil96-svg/Alvareth-Bot',
    'https://x.com/someone',
    'https://localhost:9000/watch',
    'teks tanpa tautan'
  ]) assert.equal(resolveAutoDownload(input), null, input)
})
test('Prefix selection honors configured prefixes without regex state', () => {
  assert.equal(findAutoDownloadPrefix(/^[.!/#]/g), '.')
  assert.equal(findAutoDownloadPrefix('!'), '!')
  assert.equal(findAutoDownloadPrefix(['?', '#']), '?')
  assert.equal(findAutoDownloadPrefix(null), null)
})
test('Repeated WhatsApp message IDs are processed once', () => {
  const first = { chat: 'chat1', sender: 'user1', key: { id: 'message-123' } }
  assert.equal(claimAutoDownloadMessage(first), true)
  assert.equal(claimAutoDownloadMessage(first), false)
  assert.equal(claimAutoDownloadMessage({ ...first, key: { id: 'message-124' } }), true)
})
test('AutoDL limits concurrent jobs to two', async () => {
  let active = 0
  let maxActive = 0
  const jobs = Array.from({ length: 5 }, (_, i) => runAutoDownloadJob(async () => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return i
  }))
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4])
  assert.ok(maxActive <= 2)
})
