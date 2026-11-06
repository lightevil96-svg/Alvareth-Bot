import { localServiceUrl, localJson } from "../local-service.js";
import { startLocalVideoServices } from "../local-services.js";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { getVoiceSettings, VOXCPM_STYLES } from "../voice-settings.js";
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

// Fallback captions need no second model: distribute words across the measured
// WAV duration using syllable/punctuation weights. Timings are approximate and
// are used only when the optional local aligner is absent.
export function buildEstimatedCaptionGroups(text, offsetSeconds, durationSeconds, maxWords = 5) {
  const tokens = clean(text, 1200).match(/\S+/gu) || [];
  const offset = Number(offsetSeconds);
  const duration = Number(durationSeconds);
  if (!tokens.length || !Number.isFinite(offset) || offset < 0 || !Number.isFinite(duration) || duration <= 0) return [];
  const weights = tokens.map(token => {
    const letters = token.replace(/[^\p{L}\p{N}]/gu, "");
    const syllables = (letters.match(/[aiueo]+/giu) || []).length;
    const punctuation = /[.!?…]$/u.test(token) ? 1.2 : /[,;:]$/u.test(token) ? 0.5 : 0;
    return Math.max(1, letters.length * 0.42 + syllables * 0.62 + punctuation);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const limit = Math.max(1, Math.min(8, Math.floor(Number(maxWords) || 5)));
  const groups = [];
  let consumed = 0;
  let current = [];
  const flush = () => {
    if (!current.length) return;
    groups.push({ startSeconds: current[0].startSeconds, endSeconds: current[current.length - 1].endSeconds, words: current });
    current = [];
  };
  tokens.forEach((token, index) => {
    const startSeconds = offset + duration * consumed / totalWeight;
    consumed += weights[index];
    const endSeconds = index === tokens.length - 1 ? offset + duration : offset + duration * consumed / totalWeight;
    current.push({ text: token, startSeconds, endSeconds });
    if (current.length >= limit || /[.!?…]$/u.test(token)) flush();
  });
  flush();
  return groups;
}

const VIDEO_STUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const EDGE_TTS_SCRIPT = join(VIDEO_STUDIO_DIR, "services", "edge_tts", "synthesize.py");

function edgeTtsPythonPath() {
  return String(
    process.env.VIDEO_STUDIO_EDGE_TTS_PYTHON ||
    process.env.VIDEO_STUDIO_VOXCPM_PYTHON ||
    join(VIDEO_STUDIO_DIR, "..", ".venv-voxcpm", "bin", "python")
  );
}

function runEdgeTts(text, settings, jobId, sceneNumber) {
  return new Promise((resolve, reject) => {
    const python = edgeTtsPythonPath();
    if (python.includes("/") && !existsSync(python)) {
      reject(new Error("Python Edge TTS belum tersedia. Jalankan .remotion voice install."));
      return;
    }
    if (!existsSync(EDGE_TTS_SCRIPT)) {
      reject(new Error("Adapter Edge TTS tidak ditemukan: " + EDGE_TTS_SCRIPT));
      return;
    }

    console.log("[REMOTION:EDGE-TTS] Job " + jobId + " | scene " + sceneNumber + ": menghubungkan ke layanan suara online.");
    const child = spawn(python, [EDGE_TTS_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 32 * 1024 * 1024) {
        child.kill();
        fail(new Error("Respons Edge TTS melebihi batas ukuran 32 MB."));
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
      const lines = stderr.split(/\r?\n/);
      stderr = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) console.log("[REMOTION:EDGE-TTS] " + line.trim());
      }
    });
    child.once("error", error => fail(new Error("Tidak dapat menjalankan Python Edge TTS: " + error.message)));
    child.once("close", code => {
      if (settled) return;
      const tail = stderr.trim();
      if (tail) console.log("[REMOTION:EDGE-TTS] " + tail.split(/\r?\n/).at(-1));
      if (code !== 0) {
        const detail = (tail || stdout || "proses berhenti tanpa detail").slice(-900);
        const installHint = /No module named ['"]edge_tts['"]/.test(detail)
          ? " Paket belum terpasang; jalankan .remotion voice install."
          : "";
        fail(new Error("Edge TTS online gagal: " + detail + installHint));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.provider !== "EdgeTTS" || typeof result.audio_base64 !== "string") {
          throw new Error("Respons Edge TTS tidak memiliki audio yang valid.");
        }
        settled = true;
        resolve(result);
      } catch (error) {
        fail(new Error("Respons Edge TTS tidak dapat dibaca: " + error.message));
      }
    });

    child.stdin.on("error", error => {
      if (error.code !== "EPIPE") fail(new Error("Gagal mengirim teks ke Edge TTS: " + error.message));
    });
    child.stdin.end(JSON.stringify({
      text,
      voice: settings.voice,
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume
    }));
  });
}

export function buildWordBoundaryCaptionGroups(words, offsetSeconds = 0, durationSeconds = Infinity, maxWords = 5) {
  const groups = [];
  const limit = Math.max(1, Math.min(8, Math.floor(Number(maxWords) || 5)));
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
  for (const word of Array.isArray(words) ? words : []) {
    const text = clean(word?.text, 120);
    const start = Number(word?.start);
    const end = Number(word?.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= durationSeconds) continue;
    const item = {
      text,
      startSeconds: offsetSeconds + start,
      endSeconds: offsetSeconds + Math.min(durationSeconds, end)
    };
    current.push(item);
    if (current.length >= limit || /[.!?…]["')\]]?$/u.test(text)) flush();
  }
  flush();
  return groups;
}

function isValidWordAlignment(words, duration) {
  if (!Array.isArray(words) || !words.length) return false;
  let lastStart = -0.001;
  return words.every(word => {
    const start = Number(word?.start);
    const end = Number(word?.end);
    const ok = typeof word?.text === "string" && word.text.trim() &&
      Number.isFinite(start) && Number.isFinite(end) &&
      start >= lastStart && end > start && end <= duration + 0.1;
    if (ok) lastStart = start;
    return ok;
  });
}

// The provider is selected per job. Edge TTS is the fast online default;
// VoxCPM2 remains available as an optional local model.
export async function prepareVoiceover(project, jobId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error("ID job tidak valid.");
  const hasNarration = (Array.isArray(project.scenes) ? project.scenes : []).some(scene =>
    clean(scene?.narration || [scene?.text, scene?.subtext].filter(Boolean).join(". "), 4000)
  );
  if (!hasNarration) return { scenes: project.scenes || [], voiceoverTracks: [], captions: [], warnings: [] };

  const settings = project.voiceSettings || getVoiceSettings();
  const provider = settings.provider || "edge-tts";
  if (!["edge-tts", "voxcpm2"].includes(provider)) throw new Error("Provider voice tidak dikenal: " + provider);

  let endpoint = "";
  if (provider === "voxcpm2") {
    const base = process.env.VIDEO_STUDIO_VOXCPM_URL || "http://127.0.0.1:7861";
    if (new URL(base).origin === "http://127.0.0.1:7861") {
      console.log("[REMOTION:VOICE] Menunggu VoxCPM2 siap (tanpa batas waktu)...");
      const services = await startLocalVideoServices({ services: ["voxcpm"], waitMs: Infinity });
      if (!services.voxcpm?.ready) throw new Error(services.voxcpm?.detail || "Service VoxCPM2 lokal belum siap.");
    }
    endpoint = localServiceUrl(base, "speech");
  }

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
      let response;
      const synthesisStartedAt = Date.now();
      console.log(
        "[REMOTION:VOICE] Job " + jobId + " | scene " + (index + 1) + "/" + project.scenes.length +
        ": provider=" + (provider === "edge-tts" ? "Microsoft Edge Neural TTS" : "VoxCPM2") +
        "; " + text.length + " karakter."
      );
      try {
        if (provider === "edge-tts") {
          response = await runEdgeTts(text, settings, jobId, index + 1);
        } else {
          response = await localJson(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text,
              language: project.language || "id",
              voice_description: VOXCPM_STYLES[settings.voxStyle] || VOXCPM_STYLES.warm
            })
          }, null);
        }
      } catch (error) {
        throw new Error(
          (provider === "edge-tts" ? "Edge TTS online gagal menyintesis audio: " : "VoxCPM2 lokal gagal menyintesis audio: ") +
          String(error?.message || error).slice(0, 600)
        );
      }

      const expectedProvider = provider === "edge-tts" ? "EdgeTTS" : "VoxCPM2";
      if (response.provider !== expectedProvider || typeof response.audio_base64 !== "string") {
        throw new Error("Respons audio bukan berasal dari provider " + expectedProvider + ".");
      }
      const audio = Buffer.from(response.audio_base64, "base64");
      if (audio.length < 44 || audio.length > 8 * 1024 * 1024) throw new Error("Ukuran audio voice-over tidak valid.");
      const audioFormat = provider === "edge-tts" ? "mp3" : "wav";
      if (audioFormat === "wav" && (audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE")) {
        throw new Error("Audio VoxCPM2 bukan WAV yang valid.");
      }
      const filename = "voice-" + index + "." + audioFormat;
      const path = join(folder, filename);
      await writeFile(path, audio);
      const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], {
        timeout: 15000,
        maxBuffer: 1024 * 1024
      }));
      const duration = Number(info.format?.duration);
      if (!info.streams?.some(stream => stream.codec_type === "audio") || !Number.isFinite(duration) || duration <= 0 || duration > 19.7) {
        throw new Error("Narasi terlalu panjang atau audio rusak; ringkas scene (maksimal 19,7 detik bicara).");
      }
      execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", path, "-f", "null", "-"], {
        timeout: 15000,
        stdio: "pipe"
      });
      console.log(
        "[REMOTION:VOICE] Job " + jobId + " | scene " + (index + 1) + "/" + project.scenes.length +
        ": audio siap dalam " + ((Date.now() - synthesisStartedAt) / 1000).toFixed(1) +
        " dtk; durasi " + duration.toFixed(2) + " dtk; ukuran " + audio.length + " byte."
      );

      durationFrames = Math.max(durationFrames, Math.ceil((duration + 0.25) * fps));
      voiceoverTracks.push({ src: "generated/" + jobId + "/" + filename, startSeconds, durationSeconds: duration });
      const words = Array.isArray(response.words) ? response.words : [];
      if (isValidWordAlignment(words, duration)) {
        captions.push(...buildWordBoundaryCaptionGroups(words, startSeconds, duration, 5));
      } else {
        captions.push(...buildEstimatedCaptionGroups(text, startSeconds, duration, 5));
        const warning = provider === "edge-tts"
          ? "Edge TTS tidak mengirim word-boundary; subtitle memakai timing estimasi."
          : "Alignment kata VoxCPM2 tidak tersedia; subtitle memakai timing estimasi.";
        if (!warnings.includes(warning)) warnings.push(warning);
      }
    }
    if (durationFrames > 20 * fps) throw new Error("Narasi melebihi batas scene.");
    scenes.push({ ...scene, startSeconds, duration: durationFrames / fps });
    cursorFrames += durationFrames;
    if (cursorFrames > 300 * fps) throw new Error("Total narasi melebihi 5 menit.");
  }
  return { scenes, voiceoverTracks, captions, warnings };
}
