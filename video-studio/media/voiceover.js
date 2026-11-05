import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "remotion", "public");
const GAP_SECONDS = 0.16;

function clean(value, max = 5000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
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
  return groupTimedWords(words, maxWords);
}

function groupTimedWords(words, maxWords = 4) {
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

export function extractVoxCpmWords(timestampResult) {
  const source = timestampResult && typeof timestampResult === "object" ? timestampResult : {};
  // Official OpenBMB VoxCPM2 CLI writes TimestampResult.to_dict():
  // { audio_path, sample_rate, backend, level, text, items: [{text,start,end,level}] }.
  const items = Array.isArray(source.items) ? source.items : [];
  const segments = Array.isArray(source.segments) ? source.segments : Array.isArray(source) ? source : [];
  const sourceWords = Array.isArray(source.words) ? source.words : [];
  const output = [];
  const append = item => {
    const text = clean(item?.word ?? item?.text ?? item?.token, 100);
    const start = Number(item?.start ?? item?.start_time ?? item?.startSeconds);
    const end = Number(item?.end ?? item?.end_time ?? item?.endSeconds);
    if (text && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
      output.push({ text, startSeconds: start, endSeconds: end });
    }
  };
  for (const item of items) append(item);
  for (const item of sourceWords) append(item);
  for (const segment of segments) {
    const nested = Array.isArray(segment?.words) ? segment.words : Array.isArray(segment?.word_segments) ? segment.word_segments : [];
    if (nested.length) {
      for (const word of nested) append(word);
      continue;
    }
    const text = clean(segment?.text, 600);
    const start = Number(segment?.start ?? segment?.start_time);
    const end = Number(segment?.end ?? segment?.end_time);
    if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      output.push({ text, startSeconds: start, endSeconds: end });
    }
  }
  return output.sort((a, b) => a.startSeconds - b.startSeconds);
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      killTimer.unref?.();
      settled = true;
      reject(new Error("VoxCPM2 melewati batas waktu proses. Periksa GPU/VRAM dan VIDEO_STUDIO_VOXCPM_TIMEOUT_MS."));
    }, timeoutMs);
    const collect = (current, chunk) => (current + chunk.toString()).slice(-12000);
    child.stdout.on("data", chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = collect(stderr, chunk); });
    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Tidak dapat menjalankan VoxCPM2 CLI (" + command + "): " + error.message));
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("VoxCPM2 CLI gagal (exit " + code + "): " + clean(stderr || stdout, 1200)));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function roundSeconds(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export async function prepareVoiceover(project, jobId) {
  const scenes = Array.isArray(project?.scenes) ? project.scenes.map(scene => ({ ...scene })) : [];
  const narrated = scenes.map((scene, sceneIndex) => ({
    sceneIndex,
    text: clean(scene.narration, 4000)
  })).filter(item => item.text);
  if (!narrated.length) {
    return { voiceoverTracks: [], captions: [], scenes, warnings: ["Storyboard tidak memiliki narasi."] };
  }

  const command = clean(process.env.VIDEO_STUDIO_VOXCPM_BIN || "voxcpm", 500);
  const modelPath = clean(process.env.VIDEO_STUDIO_VOXCPM_MODEL_PATH, 1000);
  const modelId = clean(process.env.VIDEO_STUDIO_VOXCPM_MODEL_ID || "openbmb/VoxCPM2", 160);
  const language = clean(process.env.VIDEO_STUDIO_VOXCPM_TIMESTAMP_LANGUAGE || project.language || "id", 12);
  const device = clean(process.env.VIDEO_STUDIO_VOXCPM_DEVICE || "auto", 40);
  const timestampDevice = clean(process.env.VIDEO_STUDIO_VOXCPM_TIMESTAMP_DEVICE, 40);
  const timestampModel = clean(process.env.VIDEO_STUDIO_VOXCPM_TIMESTAMP_MODEL || "base", 80);
  const timeoutMs = Math.max(60000, Math.min(3600000, Number(process.env.VIDEO_STUDIO_VOXCPM_TIMEOUT_MS) || 900000));
  const folder = join(PUBLIC_DIR, "generated", jobId, "voxcpm");
  await mkdir(folder, { recursive: true });
  const inputPath = join(folder, "narration.txt");
  await writeFile(inputPath, narrated.map(item => item.text).join("\n") + "\n", "utf8");

  const args = [
    "batch",
    "--input", inputPath,
    "--output-dir", folder,
    "--timestamps",
    "--timestamp-level", "word",
    "--timestamp-language", language,
    "--timestamp-model", timestampModel,
    "--timestamp-strict",
    "--device", device,
    "--no-denoiser"
  ];
  if (timestampDevice) args.push("--timestamp-device", timestampDevice);
  if (modelPath) args.push("--model-path", modelPath);
  else args.push("--hf-model-id", modelId);

  await runCommand(command, args, timeoutMs);

  const voiceoverTracks = [];
  const captions = [];
  const narratedByScene = new Map(narrated.map((item, index) => [item.sceneIndex, index]));
  let cursor = 0;

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex];
    const narrationIndex = narratedByScene.get(sceneIndex);
    if (narrationIndex === undefined) {
      const duration = Math.max(1, Number(scene.duration) || 4);
      scene.startSeconds = roundSeconds(cursor);
      cursor += duration + GAP_SECONDS;
      continue;
    }

    const number = String(narrationIndex + 1).padStart(3, "0");
    const filename = "output_" + number + ".wav";
    const audioPath = join(folder, filename);
    const timestampPath = join(folder, "output_" + number + ".timestamps.json");
    const [audioInfo, timestampBytes] = await Promise.all([stat(audioPath), readFile(timestampPath)]);
    if (audioInfo.size < 1000 || audioInfo.size > 80 * 1024 * 1024) {
      throw new Error("File audio VoxCPM2 scene " + (sceneIndex + 1) + " kosong atau ukurannya tidak wajar.");
    }
    const timestampResult = JSON.parse(timestampBytes.toString("utf8"));
    const words = extractVoxCpmWords(timestampResult);
    if (!words.length) {
      throw new Error("VoxCPM2 menghasilkan audio, tetapi word timestamps scene " + (sceneIndex + 1) + " kosong.");
    }

    const audioDuration = Math.max(...words.map(word => word.endSeconds));
    const startSeconds = cursor;
    const originalDuration = Math.max(1, Number(scene.duration) || 4);
    const duration = Math.max(originalDuration, audioDuration + 0.55);
    if (duration > 20) {
      throw new Error("Narasi scene " + (sceneIndex + 1) + " terlalu panjang (" + roundSeconds(duration) + " detik). Pecah narasi menjadi beberapa scene agar sinkron.");
    }

    scene.startSeconds = roundSeconds(startSeconds);
    scene.duration = roundSeconds(duration);
    voiceoverTracks.push({
      src: "generated/" + jobId + "/voxcpm/" + filename,
      startSeconds: roundSeconds(startSeconds),
      durationSeconds: roundSeconds(audioDuration + 0.25)
    });
    captions.push(...groupTimedWords(words.map(word => ({
      ...word,
      startSeconds: roundSeconds(word.startSeconds + startSeconds),
      endSeconds: roundSeconds(word.endSeconds + startSeconds)
    }))));
    cursor += duration + GAP_SECONDS;
  }

  return {
    voiceoverTracks,
    captions,
    scenes,
    warnings: []
  };
}
