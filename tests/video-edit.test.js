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
  parseSilenceLog,
  renderEditVideo
} from "../video-edit/engine.js";

test("default edit plan is safe and uses a vertical short-form format", () => {
  const plan = createDefaultEditPlan();
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.output.ratio, "9:16");
  assert.equal(plan.output.maxDurationSeconds, 60);
  assert.equal(plan.audio.musicAsset, "none");
  assert.equal(plan.output.fitMode, "crop");
  assert.deepEqual(plan.edit.cameraMoves, []);
  assert.equal(plan.captions.enabled, false);
});

test("settings are normalized to supported values", () => {
  assert.deepEqual(normalizeEditSettings({ ratio: "16:9", maxDurationSeconds: 999, removeSilence: false }), {
    ratio: "16:9",
    maxDurationSeconds: 180,
    removeSilence: false
  });
  assert.deepEqual(getOutputDimensions({ ratio: "4:5", resolution: "720p" }), { width: 720, height: 900 });
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



test("validator accepts blur background fit and smooth output-timeline camera moves", () => {
  const base = createDefaultEditPlan({ ratio: "9:16", maxDurationSeconds: 20, removeSilence: false });
  const plan = validateEditPlan({
    ...base,
    output: { ...base.output, fitMode: "blur-background" },
    edit: {
      ...base.edit,
      cameraMoves: [
        { start: 1, end: 3, zoom: 1.65, focusX: 0.88, focusY: 0.60, easing: "smooth" },
        { start: 8, end: 10, zoom: 1.45, focusX: 0.5, focusY: 0.5 }
      ]
    }
  }, { sourceDuration: 30 });
  assert.equal(plan.output.fitMode, "blur-background");
  assert.equal(plan.edit.cameraMoves.length, 2);
  assert.equal(plan.edit.cameraMoves[0].easing, "smooth");
  assert.equal(plan.edit.cameraMoves[1].easing, "smooth");
});

test("validator rejects unsupported fit modes and invalid camera moves", () => {
  const base = createDefaultEditPlan({ maxDurationSeconds: 20 });
  assert.throws(() => validateEditPlan({
    ...base,
    output: { ...base.output, fitMode: "stretch" }
  }), /fitMode/);
  assert.throws(() => validateEditPlan({
    ...base,
    edit: { ...base.edit, cameraMoves: [{ start: 2, end: 4, zoom: 3, focusX: 0.5, focusY: 0.5 }] }
  }), /zoom harus berupa angka/);
  assert.throws(() => validateEditPlan({
    ...base,
    edit: { ...base.edit, cameraMoves: [{ start: 2, end: 4, zoom: 1.5, focusX: 0.5, focusY: 0.5 }, { start: 3, end: 5, zoom: 1.4, focusX: 0.5, focusY: 0.5 }] }
  }), /tidak saling tumpang tindih/);
});

test("renders and fully decodes a real MP4 fixture with manual cuts and captions", async t => {
  const { spawnSync } = await import("node:child_process");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, mkdir, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const check = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  const probe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
  if (check.status !== 0 || probe.status !== 0) return t.skip("FFmpeg/FFprobe tidak tersedia pada environment ini.");

  const run = promisify(execFile);
  const directory = await mkdtemp(path.join(tmpdir(), "alvareth-edit-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.mp4");
  const outputPath = path.join(directory, "output.mp4");
  const workDir = path.join(directory, "work");
  await mkdir(workDir, { recursive: true });
  await run("ffmpeg", [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    sourcePath
  ], { timeout: 60000, maxBuffer: 1024 * 1024 });

  const filterList = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
  const supportsAss = String(filterList.stdout || "") .includes(" ass ") || String(filterList.stderr || "").includes(" ass ");
  const plan = createDefaultEditPlan({ ratio: "9:16", maxDurationSeconds: 10, removeSilence: false });
  plan.output.resolution = "720p";
  plan.output.fitMode = "blur-background";
  plan.edit.cameraMoves = [{ start: 0.3, end: 1.8, zoom: 1.45, focusX: 0.86, focusY: 0.60, easing: "smooth" }];
  plan.output.fps = 24;
  plan.edit.fadeInSeconds = 0;
  plan.edit.fadeOutSeconds = 0;
  plan.edit.segments = [
    { start: 0, end: 2, speed: 1 },
    { start: 3, end: 4, speed: 1 }
  ];
  if (supportsAss) {
    plan.captions = {
      enabled: true,
      style: "subtitle",
      items: [{ start: 0.2, end: 1.4, text: "Caption test" }]
    };
  }

  const result = await renderEditVideo({
    sourcePath,
    outputPath,
    workDir,
    inputPlan: plan,
    settings: {},
    onProgress: () => {}
  });
  assert.equal(result.width, 720);
  assert.equal(result.height, 1280);
  assert.equal(result.fps, 24);
  assert.ok(Math.abs(result.duration - 3) < 0.45);
  assert.ok((await stat(outputPath)).size > 0);
});


test("queue copies its source before returning, so session replacement cannot break an active render", async t => {
  const { spawnSync, execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, mkdir, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const check = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  const probe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
  if (check.status !== 0 || probe.status !== 0) return t.skip("FFmpeg/FFprobe tidak tersedia pada environment ini.");

  const run = promisify(execFile);
  const directory = await mkdtemp(path.join(tmpdir(), "alvareth-edit-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.mp4");
  await mkdir(directory, { recursive: true });
  await run("ffmpeg", [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000",
    "-t", "2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    sourcePath
  ], { timeout: 60000, maxBuffer: 1024 * 1024 });

  const { enqueueEditJob, getEditOutput } = await import("../video-edit/queue.js");
  const plan = createDefaultEditPlan({ ratio: "16:9", maxDurationSeconds: 10, removeSilence: false });
  plan.output.resolution = "720p";
  plan.output.fps = 24;
  plan.edit.fadeInSeconds = 0;
  plan.edit.fadeOutSeconds = 0;

  let resolveComplete;
  let rejectFailed;
  const finished = new Promise((resolve, reject) => {
    resolveComplete = resolve;
    rejectFailed = reject;
  });
  const job = await enqueueEditJob({
    sourcePath,
    sender: "queue-test-owner",
    chat: "queue-test-chat",
    plan,
    settings: {},
    onComplete: resolveComplete,
    onError: current => rejectFailed(new Error(current.error || "Queue render failed"))
  });
  await rm(sourcePath, { force: true });
  let timeout;
  try {
    const current = await Promise.race([
      finished,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Queue render timed out in regression test.")), 60000);
        timeout.unref?.();
      })
    ]);
    assert.equal(current.id, job.id);
    assert.equal(current.status, "completed");
    const output = await getEditOutput(job.id, "queue-test-owner");
    assert.ok(output);
    assert.ok((await stat(output.path)).size > 0);
    await rm(output.path, { force: true });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});
