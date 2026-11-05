import { prepareVoiceover } from "./voiceover.js";
import { prepareAiFootage } from "./ai-video.js";
import { prepareAiMusic } from "./ai-music.js";

export async function prepareVideoMedia(project, jobId, onStage = () => {}) {
  let prepared = { ...project, scenes: project.scenes.map(scene => ({ ...scene })) };
  const warnings = [];

  onStage("voiceover");
  try {
    const voice = await prepareVoiceover(prepared, jobId);
    prepared = { ...prepared, scenes: voice.scenes, voiceoverTracks: voice.voiceoverTracks, captions: voice.captions };
    if (!voice.voiceoverTracks.length && process.env.VIDEO_STUDIO_VOICE_REQUIRED !== "false" && prepared.scenes.some(scene => scene.narration)) throw new Error(voice.warnings.join(" "));
    warnings.push(...voice.warnings);
  } catch (error) {
    if (process.env.VIDEO_STUDIO_VOICE_REQUIRED !== "false") throw error;
    warnings.push("Voice-over tidak tersedia untuk pekerjaan ini: " + String(error?.message || error).slice(0, 180));
    prepared.voiceoverTracks = [];
    prepared.captions = [];
  }

  onStage("ai-video");
  try {
    const generated = await prepareAiFootage(prepared, jobId);
    prepared = { ...prepared, scenes: generated.scenes, aiFootageCount: generated.generatedCount };
    warnings.push(...generated.warnings);
  } catch (error) {
    warnings.push("Generasi footage AI tidak tersedia; motion graphics digunakan: " + String(error?.message || error).slice(0, 180));
  }

  prepared.mediaCredits = [];
  prepared.footageCount = Number(prepared.aiFootageCount || 0);

  onStage("ai-music");
  try {
    const music = await prepareAiMusic(prepared, jobId);
    prepared = { ...prepared, musicTrackSrc: music.musicTrackSrc, musicBpm: music.musicBpm };
    warnings.push(...music.warnings);
  } catch (error) {
    warnings.push("Musik AI tidak tersedia; video tanpa musik: " + String(error?.message || error).slice(0, 160));
  }

  prepared.mediaWarnings = warnings.slice(0, 12);
  return prepared;
}
