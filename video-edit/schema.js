const RATIOS = Object.freeze({
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350]
});
const FPS_VALUES = new Set([24, 25, 30, 50, 60]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error("Field " + label + "." + key + " tidak didukung. Hapus field tersebut dari JSON.");
    }
  }
}

function boundedNumber(value, fallback, min, max, label) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(label + " harus berupa angka " + min + " sampai " + max + ".");
  }
  return number;
}

function boundedBoolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(label + " harus true atau false.");
  return value;
}

export function normalizeEditSettings(input = {}) {
  const source = isRecord(input) ? input : {};
  const ratio = Object.hasOwn(RATIOS, source.ratio) ? source.ratio : "9:16";
  const duration = Number(source.maxDurationSeconds);
  return {
    ratio,
    maxDurationSeconds: Number.isFinite(duration) ? Math.max(5, Math.min(180, Math.round(duration))) : 60,
    removeSilence: source.removeSilence !== false
  };
}

export function getOutputDimensions(output = {}) {
  const ratio = Object.hasOwn(RATIOS, output.ratio) ? output.ratio : "9:16";
  const [baseWidth, baseHeight] = RATIOS[ratio];
  if (output.resolution === "720p") {
    const scale = 720 / Math.max(baseWidth, baseHeight);
    return {
      width: Math.max(2, Math.round(baseWidth * scale / 2) * 2),
      height: Math.max(2, Math.round(baseHeight * scale / 2) * 2)
    };
  }
  return { width: baseWidth, height: baseHeight };
}

export function createDefaultEditPlan(settings = {}) {
  const normalized = normalizeEditSettings(settings);
  return {
    schemaVersion: 1,
    title: "Alvareth Short Edit",
    output: {
      ratio: normalized.ratio,
      resolution: "1080p",
      fps: 30,
      maxDurationSeconds: normalized.maxDurationSeconds
    },
    edit: {
      removeSilence: normalized.removeSilence,
      silenceThresholdDb: -35,
      minSilenceSeconds: 0.55,
      keepPaddingSeconds: 0.12,
      fadeInSeconds: 0.15,
      fadeOutSeconds: 0.25,
      segments: []
    },
    captions: {
      enabled: false,
      style: "subtitle",
      items: []
    },
    audio: {
      normalize: true,
      originalVolume: 1,
      musicAsset: "none",
      musicVolume: 0
    }
  };
}

export function validateEditPlan(input, options = {}) {
  let parsed = input;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      throw new Error("JSON tidak valid: " + error.message);
    }
  }
  if (!isRecord(parsed)) throw new Error("Storyboard edit harus berupa satu objek JSON.");
  assertKeys(parsed, ["schemaVersion", "title", "output", "edit", "captions", "audio"], "root");
  if (parsed.schemaVersion !== 1) throw new Error("schemaVersion wajib bernilai 1.");

  const settings = normalizeEditSettings(options.settings || {});
  const output = parsed.output === undefined ? {} : parsed.output;
  const edit = parsed.edit === undefined ? {} : parsed.edit;
  const captions = parsed.captions === undefined ? {} : parsed.captions;
  const audio = parsed.audio === undefined ? {} : parsed.audio;
  if (!isRecord(output) || !isRecord(edit) || !isRecord(captions) || !isRecord(audio)) {
    throw new Error("output, edit, captions, dan audio harus berupa objek JSON.");
  }

  assertKeys(output, ["ratio", "resolution", "fps", "maxDurationSeconds"], "output");
  assertKeys(edit, ["removeSilence", "silenceThresholdDb", "minSilenceSeconds", "keepPaddingSeconds", "fadeInSeconds", "fadeOutSeconds", "segments"], "edit");
  assertKeys(captions, ["enabled", "style", "items"], "captions");
  assertKeys(audio, ["normalize", "originalVolume", "musicAsset", "musicVolume"], "audio");

  const ratio = output.ratio === undefined ? settings.ratio : output.ratio;
  if (!Object.hasOwn(RATIOS, ratio)) throw new Error("output.ratio harus 9:16, 16:9, 1:1, atau 4:5.");
  const resolution = output.resolution === undefined ? "1080p" : output.resolution;
  if (!["1080p", "720p"].includes(resolution)) throw new Error("output.resolution hanya mendukung 1080p atau 720p.");
  const fps = output.fps === undefined ? 30 : Number(output.fps);
  if (!FPS_VALUES.has(fps)) throw new Error("output.fps harus 24, 25, 30, 50, atau 60.");
  const maxDurationSeconds = boundedNumber(
    output.maxDurationSeconds,
    settings.maxDurationSeconds,
    5,
    180,
    "output.maxDurationSeconds"
  );

  const removeSilence = boundedBoolean(edit.removeSilence, settings.removeSilence, "edit.removeSilence");
  const silenceThresholdDb = boundedNumber(edit.silenceThresholdDb, -35, -60, -20, "edit.silenceThresholdDb");
  const minSilenceSeconds = boundedNumber(edit.minSilenceSeconds, 0.55, 0.3, 5, "edit.minSilenceSeconds");
  const keepPaddingSeconds = boundedNumber(edit.keepPaddingSeconds, 0.12, 0, 0.5, "edit.keepPaddingSeconds");
  const fadeInSeconds = boundedNumber(edit.fadeInSeconds, 0.15, 0, 2, "edit.fadeInSeconds");
  const fadeOutSeconds = boundedNumber(edit.fadeOutSeconds, 0.25, 0, 2, "edit.fadeOutSeconds");

  const rawSegments = edit.segments === undefined ? [] : edit.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length > 40) {
    throw new Error("edit.segments harus berupa array dengan maksimal 40 segmen.");
  }
  const sourceDuration = Number(options.sourceDuration);
  let previousEnd = -1;
  const segments = rawSegments.map((item, index) => {
    if (!isRecord(item)) throw new Error("edit.segments[" + index + "] harus berupa objek.");
    assertKeys(item, ["start", "end", "speed"], "edit.segments[" + index + "]");
    const start = boundedNumber(item.start, NaN, 0, 900, "Segmen " + (index + 1) + " start");
    const end = boundedNumber(item.end, NaN, 0.01, 900, "Segmen " + (index + 1) + " end");
    const speed = boundedNumber(item.speed, 1, 0.5, 2, "Segmen " + (index + 1) + " speed");
    if (end <= start) throw new Error("Segmen " + (index + 1) + " harus memiliki end lebih besar dari start.");
    if (start < previousEnd - 0.001) throw new Error("edit.segments harus berurutan dan tidak saling tumpang tindih.");
    if (Number.isFinite(sourceDuration) && end > sourceDuration + 0.05) {
      throw new Error("Segmen " + (index + 1) + " melewati durasi video sumber (" + sourceDuration.toFixed(2) + " detik).");
    }
    previousEnd = end;
    return { start, end, speed };
  });

  const captionsEnabled = boundedBoolean(captions.enabled, false, "captions.enabled");
  const captionStyle = captions.style === undefined ? "subtitle" : captions.style;
  if (!["subtitle", "bold"].includes(captionStyle)) throw new Error("captions.style hanya mendukung subtitle atau bold.");
  const rawCaptionItems = captions.items === undefined ? [] : captions.items;
  if (!Array.isArray(rawCaptionItems) || rawCaptionItems.length > 200) {
    throw new Error("captions.items harus berupa array dengan maksimal 200 item.");
  }
  const captionItems = rawCaptionItems.map((item, index) => {
    if (!isRecord(item)) throw new Error("captions.items[" + index + "] harus berupa objek.");
    assertKeys(item, ["start", "end", "text"], "captions.items[" + index + "]");
    const start = boundedNumber(item.start, NaN, 0, maxDurationSeconds, "Caption " + (index + 1) + " start");
    const end = boundedNumber(item.end, NaN, 0.01, maxDurationSeconds, "Caption " + (index + 1) + " end");
    const text = typeof item.text === "string" ? item.text.replace(/\u0000/g, "").trim().slice(0, 160) : "";
    if (end <= start || !text) throw new Error("Caption " + (index + 1) + " harus memiliki waktu valid dan teks.");
    return { start, end, text };
  });

  if (captionsEnabled && !captionItems.length) {
    throw new Error("captions.enabled true memerlukan minimal satu item caption bertiming.");
  }

  const normalize = boundedBoolean(audio.normalize, true, "audio.normalize");
  const originalVolume = boundedNumber(audio.originalVolume, 1, 0, 2, "audio.originalVolume");
  const musicVolume = boundedNumber(audio.musicVolume, 0, 0, 0.5, "audio.musicVolume");
  const musicAsset = audio.musicAsset === undefined ? "none" : audio.musicAsset;
  if (typeof musicAsset !== "string" || !/^(none|[a-z0-9][a-z0-9_-]{0,63})$/i.test(musicAsset)) {
    throw new Error("audio.musicAsset harus none atau ID aset musik lokal yang valid; URL dan path tidak diperbolehkan.");
  }

  const title = typeof parsed.title === "string"
    ? parsed.title.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Alvareth Short Edit"
    : "Alvareth Short Edit";

  return {
    schemaVersion: 1,
    title,
    output: { ratio, resolution, fps, maxDurationSeconds },
    edit: {
      removeSilence,
      silenceThresholdDb,
      minSilenceSeconds,
      keepPaddingSeconds,
      fadeInSeconds,
      fadeOutSeconds,
      segments
    },
    captions: { enabled: captionsEnabled, style: captionStyle, items: captionItems },
    audio: { normalize, originalVolume, musicAsset, musicVolume }
  };
}
