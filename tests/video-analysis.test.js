import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {
  buildAnalysisReport,
  buildEditorialBrief,
  buildSrt,
  createTranscriptArtifact,
  formatSrtTimestamp,
  isSafeCutroomUrl
} from '../lib/video-analysis.js'

test('formats SRT timestamps with millisecond precision', () => {
  assert.equal(formatSrtTimestamp(0), '00:00:00,000')
  assert.equal(formatSrtTimestamp(61.234), '00:01:01,234')
  assert.equal(formatSrtTimestamp(3661.999), '01:01:01,999')
})

test('groups word-level subtitle cues and preserves speaker boundaries', () => {
  const srt = buildSrt({
    words: [
      { start: 0.1, end: 0.4, text: 'Halo', speaker_id: 'S1' },
      { start: 0.45, end: 0.8, text: 'semua', speaker_id: 'S1' },
      { start: 1.2, end: 1.5, text: 'Hai', speaker_id: 'S2' }
    ]
  })
  assert.match(srt, /00:00:00,100 --> 00:00:00,800/)
  assert.match(srt, /\[S1\] Halo semua/)
  assert.match(srt, /\[S2\] Hai/)
  assert.equal((srt.match(/^\d+$/gm) || []).length, 2)
})

test('creates only segment-level draft subtitles when word alignment is absent', () => {
  const transcript = createTranscriptArtifact({
    sourceFile: 'episode.mp4',
    sourceSha256: 'a'.repeat(64),
    language: 'id',
    duration: 12,
    segments: [{ start: 1.25, end: 3.5, text: 'Halo semuanya', speaker_id: 'S1' }],
    speakers: [{ speaker_id: 'S1', mapping_status: 'UNKNOWN' }],
    asrModel: 'Gemini multimodal ASR'
  })
  assert.deepEqual(transcript.words, [])
  assert.equal(transcript.unresolved_words.length, 1)
  assert.equal(transcript.unresolved_words[0].raw_location, '1.250-3.500s')
  assert.equal(transcript.verification_policy, 'human-listen-required')
  assert.equal(transcript.unresolved_words[0].reason.includes('word-level alignment is unavailable'), true)
  const srt = buildSrt(transcript)
  assert.match(srt, /00:00:01,250 --> 00:00:03,500/)
  assert.match(srt, /Halo semuanya/)
})

test('marks every machine-aligned word ASR_RAW and keeps source provenance', () => {
  const transcript = createTranscriptArtifact({
    sourceFile: '/tmp/episode.mp4',
    sourceSha256: 'b'.repeat(64),
    language: 'ja',
    duration: 9,
    words: [
      { start: 0.2, end: 0.5, text: 'こんにちは', speaker_id: 'S1' },
      { start: 0.5, end: 0.8, text: '世界', speaker_id: 'S1' }
    ],
    speakers: [{
      speaker_id: 'S1',
      display_name: 'Face #2',
      avatar_ref: 'face-2',
      mapping_status: 'CANDIDATE',
      mapping_evidence: ['LR-ASD confidence 0.91; human confirmation required.']
    }],
    asrModel: 'Cutroom faster-whisper + pyannote'
  })
  assert.equal(transcript.source_file, 'episode.mp4')
  assert.equal(transcript.words.length, 2)
  assert.ok(transcript.words.every(word => word.verification_status === 'ASR_RAW'))
  assert.equal(transcript.words[0].language, 'ja')
  assert.equal(transcript.speakers[0].mapping_status, 'CANDIDATE')
  assert.equal(transcript.import_provenance.engine_run, 'PASS')
  assert.equal(transcript.import_provenance.source_association, 'LOCAL_RUN')
})

test('does not allow unsupported speaker verification states to pass through', () => {
  const transcript = createTranscriptArtifact({
    sourceFile: 'sample.mp4',
    speakers: [{ speaker_id: 'S1', mapping_status: 'AUTO_VERIFIED' }]
  })
  assert.equal(transcript.speakers[0].mapping_status, 'UNKNOWN')
})

test('allows local Cutroom hosts but blocks arbitrary remote URLs by default', () => {
  assert.equal(isSafeCutroomUrl('http://127.0.0.1:8000'), true)
  assert.equal(isSafeCutroomUrl('http://localhost:8000'), true)
  assert.equal(isSafeCutroomUrl('http://192.168.1.50:8000'), true)
  assert.equal(isSafeCutroomUrl('http://10.0.0.4:8000'), true)
  assert.equal(isSafeCutroomUrl('http://172.20.0.5:8000'), true)
  assert.equal(isSafeCutroomUrl('https://example.com'), false)
  assert.equal(isSafeCutroomUrl('https://example.com', true, false), false)
  assert.equal(isSafeCutroomUrl('https://example.com', true, true), true)
  assert.equal(isSafeCutroomUrl('http://127.0.0.1:8000?token=secret'), false)
})

test('analysis report and editorial handoff declare machine output limitations', () => {
  const result = {
    source: { file_name: 'sample.mp4', duration_seconds: 10, sha256: 'c'.repeat(64) },
    engine: { gemini_model: 'gemini-2.5-flash', cutroom_used: false, transcript_word_aligned: false },
    analysis: {
      summary: 'Dua orang sedang berbincang.',
      scenes: [{ start: 0, end: 5, description: 'Percakapan', visual_focus: 'Dua karakter', confidence: 'medium' }],
      highlights: [{ start: 2, end: 5, hook: 'Reaksi singkat', setup: 'Pertanyaan', payoff: 'Jawaban', confidence: 'low' }],
      editorial_recommendations: [],
      uncertainties: ['Nama karakter belum terlihat.']
    }
  }
  const report = buildAnalysisReport(result)
  const brief = buildEditorialBrief(result)
  assert.match(report, /ASR_RAW/)
  assert.match(report, /wajib diperiksa/)
  assert.match(brief, /Speaker IDs are provisional/)
  assert.match(report, /Reaksi singkat/)
})

test('WhatsApp plugin exposes owner-only private interactive analysis actions', async () => {
  const source = await fs.readFile(new URL('../plugins/owner/analisis.js', import.meta.url), 'utf8')
  assert.match(source, /handler\.command = \/\^analisis\$\/i/)
  assert.match(source, /handler\.rowner = true/)
  assert.match(source, /handler\.private = true/)
  assert.match(source, /rowId: prefix \+ 'analisis ' \+ action/)
  for (const action of ['full', 'transcript', 'speakers', 'characters', 'summary', 'highlights', 'scenes', 'export', 'status', 'cancel']) {
    assert.ok(source.includes("['" + action + "'"), 'menu action missing: ' + action)
  }
  assert.match(source, /buttonText: 'Buka fitur analisis'/)
  assert.match(source, /source_included: false/)
})

test('returns an empty SRT rather than inventing captions without timestamps', () => {
  assert.equal(buildSrt({ words: [], unresolved_words: [], segments: [] }), '')
})
