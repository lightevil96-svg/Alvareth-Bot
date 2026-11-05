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
      const character = project.characterBible && typeof project.characterBible === "object"
        ? project.characterBible
        : null;
      const visual = project.visualBible && typeof project.visualBible === "object"
        ? project.visualBible
        : {};
      const identity = character ? [
        character.name ? "name " + clean(character.name, 60) : "",
        character.type ? "type " + clean(character.type, 70) : "",
        character.silhouette ? "silhouette " + clean(character.silhouette, 90) : "",
        character.face ? "face " + clean(character.face, 90) : "",
        character.hairOrFur ? "hair/fur " + clean(character.hairOrFur, 80) : "",
        character.outfit ? "outfit " + clean(character.outfit, 80) : "",
        character.colors ? "colors " + clean(character.colors, 70) : "",
        character.accessories ? "accessories " + clean(character.accessories, 70) : "",
        character.personality ? "personality " + clean(character.personality, 70) : "",
        ...(Array.isArray(character.continuityRules) ? character.continuityRules.slice(0, 2).map(rule => clean(rule, 80)) : [])
      ].filter(Boolean).join("; ").slice(0, 450) : "";
      const visualDirection = [
        visual.artStyle ? "style " + clean(visual.artStyle, 90) : "",
        visual.palette ? "palette " + clean(visual.palette, 70) : "",
        visual.lighting ? "lighting " + clean(visual.lighting, 70) : "",
        visual.cameraLanguage ? "camera " + clean(visual.cameraLanguage, 70) : "",
        visual.texture ? "texture " + clean(visual.texture, 60) : "",
        visual.compositionRules ? "composition " + clean(visual.compositionRules, 90) : ""
      ].filter(Boolean).join("; ").slice(0, 300);
      const scenePrompt = clean(item.scene.aiVideoPrompt || item.scene.visualDescription || item.scene.text, 800);
      const prompt = clean([
        identity ? "FIXED CHARACTER IDENTITY (do not alter): " + identity : "",
        visualDirection ? "VISUAL STYLE: " + visualDirection : "",
        "SCENE ACTION AND SHOT: " + scenePrompt,
        "Preserve the same character design and visual style. No subtitles, logos, or watermarks."
      ].filter(Boolean).join("\n"), 1800);
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
