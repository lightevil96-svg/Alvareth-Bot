import { validateVideoProject } from "../validate.js";

export function compileVideoPlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.scenes)) {
    throw new Error("Storyboard belum lengkap dan tidak dapat dikompilasi.");
  }
  const project = {
    title: plan.title,
    language: plan.language,
    mode: "professional",
    ratio: plan.ratio,
    fps: plan.fps,
    musicStyle: plan.musicStyle,
    captionStyle: plan.captionStyle,
    musicDirection: plan.musicDirection,
    soundEffects: plan.soundEffects,
    sourcePrompt: plan.sourcePrompt,
    planSummary: plan.creativeBrief && plan.creativeBrief.coreMessage || plan.title,
    creativeBrief: plan.creativeBrief || {},
    visualBible: plan.visualBible || {},
    characterBible: plan.characterBible || null,
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
      generateAiFootage: scene.generateAiFootage,
      aiVideoPrompt: scene.aiVideoPrompt,
      visualType: scene.visualType,
      backgroundEffect: scene.backgroundEffect,
      cameraMotion: scene.cameraMotion,
      colorGrade: scene.colorGrade,
      chartTitle: scene.chartTitle,
      chartUnit: scene.chartUnit,
      chartSource: scene.chartSource,
      chartData: scene.chartData,
      diagramNodes: scene.diagramNodes,
      diagramEdges: scene.diagramEdges,
      appMockup: scene.appMockup,
      notifications: scene.notifications,
      callouts: scene.callouts,
      soundIntensity: scene.soundIntensity,
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
