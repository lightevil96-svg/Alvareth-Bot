import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'

const execFileAsync = promisify(execFile)
const DEFAULT_MODEL = 'gemini-2.5-flash'
const MAX_ANALYSIS_TEXT = 12000

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, MAX_ANALYSIS_TEXT) : fallback
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function finiteTime(value, duration = null) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Number.isFinite(duration) && duration > 0 ? Math.min(number, duration) : number
}

function overlapSeconds(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

function optionalInteger(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

export function formatSrtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000))
  const hours = Math.floor(totalMs / 3600000)
  const minutes = Math.floor((totalMs % 3600000) / 60000)
  const wholeSeconds = Math.floor((totalMs % 60000) / 1000)
  const milliseconds = totalMs % 1000
  return String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(wholeSeconds).padStart(2, '0') + ',' +
    String(milliseconds).padStart(3, '0')
}

export function buildSrt(transcript) {
  const words = asArray(transcript?.words)
    .filter(item => Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end)) &&
      Number(item.end) > Number(item.start) && asText(item.text))
    .sort((a, b) => Number(a.start) - Number(b.start))

  const cues = []
  if (words.length) {
    let current = null
    for (const word of words) {
      const text = asText(word.text)
      const speaker = word.speaker_id || null
      const gap = current ? Number(word.start) - current.end : 0
      const speakerChanged = current && speaker && current.speaker && speaker !== current.speaker
      if (!current || gap > 0.8 || current.words.length >= 7 ||
          (current.text + ' ' + text).length > 42 || speakerChanged) {
        if (current) cues.push(current)
        current = {
          start: Number(word.start),
          end: Number(word.end),
          text,
          speaker,
          words: [word]
        }
      } else {
        current.end = Math.max(current.end, Number(word.end))
        current.text += ' ' + text
        current.words.push(word)
      }
    }
    if (current) cues.push(current)
  } else {
    for (const segment of asArray(transcript?.unresolved_words)) {
      const range = String(segment.raw_location || '').match(/([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)/)
      if (!range) continue
      cues.push({
        start: Number(range[1]),
        end: Number(range[2]),
        text: asText(segment.text),
        speaker: null
      })
    }
    if (!cues.length) {
      for (const segment of asArray(transcript?.segments)) {
        const start = Number(segment.start)
        const end = Number(segment.end)
        if (Number.isFinite(start) && Number.isFinite(end) && end > start && asText(segment.text)) {
          cues.push({ start, end, text: asText(segment.text), speaker: segment.speaker_id || null })
        }
      }
    }
  }

  return cues.map((cue, index) => {
    const label = cue.speaker ? '[' + cue.speaker + '] ' : ''
    return (index + 1) + '\n' + formatSrtTimestamp(cue.start) + ' --> ' +
      formatSrtTimestamp(cue.end) + '\n' + label + cue.text
  }).join('\n\n') + (cues.length ? '\n' : '')
}

export function isSafeCutroomUrl(value, allowRemote = false, hasToken = false) {
  let parsed
  try {
    parsed = new URL(String(value || ''))
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash) return false
  const host = parsed.hostname.toLowerCase()
  if (allowRemote) return Boolean(hasToken)
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const a = octets[0]
  const b = octets[1]
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
}

function makeSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 120000))
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function readJsonResponse(response, label) {
  const body = await response.text()
  let parsed
  try {
    parsed = body ? JSON.parse(body) : {}
  } catch {
    throw new Error(label + ' mengembalikan respons yang bukan JSON.')
  }
  if (!response.ok) {
    const message = parsed?.error?.message || parsed?.message || parsed?.detail || response.statusText
    throw new Error(label + ' gagal (HTTP ' + response.status + '): ' + String(message).slice(0, 500))
  }
  return parsed
}

function parseModelJson(text) {
  let source = String(text || '').trim()
  const fence = String.fromCharCode(96).repeat(3)
  if (source.startsWith(fence)) {
    source = source.slice(fence.length).replace(/^json\s*/i, '')
    const closing = source.lastIndexOf(fence)
    if (closing >= 0) source = source.slice(0, closing)
  }
  try {
    return JSON.parse(source)
  } catch {
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1))
    throw new Error('Model tidak mengembalikan JSON analisis yang valid.')
  }
}

async function uploadGeminiFile(buffer, fileName, mimeType, apiKey, signal) {
  const base = 'https://generativelanguage.googleapis.com'
  const start = await fetch(base + '/upload/v1beta/files?key=' + encodeURIComponent(apiKey), {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: fileName } }),
    signal: makeSignal(signal, 60000)
  })
  if (!start.ok) await readJsonResponse(start, 'Gemini Files API')
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini Files API tidak memberikan URL upload resumable.')

  const uploaded = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length)
    },
    body: buffer,
    signal: makeSignal(signal, 10 * 60 * 1000)
  })
  const result = await readJsonResponse(uploaded, 'Upload video Gemini')
  const file = result.file || result
  if (!file.name || !file.uri) throw new Error('Gemini tidak mengembalikan metadata file video.')
  return file
}

async function waitForGeminiFile(file, apiKey, signal, timeoutMs) {
  const startedAt = Date.now()
  let current = file
  while (current.state && current.state !== 'ACTIVE') {
    if (current.state === 'FAILED') throw new Error('Gemini gagal memproses file video yang diunggah.')
    if (Date.now() - startedAt > timeoutMs) throw new Error('Waktu tunggu pemrosesan file Gemini habis.')
    await sleep(2500, undefined, { signal })
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/' + current.name +
      '?key=' + encodeURIComponent(apiKey),
      { signal: makeSignal(signal, 30000) }
    )
    const data = await readJsonResponse(response, 'Pemeriksaan status file Gemini')
    current = data.file || data
  }
  return current
}

function sidecarEvidence(sidecar) {
  if (!sidecar) return 'Belum tersedia.'
  const turns = asArray(sidecar.turns).slice(0, 250).map(turn => ({
    speaker: turn.speaker,
    start: turn.start,
    end: turn.end,
    text: asText(turn.text, '').slice(0, 500)
  }))
  const people = asArray(sidecar.faces?.people).slice(0, 40).map(person => ({
    id: person.id,
    detectionCount: person.detectionCount,
    keyframes: asArray(person.keyframes).slice(0, 8).map(frame => ({ t: frame.t, bbox: frame.bbox }))
  }))
  const matches = asArray(sidecar.match?.matches).slice(0, 80)
  return JSON.stringify({ turns, people, matches }, null, 2).slice(0, 18000)
}

function buildPrompt(action, duration, sidecar) {
  const durationLine = Number.isFinite(duration) && duration > 0
    ? 'Durasi source sekitar ' + duration.toFixed(2) + ' detik.'
    : 'Durasi source belum berhasil dibaca.'
  return [
    'Analisis video berikut untuk workflow editorial Skills-Clip.',
    'Gunakan bahasa Indonesia untuk penjelasan. Pertahankan teks ucapan dalam bahasa aslinya.',
    durationLine,
    'Mode fokus: ' + String(action || 'full') + '.',
    'Periksa audio dan visual video yang benar-benar tersedia. Jangan mengarang dialog, identitas, emosi, atau timestamp.',
    'Timestamp harus dalam detik source asli. Jika tidak yakin, gunakan null dan jelaskan ketidakpastiannya.',
    'Transcript dari model tetap ASR_RAW. Jangan menyebutnya terverifikasi.',
    'Speaker diarization tidak sama dengan identitas karakter. Jangan menebak nama talent dari suara.',
    'Karakter hanya boleh diberi nama jika nama terlihat jelas pada video atau diberikan pengguna. Jika tidak, gunakan Character 1 dan UNKNOWN.',
    'Jangan menyimpulkan siapa yang berbicara hanya karena karakter terlihat di layar. Lip-sync atau pencocokan wajah harus memiliki bukti yang terlihat.',
    'Jika ada bukti diarization/face matching eksternal, gunakan sebagai kandidat saja dan jelaskan confidence serta batasnya.',
    'Data tambahan dari pipeline Cutroom, bila ada, adalah bukti kandidat dan bukan kebenaran final:',
    sidecarEvidence(sidecar),
    '',
    'Kembalikan SATU objek JSON valid dengan bentuk:',
    '{',
    ' "language": "id, ja, en, mixed, atau unknown",',
    ' "summary": "ringkasan singkat video",',
    ' "scenes": [{"start":0,"end":10,"description":"apa yang terlihat/terdengar","visual_focus":"subjek utama","confidence":"high|medium|low"}],',
    ' "speakers": [{"speaker_id":"S1","voice_description":"ciri suara yang terdengar","visual_person_id":null,"mapping_status":"UNKNOWN","evidence":"alasan atau unknown"}],',
    ' "characters": [{"character_id":"C1","description":"deskripsi visual yang dapat diamati","visible_label":null,"source_person_id":null,"mapping_status":"UNKNOWN","evidence":"bukti visual atau unknown"}],',
    ' "transcript_segments": [{"start":0,"end":2,"speaker_id":"S1","text":"ucapan asli","confidence":"low|medium|high","notes":null}],',
    ' "highlights": [{"start":0,"end":8,"hook":"alasan momen menarik","setup":"konteks","payoff":"hasil/reaction","confidence":"low|medium|high"}],',
    ' "editorial_recommendations": [{"start":0,"end":8,"reason":"alasan editorial","visual_focus":"fokus","suggested_treatment":"perlakuan sederhana","risk":"risiko atau unknown"}],',
    ' "uncertainties": ["hal yang belum dapat dipastikan"]',
    '}',
    'Batasi scenes maksimal 80, speakers maksimal 20, characters maksimal 30, transcript_segments maksimal 500, highlights maksimal 40, editorial_recommendations maksimal 40.',
    'Jangan membuat word-level timestamps. Transcript_segments adalah rentang kalimat/ucapan, bukan timestamp per kata.',
    'Jika bagian tidak tersedia, kembalikan array kosong atau null. Jangan mengisi dengan dugaan.'
  ].join('\n')
}

async function runGeminiAnalysis({ filePath, fileName, mimeType, apiKey, model, action, duration, sidecar, signal }) {
  const buffer = await fs.readFile(filePath)
  const file = await uploadGeminiFile(buffer, fileName, mimeType, apiKey, signal)
  try {
    const active = await waitForGeminiFile(
      file,
      apiKey,
      signal,
      Number(process.env.ALVARETH_VIDEO_ANALYSIS_FILE_TIMEOUT_MS) || 10 * 60 * 1000
    )
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model || DEFAULT_MODEL) + ':generateContent?key=' + encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { file_data: { mime_type: mimeType, file_uri: active.uri || file.uri } },
              { text: buildPrompt(action, duration, sidecar) }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 8192
          }
        }),
        signal: makeSignal(signal, Number(process.env.ALVARETH_VIDEO_ANALYSIS_TIMEOUT_MS) || 20 * 60 * 1000)
      }
    )
    const data = await readJsonResponse(response, 'Gemini video analysis')
    const text = asArray(data.candidates?.[0]?.content?.parts)
      .map(part => typeof part.text === 'string' ? part.text : '')
      .join('\n')
    if (!text) {
      const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || 'respons kosong'
      throw new Error('Gemini tidak menghasilkan analisis: ' + reason)
    }
    return parseModelJson(text)
  } finally {
    if (file.name) {
      await fetch(
        'https://generativelanguage.googleapis.com/v1beta/' + file.name +
        '?key=' + encodeURIComponent(apiKey),
        { method: 'DELETE', signal: makeSignal(null, 30000) }
      ).catch(error => console.warn('[ANALISIS] Penghapusan file Gemini gagal:', error?.message || error))
    }
  }
}

function privateCutroomHeaders(token) {
  const headers = {}
  if (token) headers.Authorization = 'Bearer ' + token
  return headers
}

async function runCutroomSidecar({ filePath, fileName, mimeType, signal, onProgress }) {
  const [{ default: axios }, { default: FormData }] = await Promise.all([
    import('axios'),
    import('form-data')
  ])
  const baseUrl = String(process.env.ALVARETH_CUTROOM_API_URL || '').trim().replace(/\/+$/, '')
  if (!baseUrl) return null
  const token = String(process.env.ALVARETH_CUTROOM_API_TOKEN || '').trim()
  const allowRemote = String(process.env.ALVARETH_CUTROOM_ALLOW_REMOTE || '').toLowerCase() === 'true'
  if (!isSafeCutroomUrl(baseUrl, allowRemote, Boolean(token))) {
    throw new Error('URL Cutroom ditolak. Default hanya localhost/IP privat; host remote memerlukan ALVARETH_CUTROOM_ALLOW_REMOTE=true dan token.')
  }

  const headers = privateCutroomHeaders(token)
  const form = new FormData()
  form.append('file', createReadStream(filePath), { filename: fileName, contentType: mimeType })
  const upload = await axios.post(baseUrl + '/process', form, {
    headers: { ...form.getHeaders(), ...headers },
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    signal
  })
  const jobId = String(upload.data?.jobId || '')
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(jobId)) throw new Error('Cutroom tidak mengembalikan jobId yang valid.')

  const timeoutMs = Number(process.env.ALVARETH_CUTROOM_TIMEOUT_MS) || 45 * 60 * 1000
  const startedAt = Date.now()
  let snapshot = null
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new Error('Analisis dibatalkan.')
    const response = await axios.get(baseUrl + '/progress/' + encodeURIComponent(jobId), {
      headers,
      timeout: 30000,
      signal
    })
    snapshot = response.data || {}
    if (snapshot.error) throw new Error('Cutroom gagal: ' + String(snapshot.error).slice(0, 500))
    if (typeof onProgress === 'function') {
      onProgress({
        transcribe: snapshot.transcribe?.stage || 'menunggu',
        faces: snapshot.faces?.stage || 'menunggu',
        match: snapshot.match?.stage || 'menunggu'
      })
    }
    if (snapshot.transcribe?.done && snapshot.faces?.done && snapshot.match?.done) break
    await sleep(4000, undefined, { signal })
  }
  if (!snapshot?.transcribe?.done || !snapshot?.faces?.done || !snapshot?.match?.done) {
    throw new Error('Waktu pemrosesan Cutroom habis. Job server dapat diperiksa dari dashboard Cutroom.')
  }
  const result = await axios.get(baseUrl + '/jobs/' + encodeURIComponent(jobId), {
    headers,
    timeout: 60000,
    signal
  })
  return { ...result.data, jobId }
}

export async function probeVideoDuration(filePath) {
  const binary = String(process.env.FFPROBE_BINARY || 'ffprobe').trim()
  try {
    const result = await execFileAsync(binary, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { timeout: 15000, maxBuffer: 1024 * 1024 })
    const duration = Number(String(result.stdout || '').trim())
    return Number.isFinite(duration) && duration > 0 ? duration : null
  } catch {
    return null
  }
}

function normalizeGeminiAnalysis(input, duration) {
  const cleanRange = item => {
    const start = finiteTime(item?.start, duration)
    const end = finiteTime(item?.end, duration)
    if (start === null || end === null || end <= start) return null
    return { ...item, start, end }
  }
  return {
    language: asText(input?.language, 'unknown').slice(0, 40),
    summary: asText(input?.summary, 'Ringkasan tidak tersedia.'),
    scenes: asArray(input?.scenes).map(cleanRange).filter(Boolean).slice(0, 80).map(item => ({
      start: item.start, end: item.end,
      description: asText(item.description),
      visual_focus: asText(item.visual_focus),
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low'
    })),
    speakers: asArray(input?.speakers).slice(0, 20).map((item, index) => ({
      speaker_id: asText(item?.speaker_id, 'S' + (index + 1)).slice(0, 40),
      voice_description: asText(item?.voice_description),
      visual_person_id: optionalInteger(item?.visual_person_id),
      mapping_status: 'UNKNOWN',
      evidence: asText(item?.evidence, 'Belum ada bukti cukup untuk menghubungkan suara dengan karakter.')
    })),
    characters: asArray(input?.characters).slice(0, 30).map((item, index) => ({
      character_id: asText(item?.character_id, 'C' + (index + 1)).slice(0, 40),
      description: asText(item?.description),
      visible_label: asText(item?.visible_label) || null,
      source_person_id: optionalInteger(item?.source_person_id),
      mapping_status: 'UNKNOWN',
      evidence: asText(item?.evidence, 'Identitas karakter belum terkonfirmasi.')
    })),
    transcript_segments: asArray(input?.transcript_segments).map(cleanRange).filter(Boolean).slice(0, 500).map(item => ({
      start: item.start,
      end: item.end,
      speaker_id: asText(item.speaker_id) || null,
      text: asText(item.text),
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low',
      notes: asText(item.notes) || null
    })).filter(item => item.text),
    highlights: asArray(input?.highlights).map(cleanRange).filter(Boolean).slice(0, 40).map(item => ({
      start: item.start, end: item.end,
      hook: asText(item.hook),
      setup: asText(item.setup),
      payoff: asText(item.payoff),
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low'
    })),
    editorial_recommendations: asArray(input?.editorial_recommendations).map(cleanRange).filter(Boolean).slice(0, 40).map(item => ({
      start: item.start, end: item.end,
      reason: asText(item.reason),
      visual_focus: asText(item.visual_focus),
      suggested_treatment: asText(item.suggested_treatment),
      risk: asText(item.risk)
    })),
    uncertainties: asArray(input?.uncertainties).map(value => asText(value)).filter(Boolean).slice(0, 80)
  }
}

function normalizeCutroom(sidecar, duration) {
  const turns = asArray(sidecar?.turns).map(item => {
    const start = finiteTime(item?.start, duration)
    const end = finiteTime(item?.end, duration)
    if (start === null || end === null || end <= start) return null
    return { start, end, speaker: asText(item.speaker) || null, text: asText(item.text) }
  }).filter(Boolean)
  const words = asArray(sidecar?.words).map(item => {
    const start = finiteTime(item?.start, duration)
    const end = finiteTime(item?.end, duration)
    if (start === null || end === null || end <= start || !asText(item.text)) return null
    return { start, end, text: asText(item.text) }
  }).filter(Boolean).map(word => {
    let bestSpeaker = null
    let bestOverlap = 0
    for (const turn of turns) {
      const overlap = overlapSeconds(word.start, word.end, turn.start, turn.end)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestSpeaker = turn.speaker
      }
    }
    return { ...word, speaker_id: bestOverlap > 0 ? bestSpeaker : null }
  })
  const ids = [...new Set(turns.map(turn => turn.speaker).filter(Boolean))]
  const matches = asArray(sidecar?.match?.matches)
  const speakers = ids.map(id => {
    const match = matches.find(item => String(item.speaker) === id)
    const confidence = Number(match?.confidence)
    const judgedSeconds = Number(match?.judged_seconds)
    const acceptedAsCandidate = Number.isFinite(confidence) && confidence >= 0.5 &&
      Number.isFinite(judgedSeconds) && judgedSeconds >= 1 && Number.isInteger(Number(match?.person_id))
    const personId = acceptedAsCandidate ? Number(match.person_id) : null
    return {
      speaker_id: id,
      display_name: personId === null ? id : 'Face #' + personId,
      avatar_ref: personId === null ? null : 'face-' + personId,
      mapping_status: acceptedAsCandidate ? 'CANDIDATE' : 'UNKNOWN',
      mapping_evidence: acceptedAsCandidate
        ? ['Cutroom LR-ASD candidate match, confidence ' + confidence.toFixed(3) +
          ', judged ' + judgedSeconds.toFixed(2) + ' seconds. Human confirmation required.']
        : []
    }
  })
  const faces = asArray(sidecar?.faces?.people).map(person => ({
    person_id: Number(person.id),
    detection_count: Number(person.detectionCount) || 0,
    keyframes: asArray(person.keyframes).slice(0, 500).map(frame => ({
      time: finiteTime(frame.t, duration),
      bbox: frame.bbox || null
    })).filter(frame => frame.time !== null)
  }))
  return {
    turns,
    words,
    speakers,
    faces,
    overlaps: asArray(sidecar?.overlapWindows).map(item => ({
      start: finiteTime(item.start, duration),
      end: finiteTime(item.end, duration),
      speakers: asArray(item.speakers).map(value => asText(value)).filter(Boolean)
    })).filter(item => item.start !== null && item.end !== null && item.end > item.start),
    matches: matches.slice(0, 100).map(item => ({
      speaker: asText(item.speaker),
      person_id: optionalInteger(item.person_id),
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
      judged_seconds: Number.isFinite(Number(item.judged_seconds)) ? Number(item.judged_seconds) : null
    }))
  }
}

export function createTranscriptArtifact({
  sourceFile,
  sourceSha256,
  language = 'unknown',
  duration = null,
  words = [],
  segments = [],
  speakers = [],
  asrModel = 'unknown'
}) {
  const normalizedWords = asArray(words).map((word, index) => ({
    start: Number(word.start),
    end: Number(word.end),
    text: asText(word.text),
    speaker_id: asText(word.speaker_id) || null,
    verification_status: 'ASR_RAW',
    id: 'w' + String(index + 1).padStart(6, '0'),
    language: asText(language, 'unknown')
  })).filter(word => Number.isFinite(word.start) && Number.isFinite(word.end) &&
    word.start >= 0 && word.end > word.start && word.text)

  const unresolved = normalizedWords.length ? [] : asArray(segments).map(segment => ({
    text: asText(segment.text),
    raw_location: Number.isFinite(Number(segment.start)) && Number.isFinite(Number(segment.end))
      ? Number(segment.start).toFixed(3) + '-' + Number(segment.end).toFixed(3) + 's'
      : 'timestamp unavailable',
    reason: 'Segment-level ASR only; word-level alignment is unavailable and requires source-audio review.'
  })).filter(item => item.text)

  const cleanSpeakers = asArray(speakers).map(item => ({
    speaker_id: asText(item.speaker_id),
    display_name: asText(item.display_name) || null,
    avatar_ref: asText(item.avatar_ref) || null,
    mapping_status: ['UNKNOWN', 'CANDIDATE', 'VERIFIED', 'USER_CONFIRMED'].includes(item.mapping_status)
      ? item.mapping_status : 'UNKNOWN',
    ...(asArray(item.mapping_evidence).length
      ? { mapping_evidence: asArray(item.mapping_evidence).map(value => asText(value)).filter(Boolean) }
      : {})
  })).filter(item => item.speaker_id)

  const result = {
    source_file: path.basename(String(sourceFile || 'video')),
    language: asText(language, 'unknown'),
    asr_model: asText(asrModel, 'unknown'),
    verification_policy: 'human-listen-required',
    speakers: cleanSpeakers,
    words: normalizedWords,
    source_sha256: /^[0-9a-f]{64}$/.test(String(sourceSha256 || '')) ? sourceSha256 : undefined,
    source_duration_s: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    unresolved_words: unresolved,
    import_provenance: /^[0-9a-f]{64}$/.test(String(sourceSha256 || ''))
      ? {
          raw_sha256: sourceSha256,
          source_offset_s: 0,
          source_association: 'LOCAL_RUN',
          engine_run: 'PASS'
        }
      : undefined
  }
  for (const key of Object.keys(result)) if (result[key] === undefined) delete result[key]
  return result
}

export async function analyzeVideoFile({
  filePath,
  fileName,
  mimeType = 'video/mp4',
  action = 'full',
  signal,
  onProgress
}) {
  if (!filePath) throw new Error('Path video tidak diberikan.')
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size < 1) throw new Error('File video kosong atau tidak valid.')
  const duration = await probeVideoDuration(filePath)
  const buffer = await fs.readFile(filePath)
  const sourceSha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  const model = String(process.env.ALVARETH_VIDEO_ANALYSIS_MODEL || DEFAULT_MODEL).trim()
  let cutroom = null
  let cutroomError = ''

  if (String(process.env.ALVARETH_CUTROOM_API_URL || '').trim()) {
    try {
      if (typeof onProgress === 'function') onProgress('Mengirim video ke Cutroom untuk transkripsi, diarization, dan face tracking.')
      cutroom = await runCutroomSidecar({
        filePath,
        fileName: fileName || path.basename(filePath),
        mimeType,
        signal,
        onProgress: value => {
          if (typeof onProgress === 'function') onProgress(
            'Cutroom: audio=' + value.transcribe + '; wajah=' + value.faces + '; pencocokan=' + value.match
          )
        }
      })
    } catch (error) {
      cutroomError = String(error?.message || error).slice(0, 700)
      console.warn('[ANALISIS] Cutroom sidecar tidak tersedia:', cutroomError)
      if (String(process.env.ALVARETH_CUTROOM_REQUIRED || '').toLowerCase() === 'true') throw error
    }
  }

  let modelResult = null
  if (apiKey) {
    if (typeof onProgress === 'function') onProgress('Mengunggah video ke Gemini dan menganalisis isi audiovisual.')
    modelResult = await runGeminiAnalysis({
      filePath,
      fileName: fileName || path.basename(filePath),
      mimeType,
      apiKey,
      model,
      action,
      duration,
      sidecar: cutroom,
      signal
    })
  } else if (!cutroom) {
    throw new Error('GEMINI_API_KEY belum diatur dan Cutroom sidecar tidak tersedia. Isi GEMINI_API_KEY atau konfigurasi ALVARETH_CUTROOM_API_URL.')
  }

  const analysis = normalizeGeminiAnalysis(modelResult || {}, duration)
  const sidecar = cutroom ? normalizeCutroom(cutroom, duration) : null
  const speakers = sidecar?.speakers?.length
    ? sidecar.speakers
    : analysis.speakers.map(item => ({
        speaker_id: item.speaker_id,
        display_name: item.speaker_id,
        avatar_ref: null,
        mapping_status: 'UNKNOWN',
        mapping_evidence: []
      }))

  const segments = sidecar?.turns?.length
    ? sidecar.turns.map(turn => ({
        start: turn.start,
        end: turn.end,
        speaker_id: turn.speaker,
        text: turn.text,
        confidence: 'low',
        notes: 'Cutroom diarization and ASR output; source-audio review required.'
      }))
    : analysis.transcript_segments

  const transcript = createTranscriptArtifact({
    sourceFile: fileName || path.basename(filePath),
    sourceSha256,
    language: analysis.language || String(process.env.ALVARETH_WHISPERX_LANGUAGE || 'unknown'),
    duration,
    words: sidecar?.words || [],
    segments,
    speakers,
    asrModel: sidecar?.words?.length ? 'Cutroom faster-whisper + pyannote' : 'Gemini multimodal ASR'
  })
  transcript.segments = segments
  const speakerMap = {
    speakers,
    faces: sidecar?.faces || [],
    matches: sidecar?.matches || [],
    overlaps: sidecar?.overlaps || [],
    limitations: [
      'Speaker IDs are diarization labels, not verified real identities.',
      'Face matches are candidates and require human confirmation.',
      'Animated or VTuber avatars may not be tracked reliably by a real-face detector.'
    ]
  }

  return {
    source: {
      file_name: path.basename(String(fileName || filePath)),
      size_bytes: stat.size,
      duration_seconds: duration,
      sha256: sourceSha256,
      mime_type: mimeType
    },
    engine: {
      gemini_model: apiKey ? model : null,
      cutroom_used: Boolean(cutroom),
      cutroom_job_id: cutroom?.jobId || null,
      cutroom_error: cutroomError || null,
      transcript_word_aligned: Boolean(sidecar?.words?.length)
    },
    analysis,
    transcript,
    speakerMap
  }
}

export function buildAnalysisReport(result) {
  const analysis = result?.analysis || {}
  const lines = [
    '# Laporan Analisis Video',
    '',
    '- Source: ' + String(result?.source?.file_name || 'unknown'),
    '- Durasi: ' + (Number.isFinite(result?.source?.duration_seconds)
      ? result.source.duration_seconds.toFixed(2) + ' detik'
      : 'tidak tersedia'),
    '- SHA-256: ' + String(result?.source?.sha256 || 'tidak tersedia'),
    '- Gemini: ' + String(result?.engine?.gemini_model || 'tidak digunakan'),
    '- Cutroom: ' + (result?.engine?.cutroom_used ? 'digunakan' : 'tidak tersedia'),
    '- Word alignment: ' + (result?.engine?.transcript_word_aligned ? 'tersedia' : 'tidak tersedia'),
    '',
    '## Ringkasan',
    asText(analysis.summary, 'Belum tersedia.'),
    '',
    '## Adegan'
  ]
  for (const scene of asArray(analysis.scenes)) {
    lines.push('- ' + formatSrtTimestamp(scene.start) + '–' + formatSrtTimestamp(scene.end) +
      ': ' + scene.description + (scene.visual_focus ? ' | Fokus: ' + scene.visual_focus : ''))
  }
  if (!analysis.scenes?.length) lines.push('- Data adegan belum tersedia.')
  lines.push('', '## Highlight')
  for (const item of asArray(analysis.highlights)) {
    lines.push('- ' + formatSrtTimestamp(item.start) + '–' + formatSrtTimestamp(item.end) +
      ': ' + (item.hook || 'Hook belum tersedia') +
      (item.payoff ? ' | Payoff: ' + item.payoff : '') +
      ' | Confidence: ' + item.confidence)
  }
  if (!analysis.highlights?.length) lines.push('- Belum ada highlight yang dapat dipastikan.')
  lines.push('', '## Keterbatasan dan ketidakpastian')
  for (const note of asArray(analysis.uncertainties)) lines.push('- ' + note)
  if (result?.engine?.cutroom_error) lines.push('- Cutroom fallback: ' + result.engine.cutroom_error)
  lines.push(
    '',
    '## Kebijakan verifikasi',
    '- Semua hasil ASR berstatus ASR_RAW.',
    '- Subtitle yang dihasilkan adalah draft, bukan subtitle final terverifikasi.',
    '- Pemetaan speaker ke wajah/karakter tetap UNKNOWN atau CANDIDATE sampai dikonfirmasi manusia.',
    '- Analisis otomatis tidak menjamin semua dialog, ekspresi, atau identitas terdeteksi dengan benar.'
  )
  return lines.join('\n') + '\n'
}

export function buildEditorialBrief(result) {
  const analysis = result?.analysis || {}
  const lines = [
    '# Skills-Clip Editorial Handoff',
    '',
    '## Source',
    '- File: ' + String(result?.source?.file_name || 'unknown'),
    '- Duration: ' + (Number.isFinite(result?.source?.duration_seconds)
      ? result.source.duration_seconds.toFixed(3) + 's'
      : 'unknown'),
    '- SHA-256: ' + String(result?.source?.sha256 || 'unknown'),
    '',
    '## Context',
    asText(analysis.summary, 'Context not available.'),
    '',
    '## Candidate scenes and highlights'
  ]
  for (const item of asArray(analysis.highlights)) {
    lines.push('- ' + item.start.toFixed(3) + '-' + item.end.toFixed(3) + 's | ' +
      item.hook + ' | setup: ' + item.setup + ' | payoff: ' + item.payoff +
      ' | confidence: ' + item.confidence)
  }
  if (!analysis.highlights?.length) lines.push('- No highlight candidate was returned.')
  lines.push('', '## Editorial recommendations')
  for (const item of asArray(analysis.editorial_recommendations)) {
    lines.push('- ' + item.start.toFixed(3) + '-' + item.end.toFixed(3) + 's | ' +
      item.reason + ' | focus: ' + item.visual_focus + ' | treatment: ' +
      item.suggested_treatment + ' | risk: ' + item.risk)
  }
  if (!analysis.editorial_recommendations?.length) lines.push('- No recommendation was returned.')
  lines.push(
    '',
    '## Speaker and transcript constraints',
    '- Transcript is machine-generated and remains ASR_RAW.',
    '- Speaker IDs are provisional diarization labels.',
    '- Avatar/face matching is UNKNOWN or CANDIDATE until a human confirms it.',
    '- Review the original audio and video before making final captions or identity claims.'
  )
  return lines.join('\n') + '\n'
}
