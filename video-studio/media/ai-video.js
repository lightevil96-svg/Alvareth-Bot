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
      const identityLines = character ? [
        "RECURRING CHARACTER IDENTITY — keep these traits unchanged:",
        character.name ? "Name: " + clean(character.name, 80) : "",
        character.type ? "Type: " + clean(character.type, 100) : "",
        character.silhouette ? "Silhouette: " + clean(character.silhouette, 180) : "",
        character.face ? "Face: " + clean(character.face, 180) : "",
        character.hairOrFur ? "Hair/fur: " + clean(character.hairOrFur, 180) : "",
        character.outfit ? "Outfit: " + clean(character.outfit, 180) : "",
        character.colors ? "Colors: " + clean(character.colors, 140) : "",
        character.accessories ? "Accessories: " + clean(character.accessories, 140) : "",
        character.personality ? "Personality: " + clean(character.personality, 140) : "",
        ...(Array.isArray(character.continuityRules) ? character.continuityRules.slice(0, 8).map(rule => "Continuity: " + clean(rule, 160)) : [])
      ].filter(Boolean) : [];
      const visualLines = [
        visual.artStyle ? "Art style: " + clean(visual.artStyle, 180) : "",
        visual.palette ? "Palette: " + clean(visual.palette, 180) : "",
        visual.lighting ? "Lighting: " + clean(visual.lighting, 180) : "",
        visual.cameraLanguage ? "Camera language: " + clean(visual.cameraLanguage, 180) : "",
        visual.texture ? "Texture: " + clean(visual.texture, 180) : "",
        visual.compositionRules ? "Composition: " + clean(visual.compositionRules, 240) : ""
      ].filter(Boolean);
      const scenePrompt = clean(item.scene.aiVideoPrompt || item.scene.visualDescription || item.scene.text, 1800);
      const prompt = clean([
        ...identityLines,
        ...visualLines,
        "SCENE ACTION AND SHOT DIRECTION:",
        scenePrompt,
        "Keep the recurring character's identity and art direction consistent. Do not add subtitles, logos, watermarks, or unrelated characters."
      ].join("\n"), 3000);
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
