const RATIOS = Object.freeze({
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 }
});
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MUSIC_STYLES = ["cinematic", "upbeat", "calm", "none"];
const LAYOUTS = ["hero", "editorial", "split", "stat", "quote", "steps", "outro"];
const MOTIFS = ["rings", "orbit", "wave", "grid", "bars", "ribbon", "spark", "none"];
const MOTIONS = ["fade-up", "scale-in", "slide-left", "slide-right", "reveal", "float", "count-up"];
const TRANSITIONS = ["cut", "fade", "wipe", "slide", "zoom"];
const SOUND_CUES = ["none", "whoosh", "pop", "impact"];
const PALETTES = [
  { background: "#111827", accent: "#68DDB8" },
  { background: "#20152F", accent: "#F0B86B" },
  { background: "#122B35", accent: "#F18A70" },
  { background: "#F1EFE8", accent: "#263B56" },
  { background: "#0D1B2A", accent: "#76B7F0" },
  { background: "#30211C", accent: "#E7C98D" }
];

function text(value, max) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max);
}
function assetPath(value) {
  const candidate = text(value, 220);
  if (!candidate || candidate.startsWith("/") || candidate.includes("..") || candidate.includes("\\") || !/^[a-zA-Z0-9._/-]+$/.test(candidate)) return "";
  return candidate;
}
function pexelsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && (url.hostname === "pexels.com" || url.hostname.endsWith(".pexels.com")) ? url.toString().slice(0, 240) : "";
  } catch { return ""; }
}
function estimateDuration(scene) {
  const narration = text(scene.narration, 1200);
  const visible = text(scene.text || scene.onScreenText, 180) + " " + text(scene.subtext, 220);
  const narrationSeconds = narration ? narration.split(/\s+/).length / 2.55 + 0.9 : 0;
  const readingSeconds = visible.trim() ? visible.trim().split(/\s+/).length / 3.1 + 1.1 : 0;
  return Math.max(2.4, narrationSeconds, readingSeconds);
}
function normalizeCaptions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 1800).map(group => {
    if (!group || typeof group !== "object") return null;
    const startSeconds = Number(group.startSeconds);
    const endSeconds = Number(group.endSeconds);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > 301) return null;
    const words = Array.isArray(group.words) ? group.words.slice(0, 8).map(word => {
      const start = Number(word?.startSeconds);
      const end = Number(word?.endSeconds);
      const value = text(word?.text, 48);
      if (!value || !Number.isFinite(start) || !Number.isFinite(end) || start < startSeconds - 0.1 || end > endSeconds + 0.1 || end <= start) return null;
      return { text: value, startSeconds: start, endSeconds: end };
    }).filter(Boolean) : [];
    if (!words.length) return null;
    return { startSeconds, endSeconds, words };
  }).filter(Boolean);
}

export function validateVideoProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Data proyek harus berupa objek.");
  const title = text(input.title || "Video LightJurnal", 100);
  const mode = input.mode === "professional" ? "professional" : "simple";
  const ratio = Object.hasOwn(RATIOS, input.ratio) ? input.ratio : "9:16";
  const fps = Number(input.fps || 30);
  if (![24, 25, 30].includes(fps)) throw new Error("FPS yang didukung: 24, 25, atau 30.");
  const musicStyle = MUSIC_STYLES.includes(input.musicStyle) ? input.musicStyle : "cinematic";
  const soundEffects = input.soundEffects !== false;
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (rawScenes.length < 1 || rawScenes.length > 60) throw new Error("Proyek harus memiliki 1 sampai 60 scene.");
  let sequentialCursor = 0;
  let maxEndFrame = 0;
  const scenes = rawScenes.map((scene, index) => {
    if (!scene || typeof scene !== "object") throw new Error("Scene " + (index + 1) + " tidak valid.");
    const sceneText = text(scene.text || scene.onScreenText, 180);
    if (!sceneText) throw new Error("Teks scene " + (index + 1) + " tidak boleh kosong.");
    const candidateDuration = Number(scene.duration || scene.durationSeconds);
    const duration = Number.isFinite(candidateDuration) && candidateDuration > 0 ? candidateDuration : estimateDuration({ ...scene, text: sceneText });
    if (!Number.isFinite(duration) || duration < 1 || duration > 20) throw new Error("Durasi scene " + (index + 1) + " harus 1–20 detik.");
    const explicitStart = Number(scene.startSeconds);
    const startSeconds = Number.isFinite(explicitStart) && explicitStart >= 0 && explicitStart <= 300 ? explicitStart : sequentialCursor;
    const startFrame = Math.max(0, Math.round(startSeconds * fps));
    const durationFrames = Math.max(1, Math.round(duration * fps));
    maxEndFrame = Math.max(maxEndFrame, startFrame + durationFrames);
    sequentialCursor = startSeconds + duration;
    const palette = PALETTES[index % PALETTES.length];
    const background = HEX_COLOR.test(String(scene.background || "")) ? scene.background : palette.background;
    const accent = HEX_COLOR.test(String(scene.accent || "")) ? scene.accent : palette.accent;
    const points = Array.isArray(scene.points) ? scene.points.slice(0, 4).map(item => text(item, 90)).filter(Boolean) : [];
    const footageSrc = assetPath(scene.footageSrc);
    const footageCredit = footageSrc ? text(scene.footageCredit, 90) : "";
    const footageUrl = footageSrc ? pexelsUrl(scene.footageUrl) : "";
    return {
      id: text(scene.id, 40) || "scene-" + String(index + 1).padStart(2, "0"),
      purpose: text(scene.purpose, 50) || "story",
      text: sceneText,
      duration,
      ...(Number.isFinite(explicitStart) && explicitStart >= 0 && explicitStart <= 300 ? { startSeconds } : {}),
      kicker: text(scene.kicker, 60),
      highlight: text(scene.highlight, 70),
      subtext: text(scene.subtext, 220),
      points,
      narration: text(scene.narration, 1200),
      visualDescription: text(scene.visualDescription, 400),
      layout: LAYOUTS.includes(scene.layout) ? scene.layout : index === 0 ? "hero" : index === rawScenes.length - 1 ? "outro" : "editorial",
      motif: MOTIFS.includes(scene.motif) ? scene.motif : ["rings", "wave", "grid", "orbit", "bars", "ribbon"][index % 6],
      motion: MOTIONS.includes(scene.motion) ? scene.motion : ["fade-up", "scale-in", "slide-left", "reveal"][index % 4],
      transition: TRANSITIONS.includes(scene.transition) ? scene.transition : index === 0 ? "fade" : "wipe",
      soundCue: SOUND_CUES.includes(scene.soundCue) ? scene.soundCue : "none",
      background,
      accent,
      ...(footageSrc ? { footageSrc, footageCredit, footageUrl } : {})
    };
  });
  const durationInFrames = Math.max(1, maxEndFrame);
  const durationSeconds = Math.round(durationInFrames / fps * 100) / 100;
  if (durationSeconds > 300) throw new Error("Durasi total proyek maksimal 300 detik (5 menit).");
  const dimensions = RATIOS[ratio];
  const creativeBrief = input.creativeBrief && typeof input.creativeBrief === "object" ? {
    coreMessage: text(input.creativeBrief.coreMessage, 300),
    hook: text(input.creativeBrief.hook, 220),
    tone: text(input.creativeBrief.tone, 120),
    visualDirection: text(input.creativeBrief.visualDirection, 300),
    ending: text(input.creativeBrief.ending, 220)
  } : {};
  const voiceoverTracks = Array.isArray(input.voiceoverTracks) ? input.voiceoverTracks.slice(0, 30).map(track => {
    const src = assetPath(track?.src);
    const startSeconds = Number(track?.startSeconds);
    const trackDuration = Number(track?.durationSeconds);
    if (!src || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(trackDuration) || trackDuration <= 0 || trackDuration > 300) return null;
    return { src, startSeconds, durationSeconds: trackDuration };
  }).filter(Boolean) : [];
  const captions = normalizeCaptions(input.captions);
  const mediaCredits = Array.isArray(input.mediaCredits) ? input.mediaCredits.slice(0, 20).map(item => ({
    provider: item?.provider === "Pexels" ? "Pexels" : "",
    photographer: text(item?.photographer, 90),
    photographerUrl: pexelsUrl(item?.photographerUrl),
    videoUrl: pexelsUrl(item?.videoUrl)
  })).filter(item => item.provider && item.photographer) : [];
  const mediaWarnings = Array.isArray(input.mediaWarnings) ? input.mediaWarnings.slice(0, 12).map(item => text(item, 200)).filter(Boolean) : [];
  return {
    title, mode, ratio, width: dimensions.width, height: dimensions.height, fps,
    scenes, musicStyle, soundEffects, durationSeconds, durationInFrames,
    sourcePrompt: text(input.sourcePrompt, 6000),
    planSummary: text(input.planSummary, 300),
    creativeBrief,
    voiceoverTracks,
    captions,
    mediaCredits,
    mediaWarnings,
    footageCount: scenes.filter(scene => scene.footageSrc).length
  };
}

export function getVideoStudioLimits() {
  return {
    ratios: Object.keys(RATIOS),
    fps: [24, 25, 30],
    maxScenes: 60,
    maxSceneSeconds: 20,
    maxDurationSeconds: 300,
    musicStyles: MUSIC_STYLES
  };
}
