import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getOutputDimensions, validateEditPlan } from "./schema.js";

const execFileAsync = promisify(execFile);
const EDIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.join(EDIT_ROOT, "assets", "music");
const MUSIC_MANIFEST = path.join(EDIT_ROOT, "assets", "music_manifest.json");

function numberText(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function parseFrameRate(value) {
  const parts = String(value || "0/1").split("/").map(Number);
  return parts[1] ? parts[0] / parts[1] : 0;
}

async function execCapture(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: options.timeout || 120000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim().slice(-1400);
    throw new Error(command + " gagal: " + detail);
  }
}

export async function probeVideo(filePath) {
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Sumber video bukan file biasa yang aman diproses.");
  const result = await execCapture("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration",
    "-of", "json",
    filePath
  ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Metadata video tidak dapat dibaca oleh FFprobe.");
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find(stream => stream.codec_type === "video");
  const audio = streams.find(stream => stream.codec_type === "audio");
  if (!video) throw new Error("File tidak memiliki video stream yang valid.");
  const duration = Number(parsed.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 900) {
    throw new Error("Durasi sumber harus lebih dari 0 dan maksimal 15 menit.");
  }
  return {
    duration,
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    fps: parseFrameRate(video.avg_frame_rate || video.r_frame_rate),
    videoCodec: String(video.codec_name || ""),
    audioCodec: audio?.codec_name || null,
    hasAudio: Boolean(audio)
  };
}

export function parseSilenceLog(log, duration, minimumSeconds = 0.55) {
  const intervals = [];
  let currentStart = null;
  const lines = String(log || "").split(/\r?\n/);
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/i);
    if (startMatch) currentStart = Math.max(0, Number(startMatch[1]));
    const endMatch = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/i);
    if (endMatch && currentStart !== null) {
      const end = Math.min(duration, Math.max(currentStart, Number(endMatch[1])));
      if (end - currentStart >= minimumSeconds) intervals.push({ start: currentStart, end });
      currentStart = null;
    }
  }
  if (currentStart !== null && duration - currentStart >= minimumSeconds) {
    intervals.push({ start: currentStart, end: duration });
  }
  return intervals;
}

export function limitSegments(segments, maxDurationSeconds) {
  let remaining = Math.max(0, Number(maxDurationSeconds) || 0);
  const result = [];
  for (const item of segments) {
    if (remaining <= 0.01) break;
    const start = Number(item.start);
    const end = Number(item.end);
    const speed = Number(item.speed || 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(speed) || speed <= 0) continue;
    const sourceSecondsAvailable = remaining * speed;
    const clippedEnd = Math.min(end, start + sourceSecondsAvailable);
    if (clippedEnd - start < 0.08) continue;
    const outputSeconds = (clippedEnd - start) / speed;
    result.push({ start, end: clippedEnd, speed });
    remaining -= outputSeconds;
  }
  return result;
}

export function buildKeepSegments(plan, sourceDuration, silenceIntervals = []) {
  let candidates = [];
  if (plan.edit.segments.length) {
    candidates = plan.edit.segments.map(item => ({ ...item }));
  } else if (plan.edit.removeSilence && silenceIntervals.length) {
    let cursor = 0;
    const padding = plan.edit.keepPaddingSeconds;
    for (const silence of silenceIntervals) {
      const start = Math.max(cursor, Number(silence.start));
      const end = Math.min(sourceDuration, Number(silence.end));
      if (end <= start) continue;
      const keepUntil = Math.min(sourceDuration, start + padding);
      if (keepUntil - cursor >= 0.12) candidates.push({ start: cursor, end: keepUntil, speed: 1 });
      cursor = Math.max(cursor, end - padding);
    }
    if (sourceDuration - cursor >= 0.12) candidates.push({ start: cursor, end: sourceDuration, speed: 1 });
  } else {
    candidates = [{ start: 0, end: sourceDuration, speed: 1 }];
  }

  if (!candidates.length) candidates = [{ start: 0, end: sourceDuration, speed: 1 }];
  const limited = limitSegments(candidates, plan.output.maxDurationSeconds);
  if (!limited.length) throw new Error("Tidak ada bagian video yang cukup panjang untuk dirender.");
  return limited;
}

async function detectSilences(filePath, plan, duration, onWarning) {
  try {
    const result = await execCapture("ffmpeg", [
      "-hide_banner",
      "-i", filePath,
      "-vn",
      "-af", "silencedetect=noise=" + numberText(plan.edit.silenceThresholdDb) + "dB:d=" + numberText(plan.edit.minSilenceSeconds),
      "-f", "null",
      "-"
    ], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    return parseSilenceLog(result.stderr, duration, plan.edit.minSilenceSeconds);
  } catch (error) {
    onWarning?.("Deteksi jeda audio dilewati: " + String(error.message || error).slice(0, 180));
    return [];
  }
}

async function resolveMusicAsset(assetId) {
  if (!assetId || assetId === "none") return null;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MUSIC_MANIFEST, "utf8"));
  } catch {
    throw new Error("Manifest musik lokal tidak dapat dibaca.");
  }
  const tracks = Array.isArray(manifest.tracks) ? manifest.tracks : [];
  const track = tracks.find(item => item && item.id === assetId);
  if (!track) throw new Error("ID musik tidak ditemukan di library aset yang disetujui: " + assetId);
  if (track.licenseStatus !== "verified-free" || typeof track.file !== "string") {
    throw new Error("Aset musik belum memiliki status lisensi verified-free.");
  }
  const root = path.resolve(MUSIC_DIR);
  const target = path.resolve(root, track.file);
  if (!target.startsWith(root + path.sep)) throw new Error("Path aset musik di luar direktori library ditolak.");
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Aset musik bukan file lokal biasa.");
  return { path: target, title: String(track.title || assetId).slice(0, 80) };
}

function formatAssTime(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const wholeSeconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return hours + ":" + String(minutes).padStart(2, "0") + ":" +
    String(wholeSeconds).padStart(2, "0") + "." + String(fraction).padStart(2, "0");
}

function escapeAssText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, "\\N")
    .trim();
}

async function writeCaptionsFile(workDir, plan, dimensions) {
  if (!plan.captions.enabled || !plan.captions.items.length) return null;
  const bold = plan.captions.style === "bold" ? 1 : 0;
  const fontSize = Math.round(dimensions.width * (bold ? 0.052 : 0.046));
  const margin = Math.round(dimensions.height * (plan.output.ratio === "16:9" ? 0.07 : 0.075));
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "PlayResX: " + dimensions.width,
    "PlayResY: " + dimensions.height,
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    "Style: Default,Arial," + fontSize + ",&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000," + bold + ",0,0,0,100,100,0,0,1,4,1,2,72,72," + margin + ",1",
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text"
  ];
  for (const item of plan.captions.items) {
    lines.push(
      "Dialogue: 0," + formatAssTime(item.start) + "," + formatAssTime(item.end) +
      ",Default,,0,0,0,," + escapeAssText(item.text)
    );
  }
  const filePath = path.join(workDir, "captions.ass");
  await writeFile(filePath, lines.join("\n") + "\n", { mode: 0o600 });
  return filePath;
}

function escapeFilterPath(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function buildFilterGraph({ segments, plan, dimensions, duration, hasAudio, music, captionsPath }) {
  const filters = [];
  const videoInputs = [];
  const audioInputs = [];

  segments.forEach((segment, index) => {
    const start = numberText(segment.start);
    const end = numberText(segment.end);
    const speed = numberText(segment.speed);
    filters.push(
      "[0:v]trim=start=" + start + ":end=" + end +
      ",setpts=(PTS-STARTPTS)/" + speed + "[v" + index + "]"
    );
    videoInputs.push("[v" + index + "]");
    if (hasAudio) {
      filters.push(
        "[0:a]atrim=start=" + start + ":end=" + end +
        ",asetpts=PTS-STARTPTS,atempo=" + speed + "[a" + index + "]"
      );
      audioInputs.push("[a" + index + "]");
    }
  });

  filters.push(
    videoInputs.join("") + "concat=n=" + segments.length + ":v=1:a=0[vcat]"
  );
  const fadeIn = Math.min(plan.edit.fadeInSeconds, duration / 2);
  const fadeOut = Math.min(plan.edit.fadeOutSeconds, duration / 2);
  const videoEffects = [
    "scale=" + dimensions.width + ":" + dimensions.height + ":force_original_aspect_ratio=increase",
    "crop=" + dimensions.width + ":" + dimensions.height + ":(in_w-out_w)/2:(in_h-out_h)/2",
    "fps=" + plan.output.fps,
    "setsar=1"
  ];
  if (fadeIn > 0) videoEffects.push("fade=t=in:st=0:d=" + numberText(fadeIn));
  if (fadeOut > 0) videoEffects.push("fade=t=out:st=" + numberText(Math.max(0, duration - fadeOut)) + ":d=" + numberText(fadeOut));
  if (captionsPath) videoEffects.push("ass=filename='" + escapeFilterPath(captionsPath) + "'");
  filters.push("[vcat]" + videoEffects.join(",") + "[vout]");

  const hasOutputAudio = hasAudio || Boolean(music);
  if (hasOutputAudio) {
    if (hasAudio) {
      filters.push(audioInputs.join("") + "concat=n=" + segments.length + ":v=0:a=1[acat]");
    }
    if (hasAudio && music) {
      filters.push("[acat]volume=" + numberText(plan.audio.originalVolume) + "[abase]");
      filters.push(
        "[1:a]atrim=duration=" + numberText(duration) +
        ",asetpts=PTS-STARTPTS,volume=" + numberText(plan.audio.musicVolume) + "[music]"
      );
      filters.push("[abase][music]amix=inputs=2:duration=first:dropout_transition=2[amix]");
    } else if (hasAudio) {
      filters.push("[acat]volume=" + numberText(plan.audio.originalVolume) + "[amix]");
    } else {
      filters.push(
        "[1:a]atrim=duration=" + numberText(duration) +
        ",asetpts=PTS-STARTPTS,volume=" + numberText(plan.audio.musicVolume) + "[amix]"
      );
    }

    const audioEffects = [];
    if (fadeIn > 0) audioEffects.push("afade=t=in:st=0:d=" + numberText(fadeIn));
    if (fadeOut > 0) audioEffects.push("afade=t=out:st=" + numberText(Math.max(0, duration - fadeOut)) + ":d=" + numberText(fadeOut));
    if (plan.audio.normalize) audioEffects.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    filters.push("[amix]" + (audioEffects.length ? audioEffects.join(",") : "anull") + "[aout]");
  }

  return { graph: filters.join(";"), hasOutputAudio };
}

function runFfmpeg(args, expectedDuration, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Rendering melewati batas waktu 20 menit."));
    }, 20 * 60 * 1000);

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match && expectedDuration > 0) {
          const seconds = Number(match[1]) / 1000000;
          onProgress?.(Math.min(99, Math.round(seconds / expectedDuration * 100)));
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      stderr += chunk;
      if (stderr.length > 24000) stderr = stderr.slice(-24000);
    });
    child.once("error", error => finish(new Error("FFmpeg tidak dapat dijalankan: " + error.message)));
    child.once("close", code => {
      if (settled) return;
      clearTimeout(timer);
      if (code === 0) {
        onProgress?.(100);
        settled = true;
        resolve();
      } else {
        finish(new Error("FFmpeg rendering gagal (exit " + code + "): " + stderr.trim().slice(-1800)));
      }
    });
  });
}

export async function renderEditVideo({
  sourcePath,
  outputPath,
  workDir,
  inputPlan,
  settings,
  onProgress,
  onWarning
}) {
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error("File sumber tidak valid atau merupakan symbolic link.");
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await mkdir(workDir, { recursive: true, mode: 0o700 });

  try {
    const source = await probeVideo(sourcePath);
    const plan = validateEditPlan(inputPlan, { sourceDuration: source.duration, settings });
    const silenceIntervals = plan.edit.removeSilence && source.hasAudio
      ? await detectSilences(sourcePath, plan, source.duration, onWarning)
      : [];
    const segments = buildKeepSegments(plan, source.duration, silenceIntervals);
    const duration = segments.reduce((sum, item) => sum + (item.end - item.start) / item.speed, 0);
    if (duration < 1) throw new Error("Hasil edit terlalu pendek. Pilih segmen dengan durasi minimal 1 detik.");
    if (plan.captions.enabled && plan.captions.items.some(item => item.end > duration + 0.05)) {
      throw new Error("Waktu akhir caption melebihi durasi timeline hasil edit. Sesuaikan captions.items dengan durasi output setelah pemotongan.");
    }
    const dimensions = getOutputDimensions(plan.output);
    const captionsPath = await writeCaptionsFile(workDir, plan, dimensions);
    const music = await resolveMusicAsset(plan.audio.musicAsset);
    if (music && plan.audio.musicVolume <= 0) throw new Error("musicVolume harus lebih besar dari 0 ketika musicAsset digunakan.");

    const built = buildFilterGraph({
      segments,
      plan,
      dimensions,
      duration,
      hasAudio: source.hasAudio,
      music,
      captionsPath
    });
    const args = ["-hide_banner", "-y", "-i", sourcePath];
    if (music) args.push("-stream_loop", "-1", "-i", music.path);
    args.push(
      "-filter_complex_threads", "1",
      "-filter_complex", built.graph,
      "-map", "[vout]"
    );
    if (built.hasOutputAudio) args.push("-map", "[aout]");
    else args.push("-an");
    args.push(
      "-t", numberText(duration),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "19",
      "-pix_fmt", "yuv420p",
      "-r", String(plan.output.fps),
      "-metadata", "title=" + plan.title,
      "-movflags", "+faststart"
    );
    if (built.hasOutputAudio) args.push("-c:a", "aac", "-b:a", "192k");
    args.push("-progress", "pipe:1", "-nostats", outputPath);

    onProgress?.(1);
    await runFfmpeg(args, duration, onProgress);

    const output = await probeVideo(outputPath);
    if (output.videoCodec !== "h264" || output.width !== dimensions.width || output.height !== dimensions.height) {
      throw new Error("Hasil MP4 gagal validasi codec atau resolusi.");
    }
    if (Math.abs(output.fps - plan.output.fps) > 0.1) throw new Error("Frame rate hasil tidak sesuai dengan JSON.");
    if (Math.abs(output.duration - duration) > 0.45) throw new Error("Durasi hasil MP4 berbeda dari timeline yang direncanakan.");
    if (built.hasOutputAudio && !output.hasAudio) throw new Error("Track audio hilang dari hasil MP4.");

    await execCapture("ffmpeg", [
      "-v", "error", "-xerror", "-i", outputPath, "-f", "null", "-"
    ], { timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
    const outputStat = await stat(outputPath);
    return {
      duration: output.duration,
      width: output.width,
      height: output.height,
      fps: output.fps,
      sizeBytes: outputStat.size,
      segmentCount: segments.length,
      removedSilenceSeconds: Math.max(0, source.duration - segments.reduce((sum, item) => sum + (item.end - item.start), 0)),
      hasAudio: output.hasAudio,
      title: plan.title,
      warnings: []
    };
  } finally {
    // Work files such as timed caption overlays are temporary; the master MP4 remains.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
