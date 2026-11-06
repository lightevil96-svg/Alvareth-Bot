// Storyboard authoring is performed by the AI model chosen by the operator.
// This module only parses, normalizes and validates JSON; it never calls an LLM.

const PALETTES = [
  { background: "#111827", accent: "#68DDB8" },
  { background: "#20152F", accent: "#F0B86B" },
  { background: "#122B35", accent: "#F18A70" },
  { background: "#F1EFE8", accent: "#263B56" },
  { background: "#0D1B2A", accent: "#76B7F0" },
  { background: "#30211C", accent: "#E7C98D" }
];

const ALLOWED = {
  category: ["educational", "explainer", "product", "story", "announcement", "tutorial", "documentary", "finance", "other"],
  ratio: ["9:16", "16:9", "1:1"],
  fps: [24, 25, 30],
  musicStyle: ["cinematic", "upbeat", "calm", "none"],
  layout: ["hero", "editorial", "split", "stat", "quote", "steps", "outro"],
  motif: ["rings", "orbit", "wave", "grid", "bars", "ribbon", "spark", "none"],
  motion: ["fade-up", "scale-in", "slide-left", "slide-right", "reveal", "float", "count-up"],
  transition: ["cut", "fade", "crossfade", "wipe", "wipe-left", "wipe-right", "wipe-up", "wipe-down", "slide", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "glitch", "dissolve", "flash", "dip-to-black"],
  soundCue: ["none", "whoosh", "pop", "impact", "swish", "click", "chime", "thump", "sparkle", "riser"],
  visualType: ["cinematic", "kinetic", "editorial", "data-chart", "diagram", "app-mockup", "waveform"],
  backgroundEffect: ["none", "orbs", "particles", "grid", "waves", "dots", "vignette"],
  cameraMotion: ["static", "push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "tilt-down", "drift"],
  colorGrade: ["neutral", "warm", "cool", "film", "vivid", "mono"],
  captionStyle: ["tiktok", "karaoke", "subtitle", "pop", "typewriter", "highlight", "wave"]
};

function cleanText(value, maxLength) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maxLength);
}
function pick(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}
function wordCount(value) {
  const text = cleanText(value, 5000);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
function estimateDuration(scene) {
  const narrationWords = wordCount(scene.narration);
  const screenWords = wordCount(scene.text || scene.onScreenText) + wordCount(scene.subtext);
  const narrationTime = narrationWords ? narrationWords / 2.55 + 0.9 : 0;
  const readingTime = screenWords ? screenWords / 3.1 + 1.1 : 0;
  const layoutFloor = scene.layout === "quote" ? 4.2 : scene.layout === "stat" ? 3.6 : 2.5;
  return Math.max(2.4, narrationTime, readingTime, layoutFloor);
}
function inferRequestedDuration(prompt) {
  const text = String(prompt || "").toLowerCase().replace(",", ".");
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:menit|minutes?|mins?)\b/i);
  if (minutes) return Math.round(Number(minutes[1]) * 60);
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*(?:detik|seconds?|secs?)\b/i);
  if (seconds) return Math.round(Number(seconds[1]));
  return null;
}
export function parseJsonResponse(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value || "").trim();
  const fence = String.fromCharCode(96).repeat(3);
  const fenceStart = text.indexOf(fence);
  const fenceEnd = fenceStart >= 0 ? text.indexOf(fence, fenceStart + 3) : -1;
  const candidate = fenceStart >= 0 && fenceEnd > fenceStart ? text.slice(fenceStart + 3, fenceEnd).replace(/^json\s*/i, "").trim() : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON storyboard tidak ditemukan. Tempel objek JSON yang dibuat ChatGPT.");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error("Format JSON storyboard tidak valid. Periksa tanda kutip, koma, dan kurung.");
  }
}
function fitDurations(scenes, targetSeconds) {
  const minimums = scenes.map(scene => Math.max(2.4, estimateDuration(scene)));
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  const maximumTotal = scenes.length * 20;

  if (minimums.some(value => value > 20)) {
    throw new Error("Ada scene dengan narasi atau teks yang melebihi batas 20 detik. Ringkas isi scene tersebut.");
  }
  if (targetSeconds < minimumTotal - 0.01) {
    throw new Error(
      "Durasi target " + targetSeconds + " detik terlalu pendek untuk seluruh narasi dan teks. " +
      "Storyboard membutuhkan sedikitnya sekitar " + (Math.ceil(minimumTotal * 10) / 10) +
      " detik. Ringkas narasi atau tambah durasi video."
    );
  }
  if (targetSeconds > maximumTotal) {
    throw new Error("Durasi target terlalu panjang untuk jumlah scene. Tambahkan scene atau kurangi durasi total.");
  }

  const base = scenes.map((scene, index) =>
    Math.min(20, Math.max(minimums[index], Number(scene.durationSeconds) || minimums[index]))
  );
  const baseTotal = base.reduce((sum, value) => sum + value, 0);
  let values = base.slice();

  if (baseTotal > targetSeconds) {
    const flexible = baseTotal - minimumTotal;
    const ratio = flexible > 0 ? Math.max(0, (targetSeconds - minimumTotal) / flexible) : 0;
    values = base.map((value, index) => minimums[index] + (value - minimums[index]) * ratio);
  } else if (baseTotal < targetSeconds) {
    let remaining = targetSeconds - baseTotal;
    for (let pass = 0; pass < 60 && remaining > 0.005; pass++) {
      const eligible = values.map((value, index) => ({ value, index }))
        .filter(item => item.value < 20 - 0.001);
      if (!eligible.length) break;
      const share = remaining / eligible.length;
      for (const item of eligible) {
        const added = Math.min(20 - values[item.index], share);
        values[item.index] += added;
        remaining -= added;
      }
    }
    if (remaining > 0.05) {
      throw new Error("Durasi target tidak dapat dibagi ke scene tanpa melampaui batas 20 detik per scene.");
    }
  }

  const rounded = values.map(value => Math.round(value * 100) / 100);
  const correction = Math.round((targetSeconds - rounded.reduce((sum, value) => sum + value, 0)) * 100) / 100;
  if (Math.abs(correction) >= 0.01) {
    for (let index = rounded.length - 1; index >= 0; index--) {
      const adjusted = rounded[index] + correction;
      if (adjusted >= minimums[index] - 0.01 && adjusted <= 20.01) {
        rounded[index] = Math.round(adjusted * 100) / 100;
        break;
      }
    }
  }

  return scenes.map((scene, index) => ({ ...scene, durationSeconds: rounded[index] }));
}

export function normalizeVideoPlan(raw, sourcePrompt) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Storyboard AI tidak berbentuk objek.");
  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  if (rawScenes.length < 1 || rawScenes.length > 60) throw new Error("Storyboard harus berisi 1 sampai 60 scene.");
  const prompt = cleanText(sourcePrompt, 6000);
  const category = pick(raw.category, ALLOWED.category, "explainer");
  const palette = PALETTES[category === "product" ? 2 : category === "finance" ? 4 : category === "story" ? 1 : category === "educational" ? 3 : 0];
  const title = cleanText(raw.title, 100) || cleanText(prompt, 70) || "Video Baru";
  const language = cleanText(raw.language, 12) || "id";
  const ratio = pick(raw.ratio, ALLOWED.ratio, /youtube|landscape|horizontal|presentasi/i.test(prompt) ? "16:9" : "9:16");
  const fps = ALLOWED.fps.includes(Number(raw.fps)) ? Number(raw.fps) : 30;
  const musicStyle = pick(raw.musicStyle, ALLOWED.musicStyle, "none");
  const captionStyle = pick(raw.captionStyle, ALLOWED.captionStyle, category === "documentary" || category === "educational" ? "subtitle" : "tiktok");
  const creativeBrief = {
    coreMessage: cleanText(raw.creativeBrief && raw.creativeBrief.coreMessage, 300) || title,
    hook: cleanText(raw.creativeBrief && raw.creativeBrief.hook, 220),
    tone: cleanText(raw.creativeBrief && raw.creativeBrief.tone, 120),
    visualDirection: cleanText(raw.creativeBrief && raw.creativeBrief.visualDirection, 300),
    ending: cleanText(raw.creativeBrief && raw.creativeBrief.ending, 220)
  };
  const visualSource = raw.visualBible && typeof raw.visualBible === "object" ? raw.visualBible : {};
  const visualBible = {
    artStyle: cleanText(visualSource.artStyle, 180),
    palette: cleanText(visualSource.palette, 180),
    lighting: cleanText(visualSource.lighting, 180),
    cameraLanguage: cleanText(visualSource.cameraLanguage, 180),
    texture: cleanText(visualSource.texture, 180),
    compositionRules: cleanText(visualSource.compositionRules, 240)
  };
  const characterSource = raw.characterBible && typeof raw.characterBible === "object" ? raw.characterBible : null;
  const characterBible = characterSource ? {
    name: cleanText(characterSource.name, 80),
    type: cleanText(characterSource.type, 100),
    silhouette: cleanText(characterSource.silhouette, 180),
    face: cleanText(characterSource.face, 180),
    hairOrFur: cleanText(characterSource.hairOrFur, 180),
    outfit: cleanText(characterSource.outfit, 180),
    colors: cleanText(characterSource.colors, 140),
    accessories: cleanText(characterSource.accessories, 140),
    personality: cleanText(characterSource.personality, 140),
    continuityRules: Array.isArray(characterSource.continuityRules)
      ? characterSource.continuityRules.slice(0, 8).map(item => cleanText(item, 160)).filter(Boolean)
      : []
  } : null;
  let scenes = rawScenes.map((source, index) => {
    const scene = source && typeof source === "object" ? source : {};
    const text = cleanText(scene.text || scene.onScreenText, 180);
    if (!text) throw new Error("Teks utama scene " + (index + 1) + " kosong.");
    const background = /^#[0-9a-f]{6}$/i.test(String(scene.background || "")) ? scene.background : (raw.palette && /^#[0-9a-f]{6}$/i.test(String(raw.palette.background || "")) ? raw.palette.background : palette.background);
    const accent = /^#[0-9a-f]{6}$/i.test(String(scene.accent || "")) ? scene.accent : (raw.palette && /^#[0-9a-f]{6}$/i.test(String(raw.palette.accent || "")) ? raw.palette.accent : palette.accent);
    const narration = cleanText(scene.narration, 1200);
    const estimate = estimateDuration({ ...scene, text, narration });
    if (estimate > 20) {
      throw new Error("Narasi atau teks scene " + (index + 1) + " terlalu panjang untuk batas 20 detik. Ringkas scene tersebut.");
    }
    const modelDuration = Number(scene.durationSeconds || scene.duration);
    const durationSeconds = Math.min(20, Math.max(2.4, Number.isFinite(modelDuration) && modelDuration > 0 ? Math.max(estimate, modelDuration) : estimate));
    const points = Array.isArray(scene.points) ? scene.points.slice(0, 4).map(point => cleanText(point, 90)).filter(Boolean) : [];
    return {
      id: cleanText(scene.id, 40) || "scene-" + String(index + 1).padStart(2, "0"),
      purpose: cleanText(scene.purpose, 50) || "story",
      durationSeconds: Math.round(durationSeconds * 100) / 100,
      layout: pick(scene.layout, ALLOWED.layout, index === 0 ? "hero" : index === rawScenes.length - 1 ? "outro" : "editorial"),
      motif: pick(scene.motif, ALLOWED.motif, ["rings", "wave", "grid", "orbit", "bars", "ribbon", "spark"][index % 7]),
      motion: pick(scene.motion, ALLOWED.motion, ["fade-up", "scale-in", "slide-left", "reveal", "float"][index % 5]),
      transition: pick(scene.transition, ALLOWED.transition, index === 0 ? "fade" : "wipe"),
      kicker: cleanText(scene.kicker, 60),
      text,
      highlight: cleanText(scene.highlight, 70),
      subtext: cleanText(scene.subtext, 220),
      points,
      narration,
      visualDescription: cleanText(scene.visualDescription, 400),
      generateAiFootage: scene.generateAiFootage === true,
      aiVideoPrompt: cleanText(scene.aiVideoPrompt, 1800),
      visualType: pick(scene.visualType, ALLOWED.visualType, scene.layout === "stat" ? "data-chart" : scene.layout === "steps" ? "diagram" : "cinematic"),
      backgroundEffect: pick(scene.backgroundEffect, ALLOWED.backgroundEffect, scene.footageSrc ? "vignette" : ["orbs", "particles", "grid", "waves"][index % 4]),
      cameraMotion: pick(scene.cameraMotion, ALLOWED.cameraMotion, ["push-in", "drift", "pan-left", "static"][index % 4]),
      colorGrade: pick(scene.colorGrade, ALLOWED.colorGrade, "neutral"),
      chartTitle: cleanText(scene.chartTitle, 100),
      chartUnit: cleanText(scene.chartUnit, 20),
      chartSource: cleanText(scene.chartSource, 180),
      chartData: Array.isArray(scene.chartData) ? scene.chartData.slice(0, 8).map(item => ({ label: cleanText(item && item.label, 48), value: Number(item && item.value) })).filter(item => item.label && Number.isFinite(item.value) && item.value >= 0) : [],
      diagramNodes: Array.isArray(scene.diagramNodes) ? scene.diagramNodes.slice(0, 7).map((item, nodeIndex) => ({ id: cleanText(item && item.id, 32) || "node-" + (nodeIndex + 1), label: cleanText(item && item.label, 64), x: Number.isFinite(Number(item && item.x)) ? Number(item.x) : null, y: Number.isFinite(Number(item && item.y)) ? Number(item.y) : null })).filter(item => item.label) : [],
      diagramEdges: Array.isArray(scene.diagramEdges) ? scene.diagramEdges.slice(0, 10).map(item => ({ from: cleanText(item && item.from, 32), to: cleanText(item && item.to, 32), label: cleanText(item && item.label, 48) })).filter(item => item.from && item.to) : [],
      appMockup: scene.appMockup && typeof scene.appMockup === "object" ? { title: cleanText(scene.appMockup.title, 80), rows: Array.isArray(scene.appMockup.rows) ? scene.appMockup.rows.slice(0, 5).map(item => cleanText(item, 64)).filter(Boolean) : [], cta: cleanText(scene.appMockup.cta, 48) } : null,
      notifications: Array.isArray(scene.notifications) ? scene.notifications.slice(0, 3).map(item => ({ sender: cleanText(item && item.sender, 48), text: cleanText(item && item.text, 120), delaySeconds: Math.max(0, Math.min(18, Number(item && item.delaySeconds) || 0)), durationSeconds: Math.max(0.8, Math.min(8, Number(item && item.durationSeconds) || 2.6)) })).filter(item => item.text) : [],
      callouts: Array.isArray(scene.callouts) ? scene.callouts.slice(0, 3).map(item => ({ text: cleanText(item && item.text, 90), position: pick(item && item.position, ["top", "center", "bottom"], "bottom"), delaySeconds: Math.max(0, Math.min(18, Number(item && item.delaySeconds) || 0)), durationSeconds: Math.max(0.8, Math.min(8, Number(item && item.durationSeconds) || 2)) })).filter(item => item.text) : [],
      soundIntensity: Math.max(0, Math.min(1, Number(scene.soundIntensity ?? 0.55))),
      background,
      accent,
      soundCue: pick(scene.soundCue, ALLOWED.soundCue, index === 0 ? "whoosh" : "none")
    };
  });
  const requested = Number(raw.targetDurationSeconds) > 0 ? Number(raw.targetDurationSeconds) : inferRequestedDuration(prompt);
  if (requested && requested > 300) throw new Error("Durasi maksimum satu video saat ini 5 menit. Pecah topik menjadi beberapa bagian.");
  if (requested && requested > 0) scenes = fitDurations(scenes, requested);
  const totalDurationSeconds = Math.round(scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) * 100) / 100;
  if (totalDurationSeconds > 300) throw new Error("Storyboard melebihi batas render 5 menit. Ringkas prompt atau bagi menjadi beberapa video.");
  return {
    schemaVersion: 1,
    sourcePrompt: prompt,
    title,
    language,
    category,
    ratio,
    fps,
    targetDurationSeconds: requested || null,
    musicStyle,
    captionStyle,
    musicDirection: cleanText(raw.musicDirection, 240),
    soundEffects: raw.soundEffects !== false,
    creativeBrief,
    visualBible,
    characterBible,
    scenes,
    totalDurationSeconds
  };
}

export function parseStoryboardInput(input) {
  const rawText = String(input == null ? "" : input).replace(/\x00/g, "").trim();
  if (rawText.length < 8) {
    const error = new Error("Tempel JSON storyboard lengkap yang dibuat ChatGPT.");
    error.statusCode = 400;
    throw error;
  }
  if (rawText.length > 24000) {
    const error = new Error("JSON storyboard melebihi batas 24.000 karakter. Minta ChatGPT membuat storyboard yang lebih ringkas.");
    error.statusCode = 413;
    throw error;
  }

  let raw;
  try {
    raw = parseJsonResponse(rawText);
  } catch {
    const error = new Error(
      "Input harus berupa JSON storyboard dari ChatGPT, bukan brief teks biasa. " +
      "Gunakan panduan prompt-remotion.md atau ketik .remotion guide."
    );
    error.statusCode = 400;
    throw error;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const error = new Error("Storyboard harus berupa satu objek JSON.");
    error.statusCode = 400;
    throw error;
  }
  if (Number(raw.schemaVersion) !== 1) {
    const error = new Error("Field schemaVersion wajib bernilai 1. Gunakan format pada prompt-remotion.md.");
    error.statusCode = 400;
    throw error;
  }
  if (!Array.isArray(raw.scenes) || raw.scenes.length < 1) {
    const error = new Error("Field scenes wajib berupa array yang berisi minimal satu scene.");
    error.statusCode = 400;
    throw error;
  }

  const sourcePrompt = cleanText(
    raw.sourcePrompt || raw.brief || (raw.creativeBrief && raw.creativeBrief.coreMessage) || raw.title,
    6000
  );
  if (sourcePrompt.length < 8) {
    const error = new Error("Field sourcePrompt wajib berisi brief asli minimal 8 karakter.");
    error.statusCode = 400;
    throw error;
  }

  return normalizeVideoPlan(raw, sourcePrompt);
}
