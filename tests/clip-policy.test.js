import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
  assert.equal((clipPipeline.match(/\], 0, \(percent, line\) =>/g) || []).length, 5)
  assert.doesNotMatch(clipPipeline, /idleTimeoutMs\s*:/)
  assert.doesNotMatch(clipPipeline, /6\s*\*\s*60\s*\*\s*1000/)
  assert.match(clipPipeline, /ensureYtDlpPythonRunner\(0\)/)
  assert.match(clipPipeline, /ensureYtDlpBinary\(0\)/)
})

test('clip FFmpeg and Qbyte HTTP calls do not set application deadlines', () => {
  assert.match(youtubeSource, /function runClipFfmpeg\(args, timeoutMs = 0/)
  assert.equal((clipPipeline.match(/\], 0, (?:onProgress|\(percent, line\) =>)/g) || []).length, 5)
  assert.match(clipPipeline, /getYoutubeInfo\(normalizedUrl, 0\)/)
  assert.equal((clipPipeline.match(/}, 0\n        \)/g) || []).length, 2)
})
