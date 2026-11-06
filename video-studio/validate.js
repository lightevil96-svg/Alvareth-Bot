import { normalizeVoiceSettings } from "./voice-settings.js";

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
const TRANSITIONS = ["cut", "fade", "crossfade", "wipe", "wipe-left", "wipe-right", "wipe-up", "wipe-down", "slide", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "glitch", "dissolve", "flash", "dip-to-black"];
const VISUAL_TYPES = ["cinematic", "kinetic", "editorial", "data-chart", "diagram", "app-mockup", "waveform"];
const BACKGROUND_EFFECTS = ["none", "orbs", "particles", "grid", "waves", "dots", "vignette"];
const CAMERA_MOTIONS = ["static", "push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "tilt-down", "drift"];
const COLOR_GRADES = ["neutral", "warm", "cool", "film", "vivid", "mono"];
const CAPTION_STYLES = ["tiktok", "karaoke", "subtitle", "pop", "typewriter", "highlight", "wave"];
const SOUND_CUES = ["none", "whoosh", "pop", "impact", "swish", "click", "chime", "thump", "sparkle", "riser"];
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
  const musicStyle = MUSIC_STYLES.includes(input.musicStyle) ? input.musicStyle : "none";
  const captionStyle = CAPTION_STYLES.includes(input.captionStyle) ? input.captionStyle : "tiktok";
  const captionPosition = ["top", "center", "bottom"].includes(input.captionPosition) ? input.captionPosition : "bottom";
  const musicTrackSrc = assetPath(input.musicTrackSrc);
  const musicBpm = Number.isFinite(Number(input.musicBpm)) && Number(input.musicBpm) >= 0 && Number(input.musicBpm) <= 240 ? Number(input.musicBpm) : 0;
  const musicVolume = Number.isFinite(Number(input.musicVolume)) ? Math.max(0, Math.min(0.5, Number(input.musicVolume))) : 0.16;
  const soundEffects = input.soundEffects !== false;
  const voiceSettings = normalizeVoiceSettings(input.voiceSettings);
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
    const chartData = Array.isArray(scene.chartData) ? scene.chartData.slice(0, 8).map(item => ({
      label: text(item?.label, 48),
      value: Number(item?.value)
    })).filter(item => item.label && Number.isFinite(item.value) && item.value >= 0 && item.value <= 1e12) : [];
    const diagramNodes = Array.isArray(scene.diagramNodes) ? scene.diagramNodes.slice(0, 7).map((item, nodeIndex) => ({
      id: text(item?.id, 32) || "node-" + (nodeIndex + 1),
      label: text(item?.label, 64),
      x: Number.isFinite(Number(item?.x)) ? Math.max(8, Math.min(92, Number(item.x))) : null,
      y: Number.isFinite(Number(item?.y)) ? Math.max(15, Math.min(85, Number(item.y))) : null
    })).filter(item => item.label) : [];
    const nodeIds = new Set(diagramNodes.map(item => item.id));
    const diagramEdges = Array.isArray(scene.diagramEdges) ? scene.diagramEdges.slice(0, 10).map(item => ({
      from: text(item?.from, 32),
      to: text(item?.to, 32),
      label: text(item?.label, 48)
    })).filter(item => nodeIds.has(item.from) && nodeIds.has(item.to) && item.from !== item.to) : [];
    const notifications = Array.isArray(scene.notifications) ? scene.notifications.slice(0, 3).map(item => ({
      sender: text(item?.sender, 48),
      text: text(item?.text, 120),
      delaySeconds: Math.max(0, Math.min(18, Number(item?.delaySeconds) || 0)),
      durationSeconds: Math.max(0.8, Math.min(8, Number(item?.durationSeconds) || 2.6))
    })).filter(item => item.text) : [];
    const callouts = Array.isArray(scene.callouts) ? scene.callouts.slice(0, 3).map(item => ({
      text: text(item?.text, 90),
      position: ["top", "center", "bottom"].includes(item?.position) ? item.position : "bottom",
      delaySeconds: Math.max(0, Math.min(18, Number(item?.delaySeconds) || 0)),
      durationSeconds: Math.max(0.8, Math.min(8, Number(item?.durationSeconds) || 2))
    })).filter(item => item.text) : [];
    const appMockup = scene.appMockup && typeof scene.appMockup === "object" ? {
      title: text(scene.appMockup.title, 80),
      rows: Array.isArray(scene.appMockup.rows) ? scene.appMockup.rows.slice(0, 5).map(item => text(item, 64)).filter(Boolean) : [],
      cta: text(scene.appMockup.cta, 48)
    } : null;
    const requestedVisualType = VISUAL_TYPES.includes(scene.visualType) ? scene.visualType : "cinematic";
    const visualType = requestedVisualType === "data-chart" && !chartData.length ? "editorial"
      : requestedVisualType === "diagram" && !diagramNodes.length ? "editorial"
      : requestedVisualType === "app-mockup" && !appMockup ? "editorial"
      : requestedVisualType;
    const facecamSrc = assetPath(scene.facecamSrc);
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
      stockSearchQuery: scene.stockSearchQuery === undefined ? text(scene.visualDescription, 100) : text(scene.stockSearchQuery, 100),
      generateAiFootage: scene.generateAiFootage === true,
      aiVideoPrompt: text(scene.aiVideoPrompt, 1800),
      visualType,
      backgroundEffect: BACKGROUND_EFFECTS.includes(scene.backgroundEffect) ? scene.backgroundEffect : "orbs",
      backgroundEffectIntensity: Number.isFinite(Number(scene.backgroundEffectIntensity)) ? Math.max(0, Math.min(0.65, Number(scene.backgroundEffectIntensity))) : 0.26,
      cameraMotion: CAMERA_MOTIONS.includes(scene.cameraMotion) ? scene.cameraMotion : "static",
      colorGrade: COLOR_GRADES.includes(scene.colorGrade) ? scene.colorGrade : "neutral",
      chartTitle: text(scene.chartTitle, 100),
      chartUnit: text(scene.chartUnit, 20),
      chartSource: text(scene.chartSource, 180),
      chartData,
      diagramNodes,
      diagramEdges,
      appMockup,
      notifications,
      callouts,
      soundIntensity: Number.isFinite(Number(scene.soundIntensity)) ? Math.max(0, Math.min(1, Number(scene.soundIntensity))) : 0.55,
      ...(facecamSrc ? { facecamSrc, facecamPosition: ["bottom-left", "bottom-right", "top-left", "top-right"].includes(scene.facecamPosition) ? scene.facecamPosition : "bottom-right" } : {}),
      footagePosition: ["center", "top", "bottom", "left", "right"].includes(scene.footagePosition) ? scene.footagePosition : "center",
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
  const visualSource = input.visualBible && typeof input.visualBible === "object" ? input.visualBible : {};
  const visualBible = {
    artStyle: text(visualSource.artStyle, 180),
    palette: text(visualSource.palette, 180),
    lighting: text(visualSource.lighting, 180),
    cameraLanguage: text(visualSource.cameraLanguage, 180),
    texture: text(visualSource.texture, 180),
    compositionRules: text(visualSource.compositionRules, 240)
  };
  const characterSource = input.characterBible && typeof input.characterBible === "object" ? input.characterBible : null;
  const characterBible = characterSource ? {
    name: text(characterSource.name, 80),
    type: text(characterSource.type, 100),
    silhouette: text(characterSource.silhouette, 180),
    face: text(characterSource.face, 180),
    hairOrFur: text(characterSource.hairOrFur, 180),
    outfit: text(characterSource.outfit, 180),
    colors: text(characterSource.colors, 140),
    accessories: text(characterSource.accessories, 140),
    personality: text(characterSource.personality, 140),
    continuityRules: Array.isArray(characterSource.continuityRules)
      ? characterSource.continuityRules.slice(0, 8).map(item => text(item, 160)).filter(Boolean)
      : []
  } : null;
  const voiceoverTracks = Array.isArray(input.voiceoverTracks) ? input.voiceoverTracks.slice(0, 60).map(track => {
    const src = assetPath(track?.src);
    const startSeconds = Number(track?.startSeconds);
    const trackDuration = Number(track?.durationSeconds);
    if (!src || !Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 300 || !Number.isFinite(trackDuration) || trackDuration <= 0 || trackDuration > 300 || startSeconds + trackDuration > 301) return null;
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
    language: text(input.language, 12) || "id",
    musicTrackSrc, musicBpm, musicVolume, captionStyle, captionPosition,
    aiFootageCount: Number(input.aiFootageCount) || 0,
    scenes, musicStyle, soundEffects, durationSeconds, durationInFrames,
    sourcePrompt: text(input.sourcePrompt, 6000),
    planSummary: text(input.planSummary, 300),
    creativeBrief,
    visualBible,
    characterBible,
    voiceSettings,
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
