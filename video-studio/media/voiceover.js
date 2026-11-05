import { localServiceUrl, localJson } from "../local-service.js";
import { execFileSync } from "node:child_process";
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

// The /speech contract belongs to our Python wrapper, not to upstream VoxCPM.
export async function prepareVoiceover(project, jobId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error("ID job tidak valid.");
  const base = process.env.VIDEO_STUDIO_VOXCPM_URL;
  if (!base) return { scenes: project.scenes, voiceoverTracks: [], captions: [],
    warnings: ["VoxCPM2 belum dikonfigurasi; video tanpa narasi. Atur VIDEO_STUDIO_VOXCPM_URL. Tidak ada provider pengganti."] };
  const endpoint = localServiceUrl(base, "speech");
  const folder = join(PUBLIC_DIR, "generated", jobId);
  await mkdir(folder, { recursive: true });
  const scenes = [], voiceoverTracks = [], captions = [], warnings = [];
  const fps = project.fps || 30;
  let cursorFrames = 0;
  for (const [index, scene] of project.scenes.entries()) {
    const text = clean(scene.narration, 1200);
    let durationFrames = Math.round(scene.duration * fps);
    const startSeconds = cursorFrames / fps;
    if (text) {
      const response = await localJson(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, language: project.language || "id" })
      }, Math.max(30000, Math.min(1800000, Number(process.env.VIDEO_STUDIO_VOXCPM_TIMEOUT_MS) || 600000)));
      if (response.provider !== "VoxCPM2" || typeof response.audio_base64 !== "string") throw new Error("Respons bukan audio VoxCPM2.");
      const audio = Buffer.from(response.audio_base64, "base64");
      if (audio.length < 44 || audio.length > 8 * 1024 * 1024 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error("Audio VoxCPM2 bukan WAV yang valid.");
      const filename = "voice-" + index + ".wav";
      const path = join(folder, filename);
      await writeFile(path, audio);
      const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { timeout: 15000, maxBuffer: 1024 * 1024 }));
      const duration = Number(info.format?.duration);
      if (!info.streams?.some(stream => stream.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0 || duration > 19.7) throw new Error("Narasi terlalu panjang atau audio rusak; ringkas scene (maksimal 19,7 detik bicara).");
      execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { timeout: 15000, stdio: 'pipe' });
      durationFrames = Math.max(durationFrames, Math.ceil((duration + 0.25) * fps));
      voiceoverTracks.push({ src: "generated/" + jobId + "/" + filename, startSeconds, durationSeconds: duration });
      const words = Array.isArray(response.words) ? response.words : [];
      let lastEnd = 0;
      const valid = words.length && words.every(word => {
        const ok = typeof word.text === 'string' && word.text.trim() && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= lastEnd && word.end > word.start && word.end <= duration + 0.05;
        lastEnd = word.end; return ok;
      });
      if (valid) {
        for (let i = 0; i < words.length; i += 5) {
          const group = words.slice(i, i + 5).map(word => ({ text: word.text, startSeconds: startSeconds + word.start, endSeconds: startSeconds + Math.min(duration, word.end) }));
          captions.push({ startSeconds: group[0].startSeconds, endSeconds: group.at(-1).endSeconds, words: group });
        }
      } else if (!warnings.length) warnings.push("Alignment kata lokal tidak tersedia/valid; subtitle kata dinonaktifkan, narasi tetap sinkron per scene.");
    }
    if (durationFrames > 20 * fps) throw new Error("Narasi melebihi batas scene.");
    scenes.push({ ...scene, startSeconds, duration: durationFrames / fps });
    cursorFrames += durationFrames;
    if (cursorFrames > 300 * fps) throw new Error("Total narasi melebihi 5 menit.");
  }
  return { scenes, voiceoverTracks, captions, warnings };
}
