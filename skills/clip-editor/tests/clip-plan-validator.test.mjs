import test from 'node:test'
import assert from 'node:assert/strict'
import { validateClipPlan } from '../scripts/validate-clip-plan.mjs'

function validPlan() {
  return {
    schema_version: '1.0',
    project: { title: 'Test', target_platform: 'youtube-shorts', language: 'id' },
    source: { file_name: 'source.mp4', duration_seconds: 180, sha256: 'a'.repeat(64) },
    rights: { status: 'permission_granted', notes: 'Test permission' },
    output: {
      aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30,
      container: 'mp4', video_codec: 'h264', pixel_format: 'yuv420p',
      audio_codec: 'aac', audio_sample_rate: 48000
    },
    clips: [{
      id: 'clip-001',
      title: 'Moment',
      start_seconds: 42,
      end_seconds: 68,
      score: 88,
      score_breakdown: {
        hook: 18, payoff: 18, context: 14, emotion: 13,
        clarity: 9, audio: 7, visual: 5, originality: 4
      },
      editorial_rationale: 'A complete and understandable moment.',
      hook: 'Opening hook',
      setup: 'Context',
      payoff: 'Reaction',
      evidence: [{
        kind: 'highlight', start_seconds: 48, end_seconds: 55,
        note: 'Observed candidate moment.'
      }],
      edit: {
        framing: 'vertical_9_16',
        pacing: 'Natural',
        caption_preset: 'clean',
        captions: {
          enabled: true, language: 'id', source: 'transcript.json',
          word_level_timing: false, max_lines: 2, safe_margin_percent: 10
        },
        audio: { keep_original: true, music: 'none', music_ducking_db: 18 },
        effects: []
      }
    }]
  }
}

test('accepts a valid clip plan with matching weighted score', () => {
  const result = validateClipPlan(validPlan())
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('rejects clip boundaries outside the source duration', () => {
  const plan = validPlan()
  plan.clips[0].end_seconds = 181
  plan.clips[0].evidence[0].end_seconds = 180.5
  const result = validateClipPlan(plan)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(message => message.includes('melewati durasi source')))
})

test('rejects duplicate clip IDs', () => {
  const plan = validPlan()
  plan.clips.push({ ...plan.clips[0] })
  const result = validateClipPlan(plan)
  assert.ok(result.errors.some(message => message.includes('id duplikat')))
})

test('rejects score totals that do not match the breakdown', () => {
  const plan = validPlan()
  plan.clips[0].score = 95
  const result = validateClipPlan(plan)
  assert.ok(result.errors.some(message => message.includes('tidak sama dengan jumlah score_breakdown')))
})

test('rejects output dimensions that do not match the declared aspect ratio', () => {
  const plan = validPlan()
  plan.output.width = 1920
  plan.output.height = 1080
  const result = validateClipPlan(plan)
  assert.ok(result.errors.some(message => message.includes('Dimensi output tidak sesuai')))
})

test('rejects evidence ranges outside the selected clip', () => {
  const plan = validPlan()
  plan.clips[0].evidence[0].start_seconds = 10
  const result = validateClipPlan(plan)
  assert.ok(result.errors.some(message => message.includes('berada di luar rentang klip')))
})

test('flags unclear usage rights without treating a private draft as malformed', () => {
  const plan = validPlan()
  plan.rights.status = 'unknown'
  const result = validateClipPlan(plan)
  assert.equal(result.valid, true)
  assert.ok(result.warnings.some(message => message.includes('draft privat')))
})

test('rejects plans without a clip', () => {
  const plan = validPlan()
  plan.clips = []
  const result = validateClipPlan(plan)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(message => message.includes('1 sampai 20')))
})

test('honours an explicit source-duration override', () => {
  const plan = validPlan()
  const result = validateClipPlan(plan, { sourceDuration: 50 })
  assert.ok(result.errors.some(message => message.includes('melewati durasi source')))
})
