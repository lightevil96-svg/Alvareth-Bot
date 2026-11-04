import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "remotion", "public");
const GAP_SECONDS = 0.16;

function clean(value, max = 5000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max);
}

export function splitVoiceoverChunks(scenes, maxCharacters = 4000) {
  const chunks = [];
  let current = { text: "", ranges: [] };
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index] || {};
    const narration = clean(scene.narration || [scene.text, scene.subtext].filter(Boolean).join(". "), 4000);
    if (!narration) continue;
    if (narration.length > maxCharacters) {
      throw new Error("Narasi scene " + (index + 1) + " terlalu panjang untuk satu proses voice-over. Ringkas narasinya atau bagi menjadi beberapa scene.");
    }
    const separator = current.text ? "\n\n" : "";
    if (current.text && current.text.length + separator.length + narration.length > maxCharacters) {
      chunks.push(current);
      current = { text: "", ranges: [] };
    }
    const nextSeparator = current.text ? "\n\n" : "";
    const start = current.text.length + nextSeparator.length;
    current.text += nextSeparator + narration;
    current.ranges.push({ sceneIndex: index, start, end: start + narration.length });
  }
  if (current.text) chunks.push(current);
  return chunks;
}

function getAlignmentTimes(alignment, start, end) {
  if (!alignment || !Array.isArray(alignment.character_start_times_seconds) || !Array.isArray(alignment.character_end_times_seconds)) return null;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const chars = Array.isArray(alignment.characters) ? alignment.characters : [];
  let first = Infinity;
  let last = 0;
  const limit = Math.min(end, starts.length, ends.length);
  for (let index = Math.max(0, start); index < limit; index++) {
    if (chars[index] && !/\s/.test(chars[index])) {
      const a = Number(starts[index]);
      const b = Number(ends[index]);
      if (Number.isFinite(a)) first = Math.min(first, a);
      if (Number.isFinite(b)) last = Math.max(last, b);
    }
  }
  return Number.isFinite(first) && last > first ? { start: first, end: last } : null;
}

function alignmentWords(alignment, offsetSeconds = 0) {
  if (!alignment || !Array.isArray(alignment.characters) || !Array.isArray(alignment.character_start_times_seconds) || !Array.isArray(alignment.character_end_times_seconds)) return [];
  const words = [];
  let current = null;
  const flush = () => {
    if (current && current.text.trim() && current.endSeconds > current.startSeconds) words.push(current);
    current = null;
  };
  for (let index = 0; index < alignment.characters.length; index++) {
    const character = String(alignment.characters[index] || "");
    const start = Number(alignment.character_start_times_seconds[index]);
    const end = Number(alignment.character_end_times_seconds[index]);
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if (!current) current = { text: "", startSeconds: Infinity, endSeconds: 0 };
    current.text += character;
    if (Number.isFinite(start)) current.startSeconds = Math.min(current.startSeconds, start + offsetSeconds);
    if (Number.isFinite(end)) current.endSeconds = Math.max(current.endSeconds, end + offsetSeconds);
  }
  flush();
  return words;
}

export function buildCaptionGroups(alignment, offsetSeconds = 0, maxWords = 4) {
  const words = alignmentWords(alignment, offsetSeconds);
  const groups = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    groups.push({
      startSeconds: current[0].startSeconds,
      endSeconds: current[current.length - 1].endSeconds,
      words: current
    });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    if (current.length >= maxWords || /[.!?…]$/.test(word.text)) flush();
  }
  flush();
  return groups;
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error("ElevenLabs HTTP " + response.status + ": " + body.slice(0, 260));
    try { return JSON.parse(body); }
    catch { throw new Error("Respons voice-over bukan JSON yang valid."); }
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") throw new Error("Permintaan voice-over melewati batas waktu.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestSpeech(chunk, voiceId, apiKey, modelId, previousText, nextText, timeoutMs) {
  const format = String(process.env.VIDEO_STUDIO_ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128");
  const endpoint = "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voiceId) +
    "/with-timestamps?output_format=" + encodeURIComponent(format);
  const payload = {
    text: chunk.text,
    model_id: modelId,
    voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.2, speed: 0.96, use_speaker_boost: true }
  };
  if (previousText) payload.previous_text = previousText.slice(-500);
  if (nextText) payload.next_text = nextText.slice(0, 500);
  return fetchJson(endpoint, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  }, timeoutMs);
}

export async function prepareVoiceover(project, jobId) {
  const apiKey = clean(process.env.VIDEO_STUDIO_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY, 300);
  const voiceId = clean(process.env.VIDEO_STUDIO_ELEVENLABS_VOICE_ID, 160);
  if (!apiKey || !voiceId) {
    return {
      voiceoverTracks: [],
      captions: [],
      scenes: project.scenes,
      warnings: ["Voice-over dan subtitle sinkron belum aktif: tambahkan VIDEO_STUDIO_ELEVENLABS_API_KEY dan VIDEO_STUDIO_ELEVENLABS_VOICE_ID pada .env server."]
    };
  }

  const maxCharacters = Math.max(1000, Math.min(4500, Number(process.env.VIDEO_STUDIO_ELEVENLABS_MAX_CHARS) || 4000));
  const modelId = clean(process.env.VIDEO_STUDIO_ELEVENLABS_MODEL_ID || "eleven_multilingual_v2", 100);
  const timeoutMs = Math.max(15000, Math.min(180000, Number(process.env.VIDEO_STUDIO_MEDIA_TIMEOUT_MS) || 90000));
  const chunks = splitVoiceoverChunks(project.scenes, maxCharacters);
  if (!chunks.length) return { voiceoverTracks: [], captions: [], scenes: project.scenes, warnings: ["Storyboard tidak memiliki narasi yang dapat diubah menjadi voice-over."] };

  const folder = join(PUBLIC_DIR, "generated", jobId);
  await mkdir(folder, { recursive: true });
  const voiceoverTracks = [];
  const captions = [];
  const sceneStarts = new Array(project.scenes.length).fill(null);
  let timelineOffset = 0;
  let previousText = "";

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const nextText = chunks[chunkIndex + 1]?.text || "";
    const response = await requestSpeech(chunk, voiceId, apiKey, modelId, previousText, nextText, timeoutMs);
    if (!response || typeof response.audio_base64 !== "string") throw new Error("ElevenLabs tidak mengembalikan audio voice-over.");
    const audio = Buffer.from(response.audio_base64, "base64");
    if (audio.length < 1000 || audio.length > 30 * 1024 * 1024) throw new Error("Ukuran audio voice-over tidak valid atau melebihi 30 MB.");
    const filename = "voice-" + String(chunkIndex + 1).padStart(2, "0") + ".mp3";
    await writeFile(join(folder, filename), audio);
    const alignment = response.alignment || response.normalized_alignment || null;
    if (!alignment || !Array.isArray(alignment.characters) || !Array.isArray(alignment.character_start_times_seconds) || !Array.isArray(alignment.character_end_times_seconds)) {
      throw new Error("ElevenLabs tidak mengembalikan timing karakter; voice-over tidak dapat disinkronkan dengan aman.");
    }
    const localWords = alignmentWords(alignment, timelineOffset);
    if (!localWords.length) throw new Error("Data timing voice-over kosong; audio dilewati agar tidak terpotong.");
    const localEnd = localWords.reduce((max, word) => Math.max(max, word.endSeconds), timelineOffset);
    const audioDuration = Math.max(0.1, localEnd - timelineOffset);
    voiceoverTracks.push({
      src: "generated/" + jobId + "/" + filename,
      startSeconds: timelineOffset,
      durationSeconds: audioDuration + 0.2
    });
    captions.push(...buildCaptionGroups(alignment, timelineOffset));
    for (const range of chunk.ranges) {
      const timing = getAlignmentTimes(alignment, range.start, range.end);
      if (timing) sceneStarts[range.sceneIndex] = timelineOffset + timing.start;
    }
    timelineOffset += audioDuration + GAP_SECONDS;
    previousText = chunk.text;
  }

  const scenes = project.scenes.map(scene => ({ ...scene }));
  const allScenesMapped = sceneStarts.every(Number.isFinite);
  const warnings = [];
  if (allScenesMapped) {
    const starts = sceneStarts.map((value, index) => index === 0 ? 0 : value);
    const durations = starts.map((start, index) => {
      const end = index < starts.length - 1 ? starts[index + 1] : timelineOffset + 0.65;
      return Math.round((end - start) * 100) / 100;
    });
    const valid = durations.every(value => Number.isFinite(value) && value >= 1 && value <= 20) &&
      durations.reduce((sum, value) => sum + value, 0) <= 300;
    if (valid) {
      for (let index = 0; index < scenes.length; index++) {
        scenes[index].startSeconds = starts[index];
        scenes[index].duration = durations[index];
      }
    } else {
      throw new Error("Durasi bicara tidak muat dalam batas scene. Voice-over dilewati agar audio dan visual tidak saling mendahului.");
    }
  } else {
    throw new Error("Timing karakter tidak lengkap untuk semua scene. Voice-over dilewati agar subtitle tidak meleset.");
  }

  return { voiceoverTracks, captions, scenes, warnings };
}
