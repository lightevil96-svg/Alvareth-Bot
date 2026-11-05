import { prepareVoiceover } from "./voiceover.js";
import { prepareAiFootage } from "./ai-video.js";

export async function prepareVideoMedia(project, jobId, onStage = () => {}) {
  let prepared = { ...project, scenes: project.scenes.map(scene => ({ ...scene })), musicStyle: "none", musicTrackSrc: "" };
  const warnings = [];

  onStage("voiceover");
  try {
    const voice = await prepareVoiceover(prepared, jobId);
    prepared = { ...prepared, scenes: voice.scenes, voiceoverTracks: voice.voiceoverTracks, captions: voice.captions };
    warnings.push(...voice.warnings);
  } catch (error) {
    warnings.push("Voice-over VoxCPM2 tidak tersedia untuk pekerjaan ini: " + String(error?.message || error).slice(0, 220));
    prepared.voiceoverTracks = [];
    prepared.captions = [];
  }

  onStage("ai-video");
  try {
    const generated = await prepareAiFootage(prepared, jobId);
    prepared = {
      ...prepared,
      scenes: generated.scenes,
      aiFootageCount: generated.generatedCount,
      footageCount: generated.generatedCount,
      mediaCredits: []
    };
    warnings.push(...generated.warnings);
  } catch (error) {
    warnings.push("Generasi footage lokal tidak tersedia; motion graphics digunakan: " + String(error?.message || error).slice(0, 180));
    prepared.mediaCredits = [];
    prepared.footageCount = 0;
  }

  prepared.mediaWarnings = warnings.slice(0, 12);
  return prepared;
}
