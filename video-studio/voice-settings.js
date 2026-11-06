import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const EDGE_TTS_VOICES = Object.freeze({
  "id-ID-GadisNeural": "Gadis • perempuan",
  "id-ID-ArdiNeural": "Ardi • laki-laki"
});

export const VOXCPM_STYLES = Object.freeze({
  natural: "A clear, natural Indonesian narrator with precise articulation and a conversational pace.",
  warm: "A warm, friendly Indonesian narrator with gentle expression and natural pacing.",
  energetic: "An energetic Indonesian narrator with lively emphasis, clear diction and controlled excitement.",
  calm: "A calm Indonesian narrator with a relaxed pace, soft delivery and clear articulation.",
  storytelling: "An expressive Indonesian storyteller with varied intonation, emotional phrasing and natural pauses."
});

export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  provider: "edge-tts",
  voice: "id-ID-GadisNeural",
  rate: "+0%",
  pitch: "+0Hz",
  volume: "+0%",
  voxStyle: "warm"
});

function clampSuffix(value, suffix, min, max, fallback) {
  const match = String(value ?? "").trim().match(/^([+-])(\d{1,3})$/);
  if (!match) return fallback;
  const amount = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  return (amount >= 0 ? "+" : "") + Math.max(min, Math.min(max, amount)) + suffix;
}

export function normalizeVoiceSettings(input = {}) {
  const provider = ["edge-tts", "voxcpm2"].includes(input.provider)
    ? input.provider
    : DEFAULT_VOICE_SETTINGS.provider;
  const voice = Object.hasOwn(EDGE_TTS_VOICES, input.voice)
    ? input.voice
    : DEFAULT_VOICE_SETTINGS.voice;
  const voxStyle = Object.hasOwn(VOXCPM_STYLES, input.voxStyle)
    ? input.voxStyle
    : DEFAULT_VOICE_SETTINGS.voxStyle;
  return {
    provider,
    voice,
    rate: clampSuffix(String(input.rate ?? "").replace(/%$/, ""), "%", -30, 30, DEFAULT_VOICE_SETTINGS.rate),
    pitch: clampSuffix(String(input.pitch ?? "").replace(/Hz$/i, ""), "Hz", -20, 20, DEFAULT_VOICE_SETTINGS.pitch),
    volume: clampSuffix(String(input.volume ?? "").replace(/%$/, ""), "%", -20, 20, DEFAULT_VOICE_SETTINGS.volume),
    voxStyle
  };
}

export function getVoiceSettingsPath(env = process.env) {
  const home = String(env.HOME || homedir());
  const dataDir = resolve(String(env.ALVARETH_DATA_DIR || join(home, ".alvareth-bot-data")));
  return join(dataDir, "video-studio", "voice-settings.json");
}

export function getVoiceSettings(env = process.env) {
  const path = getVoiceSettingsPath(env);
  let saved = {};
  try {
    if (existsSync(path)) saved = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.warn("[REMOTION:VOICE] Pengaturan voice tidak dapat dibaca; memakai default:", error.message);
  }
  const envProvider = env.VIDEO_STUDIO_TTS_PROVIDER;
  return normalizeVoiceSettings({
    ...DEFAULT_VOICE_SETTINGS,
    ...(envProvider ? { provider: envProvider } : {}),
    ...saved
  });
}

export function updateVoiceSettings(patch, env = process.env) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Perubahan pengaturan voice harus berupa objek.");
  }
  const settings = normalizeVoiceSettings({ ...getVoiceSettings(env), ...patch });
  const path = getVoiceSettingsPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + ".tmp";
  writeFileSync(temp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, path);
  return settings;
}
