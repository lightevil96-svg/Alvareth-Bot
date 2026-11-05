import test from "node:test";
import assert from "node:assert/strict";
import { buildCaptionGroups, splitVoiceoverChunks } from "../video-studio/media/voiceover.js";
import { validateVideoProject } from "../video-studio/validate.js";
import { applyComfyWorkflowVariables } from "../video-studio/media/comfyui.js";

test("groups character-level TTS alignment into timed subtitle phrases", () => {
  const characters = Array.from("Halo dunia.");
  const alignment = {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * 0.1),
    character_end_times_seconds: characters.map((_, index) => index * 0.1 + 0.08)
  };
  const groups = buildCaptionGroups(alignment, 1.5);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].words.map(word => word.text), ["Halo", "dunia."]);
  assert.equal(groups[0].startSeconds, 1.5);
  assert.ok(groups[0].endSeconds > 2.4);
});

test("splits voiceover into scene-aligned provider requests", () => {
  const chunks = splitVoiceoverChunks([
    { narration: "Halo dunia." },
    { narration: "Ini scene kedua." },
    { narration: "Penutup video." }
  ], 30);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].ranges[0].sceneIndex, 0);
  assert.equal(chunks[0].ranges[1].sceneIndex, 1);
  assert.equal(chunks[1].ranges[0].sceneIndex, 2);
  assert.equal(chunks[1].text, "Penutup video.");
});

test("keeps generated media paths and synchronized captions in a validated project", () => {
  const project = validateVideoProject({
    title: "Demo media",
    ratio: "9:16",
    fps: 30,
    scenes: [{
      id: "scene-01",
      text: "Mulai",
      duration: 4,
      startSeconds: 0,
      footageSrc: "generated/job-123/footage-01.mp4",
      footageCredit: "Photographer",
      footageUrl: "https://www.pexels.com/video/sample-123/"
    }],
    voiceoverTracks: [{ src: "generated/job-123/voice-01.mp3", startSeconds: 0, durationSeconds: 3.8 }],
    captions: [{
      startSeconds: 0,
      endSeconds: 0.9,
      words: [{ text: "Halo", startSeconds: 0.1, endSeconds: 0.8 }]
    }],
    mediaCredits: [{ provider: "Pexels", photographer: "Photographer", videoUrl: "https://www.pexels.com/video/sample-123/" }]
  });
  assert.equal(project.voiceoverTracks.length, 1);
  assert.equal(project.captions.length, 1);
  assert.equal(project.footageCount, 1);
  assert.equal(project.mediaCredits[0].provider, "Pexels");
});

test("rejects unsafe local asset paths rather than passing them to Remotion", () => {
  const project = validateVideoProject({
    scenes: [{ text: "Safe fallback", duration: 4, footageSrc: "../../private/key.mp4" }],
    voiceoverTracks: [{ src: "../private/voice.mp3", startSeconds: 0, durationSeconds: 3 }]
  });
  assert.equal(project.scenes[0].footageSrc, undefined);
  assert.equal(project.voiceoverTracks.length, 0);
  assert.equal(project.footageCount, 0);
});

test("injects a generated character reference image into an image-to-video workflow", () => {
  const workflow = {
    "10": { class_type: "LoadImage", inputs: { image: "{{REFERENCE_IMAGE}}" } },
    "11": { class_type: "CLIPTextEncode", inputs: { text: "{{PROMPT}}" } }
  };
  const applied = applyComfyWorkflowVariables(workflow, {
    REFERENCE_IMAGE: "characters/job-123/reference.png",
    PROMPT: "A small fox walks through the forest."
  });
  assert.equal(applied["10"].inputs.image, "characters/job-123/reference.png");
  assert.equal(applied["11"].inputs.text, "A small fox walks through the forest.");
});
