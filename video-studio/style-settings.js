import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_STYLE_SETTINGS = Object.freeze({ preset: "cinematic-illustrated" });

export const STYLE_PRESETS = Object.freeze({
  "cinematic-illustrated": {
    label: "Cinematic 2.5D Explainer",
    description: "Ilustrasi vektor berlapis, warna navy-emas, cahaya sunset, parallax, dan storytelling sinematik.",
    visualType: "illustrated",
    backgrounds: ["#9A563B", "#101A33", "#19213D", "#251B38", "#10213C"],
    accent: "#F5C96B",
    backgroundEffects: ["orbs", "particles", "vignette", "particles"],
    motifs: ["spark", "orbit", "ribbon", "rings"],
    motions: ["fade-up", "scale-in", "reveal", "float"],
    transitions: ["dissolve", "fade", "wipe", "zoom"],
    cameraMotions: ["drift", "push-in", "pan-left", "static"],
    colorGrade: "warm",
    visualBible: {
      artStyle: "Layered 2D vector illustration with restrained 2.5D parallax, cinematic educational explainer composition.",
      palette: "Deep navy, warm amber gold, burnt orange sunset, muted plum, and soft cream.",
      lighting: "Warm sunset key light, soft golden rim light, atmospheric glow, subtle volumetric rays and restrained particles.",
      cameraLanguage: "Slow parallax drift, gentle push-in, layered foreground and background, deliberate cinematic framing.",
      texture: "Clean vector shapes, soft gradients, subtle paper-like texture, gentle depth shadows, no photorealistic noise.",
      compositionRules: "Keep one clear illustrated subject in the upper visual area and readable headline space below; preserve consistent character silhouettes."
    }
  },
  "3d-glass": {
    label: "Premium 3D Glass",
    description: "Objek 3D translucent, material kaca, refleksi lembut, dan pencahayaan studio.",
    visualType: "3d",
    backgrounds: ["#101827", "#102235", "#1A1B3A", "#111D2C"],
    accent: "#78DCE8",
    backgroundEffects: ["orbs", "particles", "vignette"],
    motifs: ["orbit", "rings", "spark"],
    motions: ["scale-in", "fade-up", "float"],
    transitions: ["fade", "zoom", "dissolve"],
    cameraMotions: ["push-in", "drift", "pan-left"],
    colorGrade: "cool",
    threeDStyle: "glass",
    threeDObjects: ["isometric", "orb", "crystal"],
    visualBible: {
      artStyle: "Premium procedural 3D motion graphics with translucent glass objects and restrained cinematic depth.",
      palette: "Midnight navy, cool cyan, pale blue highlights, and subtle silver.",
      lighting: "Soft three-point studio lighting, controlled reflections, cyan rim light, and gentle bloom.",
      cameraLanguage: "Slow orbit, precise push-in, smooth depth-aware movement, and clean product-hero framing.",
      texture: "Translucent glass, polished edges, soft reflections, and smooth premium materials.",
      compositionRules: "One dominant 3D hero object per scene, clear negative space for text, consistent lighting and material."
    }
  },
  "kinetic-bold": {
    label: "Bold Kinetic Typography",
    description: "Tipografi besar, animasi kata dinamis, kontras tinggi, dan transisi cepat.",
    visualType: "kinetic",
    backgrounds: ["#0A1022", "#17152E", "#111827", "#20152F"],
    accent: "#FFE36E",
    backgroundEffects: ["grid", "particles", "vignette"],
    motifs: ["bars", "spark", "orbit"],
    motions: ["scale-in", "slide-left", "fade-up", "reveal"],
    transitions: ["flash", "wipe", "glitch", "zoom"],
    cameraMotions: ["push-in", "static", "drift"],
    colorGrade: "vivid",
    visualBible: {
      artStyle: "Bold kinetic typography and modern editorial motion graphics with oversized readable headlines.",
      palette: "Near-black navy, electric yellow, white, and restrained violet accents.",
      lighting: "High contrast, crisp highlights, subtle glow, and controlled dark backgrounds.",
      cameraLanguage: "Fast but readable push-ins, punchy transitions, and deliberate rhythmic movement.",
      texture: "Clean graphic surfaces, subtle grain, sharp edges, and minimal decorative elements.",
      compositionRules: "Prioritize one short headline per scene; animate words in sequence and keep supporting text concise."
    }
  },
  "clean-editorial": {
    label: "Clean Editorial",
    description: "Tampilan minimal, terang, rapi, tipografi editorial, dan gerakan halus.",
    visualType: "editorial",
    backgrounds: ["#F4F1E9", "#E9EEF4", "#F8F5EF", "#E8EDF2"],
    accent: "#253A56",
    backgroundEffects: ["none"],
    motifs: ["none"],
    motions: ["fade-up", "float", "reveal"],
    transitions: ["fade", "dissolve", "wipe"],
    cameraMotions: ["static", "drift"],
    colorGrade: "neutral",
    visualBible: {
      artStyle: "Minimal clean editorial motion design with refined typography and generous negative space.",
      palette: "Warm ivory, slate navy, muted blue-gray, and restrained accent colors.",
      lighting: "Soft even lighting with subtle shadows and no harsh glow.",
      cameraLanguage: "Slow restrained movement, gentle fades, and stable editorial framing.",
      texture: "Matte surfaces, fine subtle grain, clean lines, and minimal ornament.",
      compositionRules: "Use generous whitespace, short headlines, aligned text, and only essential visual elements."
    }
  }
});

export function normalizeStyleSettings(input = {}) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    preset: Object.hasOwn(STYLE_PRESETS, input.preset)
      ? input.preset
      : DEFAULT_STYLE_SETTINGS.preset
  };
}

export function getStyleSettingsPath(env = process.env) {
  const home = String(env.HOME || homedir());
  const dataDir = resolve(String(env.ALVARETH_DATA_DIR || join(home, ".alvareth-bot-data")));
  return join(dataDir, "video-studio", "style-settings.json");
}

export function getStyleSettings(env = process.env) {
  const path = getStyleSettingsPath(env);
  let saved = {};
  try {
    if (existsSync(path)) saved = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.warn("[REMOTION:STYLE] Pengaturan style tidak dapat dibaca; memakai default:", error.message);
  }
  return normalizeStyleSettings({ ...DEFAULT_STYLE_SETTINGS, ...saved });
}

export function updateStyleSettings(patch, env = process.env) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Perubahan pengaturan style harus berupa objek.");
  }
  const settings = normalizeStyleSettings({ ...getStyleSettings(env), ...patch });
  const path = getStyleSettingsPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + ".tmp";
  writeFileSync(temp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, path);
  return settings;
}

export function applyVisualStyle(plan, presetId = DEFAULT_STYLE_SETTINGS.preset) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.scenes)) {
    throw new Error("Storyboard tidak valid untuk penerapan style visual.");
  }
  const selected = normalizeStyleSettings({ preset: presetId }).preset;
  const preset = STYLE_PRESETS[selected];
  const scenes = plan.scenes.map((scene, index) => {
    const preserveSpecialVisual = ["data-chart", "diagram", "app-mockup", "waveform"].includes(scene.visualType);
    const visualType = scene.generateAiFootage || preserveSpecialVisual ? scene.visualType : preset.visualType;
    const result = {
      ...scene,
      visualType,
      background: preset.backgrounds[index % preset.backgrounds.length],
      accent: preset.accent,
      backgroundEffect: preset.backgroundEffects[index % preset.backgroundEffects.length],
      motif: preset.motifs[index % preset.motifs.length],
      motion: preset.motions[index % preset.motions.length],
      transition: preset.transitions[index % preset.transitions.length],
      cameraMotion: preset.cameraMotions[index % preset.cameraMotions.length],
      colorGrade: preset.colorGrade
    };
    if (preset.threeDStyle) result.threeDStyle = preset.threeDStyle;
    if (Array.isArray(preset.threeDObjects) && preset.threeDObjects.length) {
      result.threeDObject = preset.threeDObjects[index % preset.threeDObjects.length];
    }
    return result;
  });
  return {
    ...plan,
    visualStyle: selected,
    visualBible: { ...(plan.visualBible || {}), ...preset.visualBible },
    scenes
  };
}
