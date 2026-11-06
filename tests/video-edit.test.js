import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultEditPlan,
  getOutputDimensions,
  normalizeEditSettings,
  validateEditPlan
} from "../video-edit/schema.js";
import {
  buildKeepSegments,
  limitSegments,
  parseSilenceLog
} from "../video-edit/engine.js";

test("default edit plan is safe and uses a vertical short-form format", () => {
  const plan = createDefaultEditPlan();
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.output.ratio, "9:16");
  assert.equal(plan.output.maxDurationSeconds, 60);
  assert.equal(plan.audio.musicAsset, "none");
  assert.equal(plan.captions.enabled, false);
});

test("settings are normalized to supported values", () => {
  assert.deepEqual(normalizeEditSettings({ ratio: "16:9", maxDurationSeconds: 999, removeSilence: false }), {
    ratio: "16:9",
    maxDurationSeconds: 180,
    removeSilence: false
  });
  assert.deepEqual(getOutputDimensions({ ratio: "4:5", resolution: "720p" }), { width: 864, height: 1080 });
});

test("valid custom plan accepts chronological clips and timed captions", () => {
  const plan = validateEditPlan({
    schemaVersion: 1,
    title: "Demo",
    output: { ratio: "9:16", resolution: "1080p", fps: 30, maxDurationSeconds: 30 },
    edit: {
      removeSilence: false,
      segments: [
        { start: 1, end: 4, speed: 1 },
        { start: 7, end: 10, speed: 1.25 }
      ]
    },
    captions: {
      enabled: true,
      style: "bold",
      items: [{ start: 0, end: 2.5, text: "Hook yang akurat" }]
    },
    audio: { normalize: true, originalVolume: 0.9, musicAsset: "none", musicVolume: 0 }
  }, { sourceDuration: 20 });
  assert.equal(plan.edit.segments.length, 2);
  assert.equal(plan.captions.items[0].text, "Hook yang akurat");
  assert.equal(plan.audio.originalVolume, 0.9);
});

test("validator rejects unsafe fields, URLs, invalid ratios and out-of-range clips", () => {
  const base = createDefaultEditPlan();
  assert.throws(() => validateEditPlan({ ...base, script: "process.exit()" }), /tidak didukung/);
  assert.throws(() => validateEditPlan({ ...base, output: { ratio: "2:3" } }), /output.ratio/);
  assert.throws(() => validateEditPlan({
    ...base,
    audio: { musicAsset: "https://example.com/song.mp3" }
  }), /URL dan path tidak diperbolehkan/);
  assert.throws(() => validateEditPlan({
    ...base,
    edit: { segments: [{ start: 2, end: 8, speed: 1 }] }
  }, { sourceDuration: 5 }), /melewati durasi video sumber/);
});

test("validator rejects overlapping or unordered source segments", () => {
  const base = createDefaultEditPlan();
  assert.throws(() => validateEditPlan({
    ...base,
    edit: { segments: [{ start: 5, end: 8 }, { start: 4, end: 9 }] }
  }, { sourceDuration: 20 }), /berurutan dan tidak saling tumpang tindih/);
});

test("silence parser reads paired and trailing silence intervals", () => {
  const log = [
    "[silencedetect] silence_start: 2.000",
    "[silencedetect] silence_end: 4.000 | silence_duration: 2.000",
    "[silencedetect] silence_start: 8.000"
  ].join("\n");
  assert.deepEqual(parseSilenceLog(log, 10, 0.5), [
    { start: 2, end: 4 },
    { start: 8, end: 10 }
  ]);
});

test("automatic silence cuts preserve short handles and respect maximum duration", () => {
  const plan = createDefaultEditPlan({ maxDurationSeconds: 5 });
  plan.edit.keepPaddingSeconds = 0.1;
  const segments = buildKeepSegments(plan, 12, [{ start: 3, end: 7 }]);
  assert.deepEqual(segments, [
    { start: 0, end: 3.1, speed: 1 },
    { start: 6.9, end: 8.8, speed: 1 }
  ]);
  assert.ok(segments.reduce((sum, item) => sum + item.end - item.start, 0) <= 5.001);
});

test("manual segments take precedence over automatic silence intervals", () => {
  const plan = createDefaultEditPlan();
  plan.edit.segments = [{ start: 4, end: 9, speed: 1 }];
  const segments = buildKeepSegments(plan, 20, [{ start: 1, end: 3 }]);
  assert.deepEqual(segments, [{ start: 4, end: 9, speed: 1 }]);
});

test("segment limiter respects playback speed when enforcing output duration", () => {
  assert.deepEqual(limitSegments([
    { start: 0, end: 10, speed: 2 },
    { start: 20, end: 30, speed: 1 }
  ], 3), [{ start: 0, end: 6, speed: 2 }]);
});
