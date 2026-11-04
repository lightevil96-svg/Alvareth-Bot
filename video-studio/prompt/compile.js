import { validateVideoProject } from "../validate.js";

export function compileVideoPlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.scenes)) {
    throw new Error("Storyboard belum lengkap dan tidak dapat dikompilasi.");
  }
  const project = {
    title: plan.title,
    mode: "professional",
    ratio: plan.ratio,
    fps: plan.fps,
    musicStyle: plan.musicStyle,
    soundEffects: plan.soundEffects,
    sourcePrompt: plan.sourcePrompt,
    planSummary: plan.creativeBrief && plan.creativeBrief.coreMessage || plan.title,
    creativeBrief: plan.creativeBrief || {},
    scenes: plan.scenes.map(scene => ({
      id: scene.id,
      purpose: scene.purpose,
      text: scene.text,
      duration: scene.durationSeconds,
      kicker: scene.kicker,
      highlight: scene.highlight,
      subtext: scene.subtext,
      points: scene.points,
      narration: scene.narration,
      visualDescription: scene.visualDescription,
      stockSearchQuery: scene.stockSearchQuery,
      layout: scene.layout,
      motif: scene.motif,
      motion: scene.motion,
      transition: scene.transition,
      soundCue: scene.soundCue,
      background: scene.background,
      accent: scene.accent
    }))
  };
  return validateVideoProject(project);
}
