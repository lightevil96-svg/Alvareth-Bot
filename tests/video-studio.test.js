import test from "node:test";
import assert from "node:assert/strict";
import { getVideoStudioLimits, validateVideoProject } from "../video-studio/validate.js";
import { normalizeVideoPlan, parseJsonResponse } from "../video-studio/prompt/planner.js";
import { compileVideoPlan } from "../video-studio/prompt/compile.js";

test("normalizes a legacy manual project and keeps its dimensions", () => {
  const project = validateVideoProject({
    title: "Demo",
    mode: "professional",
    ratio: "9:16",
    fps: 30,
    scenes: [
      { text: "Scene one", duration: 4, background: "#112233" },
      { text: "Scene two", duration: 3, background: "#445566" }
    ]
  });
  assert.equal(project.width, 1080);
  assert.equal(project.height, 1920);
  assert.equal(project.durationSeconds, 7);
  assert.equal(project.durationInFrames, 210);
  assert.equal(project.mode, "professional");
  assert.equal(project.musicStyle, "none");
});

test("rejects empty scenes, invalid duration, and unsupported fps", () => {
  assert.throws(() => validateVideoProject({ scenes: [] }), /1 sampai 60 scene/);
  assert.throws(() => validateVideoProject({ scenes: [{ text: "x", duration: 21 }] }), /1–20 detik/);
  assert.throws(() => validateVideoProject({ fps: 60, scenes: [{ text: "x" }] }), /FPS/);
});

test("rejects projects that exceed scene and total-duration limits", () => {
  assert.throws(() => validateVideoProject({ scenes: Array.from({ length: 61 }, () => ({ text: "x" })) }), /1 sampai 60 scene/);
  assert.throws(() => validateVideoProject({ scenes: Array.from({ length: 16 }, () => ({ text: "x", duration: 20 })) }), /maksimal 300 detik/);
});

test("publishes dynamic renderer limits without exposing user-facing scene settings", () => {
  assert.deepEqual(getVideoStudioLimits(), {
    ratios: ["9:16", "16:9", "1:1"],
    fps: [24, 25, 30],
    maxScenes: 60,
    maxSceneSeconds: 20,
    maxDurationSeconds: 300,
    musicStyles: ["none"]
  });
});

test("parses JSON returned inside a markdown fence", () => {
  const parsed = parseJsonResponse("\x60\x60\x60json\n{\"title\":\"Demo\",\"scenes\":[]}\n\x60\x60\x60");
  assert.equal(parsed.title, "Demo");
});

test("derives varied scene durations from narration and reading time", () => {
  const plan = normalizeVideoPlan({
    title: "Cerita singkat",
    category: "educational",
    ratio: "9:16",
    fps: 30,
    musicStyle: "calm",
    scenes: [
      { text: "Pernah bertanya?", narration: "Pernah bertanya mengapa hal ini bisa terjadi?", durationSeconds: 2.5 },
      { text: "Ada tiga alasan utama", narration: "Pertama, kita perlu memahami konteksnya. Kedua, kebiasaan sehari-hari ikut memengaruhi hasil. Ketiga, keputusan kecil yang konsisten dapat mengubah proses.", durationSeconds: 2.5 }
    ]
  }, "Buat video edukasi singkat");
  assert.notEqual(plan.scenes[0].durationSeconds, plan.scenes[1].durationSeconds);
  assert.ok(plan.totalDurationSeconds > 0);
});

test("fits scene durations to an explicit duration requested in the prompt", () => {
  const plan = normalizeVideoPlan({
    title: "Demo 30 detik",
    ratio: "9:16",
    scenes: [
      { text: "Pembuka", narration: "Mari kita mulai." },
      { text: "Penjelasan", narration: "Sekarang kita lihat bagaimana proses ini bekerja." },
      { text: "Penutup", narration: "Mulai dari langkah kecil hari ini." }
    ]
  }, "Buat video 30 detik tentang kebiasaan membaca");
  assert.equal(Math.round(plan.totalDurationSeconds), 30);
});

test("compiles a safe AI plan into a validated Remotion project", () => {
  const plan = normalizeVideoPlan({
    title: "Belajar fokus",
    category: "educational",
    ratio: "9:16",
    fps: 30,
    musicStyle: "calm",
    creativeBrief: { coreMessage: "Fokus dibangun lewat kebiasaan kecil." },
    scenes: [
      { text: "Mulai dari satu hal", narration: "Jangan mulai dengan sepuluh target sekaligus.", layout: "hero", motif: "rings", motion: "fade-up", background: "#111827", accent: "#68DDB8" },
      { text: "Kurangi gangguan", narration: "Jauhkan notifikasi yang tidak dibutuhkan saat bekerja.", layout: "editorial", motif: "grid", motion: "slide-left", background: "#122B35", accent: "#F18A70" }
    ]
  }, "Buat video edukasi tentang fokus");
  const project = compileVideoPlan(plan);
  assert.equal(project.scenes.length, 2);
  assert.equal(project.scenes[0].layout, "hero");
  assert.equal(project.sourcePrompt, "Buat video edukasi tentang fokus");
  assert.equal(project.ratio, "9:16");
});

test("preserves the user's prompt as metadata and ignores unsupported creative enums", () => {
  const plan = normalizeVideoPlan({
    title: "Video",
    ratio: "9:16",
    scenes: [{ text: "Satu ide", layout: "unknown-layout", motion: "run-code", motif: "javascript", background: "url(https://example.com)" }]
  }, "Buat video");
  assert.equal(plan.scenes[0].layout, "hero");
  assert.equal(plan.scenes[0].motion, "fade-up");
  assert.match(plan.scenes[0].background, /^#[0-9a-f]{6}$/i);
});

test("preserves visual and recurring character bibles through Remotion compilation", () => {
  const plan = normalizeVideoPlan({
    title: "Petualangan rubah",
    visualBible: {
      artStyle: "stylized cinematic 3D animation",
      palette: "warm amber and deep teal",
      lighting: "soft moonlight with warm rim light",
      cameraLanguage: "slow dolly and deliberate close-ups",
      texture: "detailed soft fur",
      compositionRules: "keep the fox centered in mobile-safe framing"
    },
    characterBible: {
      name: "Rumi",
      type: "small red fox",
      silhouette: "small body, oversized ears, fluffy tail with white tip",
      face: "amber eyes and white muzzle",
      hairOrFur: "short rust-red fur with cream chest",
      outfit: "small navy scarf",
      colors: "rust red, cream, navy",
      accessories: "navy scarf",
      personality: "curious and brave",
      continuityRules: ["same scarf and fur markings in every scene"]
    },
    scenes: [
      {
        text: "Rumi menemukan cahaya",
        narration: "Rumi melihat cahaya kecil di antara pepohonan.",
        generateAiFootage: true,
        aiVideoPrompt: "The fox slowly approaches a glowing firefly."
      }
    ]
  }, "Buat video animasi 3D tentang rubah kecil bernama Rumi.");

  const project = compileVideoPlan(plan);
  assert.equal(project.characterBible.name, "Rumi");
  assert.equal(project.characterBible.continuityRules[0], "same scarf and fur markings in every scene");
  assert.equal(project.visualBible.artStyle, "stylized cinematic 3D animation");
  assert.equal(project.scenes[0].aiVideoPrompt, "The fox slowly approaches a glowing firefly.");
});

test("keeps soundtrack optional and compiles timed sound events", () => {
  const plan = normalizeVideoPlan({
    title: "Animasi aksi",
    musicStyle: "upbeat",
    scenes: [{
      text: "Lompatan",
      narration: "Karakter melompat melewati rintangan.",
      motion: "scale-in",
      soundEvents: [
        { cue: "whoosh", delaySeconds: 0.4, intensity: 0.6 },
        { cue: "impact", delaySeconds: 2.1, intensity: 0.8 }
      ]
    }]
  }, "Buat video animasi aksi dengan efek suara gerakan");
  const project = compileVideoPlan(plan);
  assert.equal(project.musicStyle, "none");
  assert.deepEqual(project.scenes[0].soundEvents.map(event => event.cue), ["whoosh", "impact"]);
  assert.equal(project.scenes[0].soundEvents[1].delaySeconds, 2.1);
});

test("infers Foley events from visible action words when the planner omits soundEvents", () => {
  const plan = normalizeVideoPlan({
    title: "Aksi karakter",
    scenes: [
      { text: "Karakter berlari", narration: "Karakter berlari melewati lorong lalu mendarat dengan keras." },
      { text: "Informasi penting", narration: "Informasi ini perlu dibaca dengan teliti.", motion: "static", transition: "cut" }
    ]
  }, "Buat animasi karakter berlari dan mendarat");
  assert.deepEqual(plan.scenes[0].soundEvents.map(event => event.cue), ["footstep", "footstep", "impact"]);
  assert.equal(plan.scenes[1].soundEvents.length, 0);
});
