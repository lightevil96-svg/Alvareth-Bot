import { isComfyConfigured, generateComfyAsset } from "./comfyui.js";

function clean(value, max = 500) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function prepareAiFootage(project, jobId) {
  if (!isComfyConfigured("video")) return { scenes: project.scenes, generatedCount: 0, warnings: [] };
  const maxScenes = Math.max(1, Math.min(4, Number(process.env.VIDEO_STUDIO_COMFYUI_MAX_VIDEO_SCENES) || 2));
  const candidates = project.scenes.map((scene, index) => ({ scene, index }))
    .filter(item => !item.scene.footageSrc && (item.scene.generateAiFootage === true || clean(item.scene.aiVideoPrompt, 20)));
  const selected = candidates.slice(0, maxScenes);
  const scenes = project.scenes.map(scene => ({ ...scene }));
  const warnings = [];
  let generatedCount = 0;
  for (const item of selected) {
    try {
      const prompt = clean(item.scene.aiVideoPrompt || item.scene.visualDescription || item.scene.text, 1800);
      const result = await generateComfyAsset({
        kind: "video",
        prompt,
        negativePrompt: "text, subtitles, watermark, logo, distorted faces, extra limbs, low quality, flicker, abrupt camera shake",
        jobId,
        filename: "ai-video-" + String(item.index + 1).padStart(2, "0"),
        ratio: project.ratio,
        durationSeconds: Math.min(8, Math.max(3, Number(item.scene.duration) || 5)),
        fps: Math.min(24, Number(project.fps) || 24)
      });
      scenes[item.index].footageSrc = result.src;
      scenes[item.index].footageCredit = "AI-generated with ComfyUI";
      scenes[item.index].footageUrl = "";
      scenes[item.index].cameraMotion = "static";
      generatedCount++;
    } catch (error) {
      warnings.push("AI footage scene " + (item.index + 1) + " gagal; footage stok atau motion graphics digunakan: " + clean(error.message, 160));
    }
  }
  return { scenes, generatedCount, warnings };
}
