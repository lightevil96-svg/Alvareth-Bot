import { prepareVoiceover } from "./voiceover.js";
import { prepareAiFootage } from "./ai-video.js";
import { prepareAiMusic } from "./ai-music.js";
import { prepareStockFootage } from "./stock-footage.js";

export async function prepareVideoMedia(project, jobId, onStage = () => {}) {
  let prepared = { ...project, scenes: project.scenes.map(scene => ({ ...scene })) };
  const warnings = [];

  onStage("voiceover");
  try {
    const voice = await prepareVoiceover(prepared, jobId);
    prepared = { ...prepared, scenes: voice.scenes, voiceoverTracks: voice.voiceoverTracks, captions: voice.captions };
    warnings.push(...voice.warnings);
  } catch (error) {
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
    warnings.push("Generasi footage AI tidak tersedia; footage stok atau motion graphics digunakan: " + String(error?.message || error).slice(0, 180));
  }

  onStage("footage");
  try {
    const footage = await prepareStockFootage(prepared, jobId);
    prepared = {
      ...prepared,
      scenes: footage.scenes,
      mediaCredits: footage.mediaCredits,
      footageCount: footage.footageCount + Number(prepared.aiFootageCount || 0)
    };
    warnings.push(...footage.warnings);
  } catch (error) {
    warnings.push("Footage stok tidak tersedia untuk pekerjaan ini: " + String(error?.message || error).slice(0, 180));
    prepared.mediaCredits = [];
    prepared.footageCount = Number(prepared.aiFootageCount || 0);
  }

  onStage("ai-music");
  try {
    const music = await prepareAiMusic(prepared, jobId);
    prepared = { ...prepared, musicTrackSrc: music.musicTrackSrc, musicBpm: music.musicBpm };
    warnings.push(...music.warnings);
  } catch (error) {
    warnings.push("Musik AI tidak tersedia; soundtrack bawaan digunakan: " + String(error?.message || error).slice(0, 160));
  }

  prepared.mediaWarnings = warnings.slice(0, 12);
  return prepared;
}
