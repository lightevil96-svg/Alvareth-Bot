import { prepareVoiceover } from "./voiceover.js";
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

  onStage("footage");
  try {
    const footage = await prepareStockFootage(prepared, jobId);
    prepared = { ...prepared, scenes: footage.scenes, mediaCredits: footage.mediaCredits, footageCount: footage.footageCount };
    warnings.push(...footage.warnings);
  } catch (error) {
    warnings.push("Footage dinamis tidak tersedia untuk pekerjaan ini: " + String(error?.message || error).slice(0, 180));
    prepared.mediaCredits = [];
    prepared.footageCount = 0;
  }

  prepared.mediaWarnings = warnings.slice(0, 12);
  return prepared;
}
