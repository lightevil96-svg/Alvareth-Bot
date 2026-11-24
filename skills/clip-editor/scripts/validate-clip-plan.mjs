#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCORE_MAX = Object.freeze({
  hook: 20,
  payoff: 20,
  context: 15,
  emotion: 15,
  clarity: 10,
  audio: 10,
  visual: 5,
  originality: 5
})

const PLATFORMS = new Set([
  'youtube-shorts', 'tiktok', 'instagram-reels', 'facebook-reels', 'generic'
])
const RIGHTS = new Set([
  'original', 'licensed', 'permission_granted', 'public_domain', 'unknown', 'review_required'
])
const EVIDENCE = new Set([
  'transcript', 'scene', 'highlight', 'speaker', 'visual_observation', 'manual_review'
])
const RATIOS = new Set(['9:16', '16:9', '1:1', '4:5'])

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function ratioValue(value) {
  const match = String(value || '').match(/^(\d+):(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return height > 0 ? width / height : null
}

export function validateClipPlan(plan, options = {}) {
  const errors = []
  const warnings = []
  const error = message => errors.push(message)
  const warn = message => warnings.push(message)

  if (!isRecord(plan)) {
    return { valid: false, errors: ['Plan harus berupa satu objek JSON.'], warnings }
  }

  if (plan.schema_version !== '1.0') error('schema_version harus "1.0".')

  const project = plan.project
  if (!isRecord(project)) {
    error('project wajib berupa objek.')
  } else {
    if (typeof project.title !== 'string' || !project.title.trim()) error('project.title wajib diisi.')
    if (!PLATFORMS.has(project.target_platform)) error('project.target_platform tidak didukung.')
    if (typeof project.language !== 'string' || !project.language.trim()) error('project.language wajib diisi.')
  }

  const source = plan.source
  let sourceDuration = Number(options.sourceDuration)
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    sourceDuration = isRecord(source) ? Number(source.duration_seconds) : NaN
  }
  if (!isRecord(source)) {
    error('source wajib berupa objek.')
  } else {
    if (typeof source.file_name !== 'string' || !source.file_name.trim()) error('source.file_name wajib diisi.')
    if (!finite(source.duration_seconds) || source.duration_seconds <= 0) error('source.duration_seconds harus lebih besar dari 0.')
    if (source.sha256 !== undefined && !/^[a-fA-F0-9]{64}$/.test(String(source.sha256))) {
      error('source.sha256 harus berisi 64 karakter hex.')
    }
    if (finite(source.duration_seconds) && finite(sourceDuration) &&
        Math.abs(source.duration_seconds - sourceDuration) > 0.05) {
      warn('Durasi override berbeda dari source.duration_seconds; periksa apakah plan memakai source yang benar.')
    }
  }

  const rights = plan.rights
  if (!isRecord(rights) || !RIGHTS.has(rights.status)) {
    error('rights.status harus salah satu status hak penggunaan yang didukung.')
  } else if (['unknown', 'review_required'].includes(rights.status)) {
    warn('Hak penggunaan belum jelas. Output hanya boleh menjadi draft privat sampai ditinjau.')
  }

  const output = plan.output
  if (!isRecord(output)) {
    error('output wajib berupa objek.')
  } else {
    if (!RATIOS.has(output.aspect_ratio)) error('output.aspect_ratio harus 9:16, 16:9, 1:1, atau 4:5.')
    if (!Number.isInteger(output.width) || output.width < 2) error('output.width harus integer >= 2.')
    if (!Number.isInteger(output.height) || output.height < 2) error('output.height harus integer >= 2.')
    if (!finite(output.fps) || output.fps < 1 || output.fps > 120) error('output.fps harus berada pada rentang 1–120.')
    for (const key of ['container', 'video_codec', 'audio_codec']) {
      if (typeof output[key] !== 'string' || !output[key].trim()) error('output.' + key + ' wajib diisi.')
    }
    const expectedRatio = ratioValue(output.aspect_ratio)
    if (expectedRatio && Number.isInteger(output.width) && Number.isInteger(output.height) && output.height > 0) {
      const actualRatio = output.width / output.height
      if (Math.abs(actualRatio - expectedRatio) > 0.015) {
        error('Dimensi output tidak sesuai dengan aspect_ratio yang dipilih.')
      }
    }
  }

  if (!Array.isArray(plan.clips) || plan.clips.length < 1 || plan.clips.length > 20) {
    error('clips harus berisi 1 sampai 20 item.')
    return { valid: errors.length === 0, errors, warnings }
  }

  const seenIds = new Set()
  let previousScore = Infinity
  for (let index = 0; index < plan.clips.length; index += 1) {
    const clip = plan.clips[index]
    const prefix = 'clips[' + index + ']'
    if (!isRecord(clip)) {
      error(prefix + ' harus berupa objek.')
      continue
    }

    if (typeof clip.id !== 'string' || !clip.id.trim()) {
      error(prefix + '.id wajib diisi.')
    } else if (seenIds.has(clip.id)) {
      error(prefix + '.id duplikat: ' + clip.id)
    } else {
      seenIds.add(clip.id)
    }
    for (const key of ['title', 'editorial_rationale', 'hook', 'setup', 'payoff']) {
      if (typeof clip[key] !== 'string' || (key !== 'setup' && !clip[key].trim())) {
        error(prefix + '.' + key + ' wajib berupa teks yang bermakna.')
      }
    }

    const start = clip.start_seconds
    const end = clip.end_seconds
    if (!finite(start) || start < 0) error(prefix + '.start_seconds harus angka >= 0.')
    if (!finite(end) || end <= 0) error(prefix + '.end_seconds harus angka > 0.')
    if (finite(start) && finite(end)) {
      const duration = end - start
      const minDuration = Number.isFinite(options.minClipSeconds) ? options.minClipSeconds : 3
      const maxDuration = Number.isFinite(options.maxClipSeconds) ? options.maxClipSeconds : 180
      if (duration <= 0) error(prefix + ' end_seconds harus lebih besar daripada start_seconds.')
      else if (duration < minDuration || duration > maxDuration) {
        error(prefix + ' durasi ' + duration.toFixed(2) + 's di luar rentang ' +
          minDuration + '–' + maxDuration + ' detik.')
      }
      if (finite(sourceDuration) && end > sourceDuration + 0.05) {
        error(prefix + ' end_seconds melewati durasi source.')
      }
    }

    if (!Number.isInteger(clip.score) || clip.score < 0 || clip.score > 100) {
      error(prefix + '.score harus integer 0–100.')
    }
    if (!isRecord(clip.score_breakdown)) {
      error(prefix + '.score_breakdown wajib berupa objek.')
    } else {
      let total = 0
      for (const [key, maximum] of Object.entries(SCORE_MAX)) {
        const value = clip.score_breakdown[key]
        if (!Number.isInteger(value) || value < 0 || value > maximum) {
          error(prefix + '.score_breakdown.' + key + ' harus integer 0–' + maximum + '.')
        } else {
          total += value
        }
      }
      if (Object.keys(clip.score_breakdown).some(key => !(key in SCORE_MAX))) {
        error(prefix + '.score_breakdown memiliki dimensi yang tidak dikenal.')
      }
      if (Number.isInteger(clip.score) && total !== clip.score) {
        error(prefix + '.score (' + clip.score + ') tidak sama dengan jumlah score_breakdown (' + total + ').')
      }
    }
    if (Number.isInteger(clip.score) && clip.score > previousScore) {
      warn('Urutan clips belum menurun berdasarkan score; urutkan kandidat terbaik lebih dahulu.')
    }
    if (Number.isInteger(clip.score)) previousScore = clip.score

    if (!Array.isArray(clip.evidence) || clip.evidence.length === 0) {
      error(prefix + '.evidence minimal harus memiliki satu bukti.')
    } else {
      for (let evidenceIndex = 0; evidenceIndex < clip.evidence.length; evidenceIndex += 1) {
        const item = clip.evidence[evidenceIndex]
        const evidencePrefix = prefix + '.evidence[' + evidenceIndex + ']'
        if (!isRecord(item)) {
          error(evidencePrefix + ' harus berupa objek.')
          continue
        }
        if (!EVIDENCE.has(item.kind)) error(evidencePrefix + '.kind tidak dikenal.')
        if (!finite(item.start_seconds) || !finite(item.end_seconds) ||
            item.start_seconds < 0 || item.end_seconds <= item.start_seconds) {
          error(evidencePrefix + ' memiliki rentang waktu yang tidak valid.')
        } else if (finite(start) && finite(end) &&
            (item.start_seconds < start - 0.05 || item.end_seconds > end + 0.05)) {
          error(evidencePrefix + ' berada di luar rentang klip.')
        }
        if (typeof item.note !== 'string' || !item.note.trim()) error(evidencePrefix + '.note wajib diisi.')
      }
    }

    const edit = clip.edit
    if (!isRecord(edit)) {
      error(prefix + '.edit wajib berupa objek.')
      continue
    }
    for (const key of ['framing', 'pacing', 'caption_preset']) {
      if (typeof edit[key] !== 'string' || !edit[key].trim()) error(prefix + '.edit.' + key + ' wajib diisi.')
    }
    if (!isRecord(edit.captions)) {
      error(prefix + '.edit.captions wajib berupa objek.')
    } else {
      if (typeof edit.captions.enabled !== 'boolean') error(prefix + '.edit.captions.enabled harus boolean.')
      if (typeof edit.captions.language !== 'string' || !edit.captions.language.trim()) {
        error(prefix + '.edit.captions.language wajib diisi.')
      }
      if (typeof edit.captions.source !== 'string' || !edit.captions.source.trim()) {
        error(prefix + '.edit.captions.source wajib diisi.')
      }
      if (!Number.isInteger(edit.captions.max_lines) || edit.captions.max_lines < 1 || edit.captions.max_lines > 2) {
        error(prefix + '.edit.captions.max_lines harus 1 atau 2.')
      }
      if (!finite(edit.captions.safe_margin_percent) ||
          edit.captions.safe_margin_percent < 5 || edit.captions.safe_margin_percent > 20) {
        error(prefix + '.edit.captions.safe_margin_percent harus 5–20%.')
      }
      if (edit.captions.word_level_timing === true && !/align|word/i.test(String(edit.captions.source))) {
        warn(prefix + ' meminta word-level timing; pastikan sumber benar-benar memiliki word alignment.')
      }
    }
    if (!isRecord(edit.audio)) {
      error(prefix + '.edit.audio wajib berupa objek.')
    } else {
      if (typeof edit.audio.keep_original !== 'boolean') error(prefix + '.edit.audio.keep_original harus boolean.')
      if (!['none', 'licensed', 'original', 'user_provided'].includes(edit.audio.music)) {
        error(prefix + '.edit.audio.music tidak valid.')
      }
    }
    if (!Array.isArray(edit.effects)) error(prefix + '.edit.effects harus berupa array.')
  }

  return { valid: errors.length === 0, errors, warnings }
}

async function runCli(args) {
  const file = args.find(value => !value.startsWith('--'))
  if (!file) {
    console.error('Usage: node validate-clip-plan.mjs <clip-plan.json> [--source-duration seconds]')
    return 2
  }
  const durationIndex = args.indexOf('--source-duration')
  const sourceDuration = durationIndex >= 0 ? Number(args[durationIndex + 1]) : undefined
  if (durationIndex >= 0 && (!Number.isFinite(sourceDuration) || sourceDuration <= 0)) {
    console.error('--source-duration harus berupa angka detik yang lebih besar dari 0.')
    return 2
  }

  try {
    const content = await fs.readFile(path.resolve(file), 'utf8')
    const plan = JSON.parse(content)
    const result = validateClipPlan(plan, { sourceDuration })
    for (const warning of result.warnings) console.warn('WARN: ' + warning)
    if (!result.valid) {
      for (const issue of result.errors) console.error('ERROR: ' + issue)
      console.error('Clip plan tidak valid.')
      return 1
    }
    console.log('OK: clip plan valid (' + plan.clips.length + ' clip).')
    return 0
  } catch (error) {
    console.error('Gagal membaca atau memvalidasi clip plan: ' + String(error?.message || error))
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runCli(process.argv.slice(2))
}
