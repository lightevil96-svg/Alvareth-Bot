import { isComfyConfigured, generateComfyAsset } from "./comfyui.js";

function clean(value, max = 500) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function prepareAiMusic(project, jobId) {
  if (!isComfyConfigured("music")) return { musicTrackSrc: project.musicTrackSrc || "", musicBpm: project.musicBpm || 0, warnings: [] };
  try {
    const brief = project.creativeBrief || {};
    const prompt = [
      "Create an original instrumental background soundtrack for a polished " + (project.category || "explainer") + " video.",
      "Mood: " + clean(brief.tone || project.musicStyle || "cinematic", 120) + ".",
      "Story: " + clean(brief.coreMessage || project.title, 260) + ".",
      "Music direction: " + clean(brief.musicDirection || "professional modern production, clear rhythmic pulse, no vocals, no spoken words", 260) + ".",
      "No vocals, no lyrics, no sound effects, seamless ending, clean mix with space for narration."
    ].join(" ");
    const result = await generateComfyAsset({
      kind: "music",
      prompt,
      negativePrompt: "singing, speech, lyrics, distorted audio, clipping, noise",
      jobId,
      filename: "ai-music",
      ratio: project.ratio,
      durationSeconds: Math.max(8, Math.min(90, Number(project.durationSeconds) || 30)),
      fps: project.fps
    });
    return { musicTrackSrc: result.src, musicBpm: 0, warnings: [] };
  } catch (error) {
    return {
      musicTrackSrc: project.musicTrackSrc || "",
      musicBpm: project.musicBpm || 0,
      warnings: ["Musik AI tidak tersedia; soundtrack bawaan digunakan: " + clean(error.message, 160)]
    };
  }
}
