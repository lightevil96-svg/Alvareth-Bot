import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRemotionCommand } from "../video-studio/whatsapp.js";
import { validateVideoProject } from "../video-studio/validate.js";
import { VOXCPM_STYLES } from "../video-studio/voice-settings.js";
import {
  DEFAULT_STYLE_SETTINGS, STYLE_PRESETS, applyVisualStyle,
  getStyleSettings, getStyleSettingsPath, normalizeStyleSettings, updateStyleSettings
} from "../video-studio/style-settings.js";

test("cinematic illustrated is the first and default visual preset", () => {
  assert.equal(DEFAULT_STYLE_SETTINGS.preset, "cinematic-illustrated");
  assert.equal(STYLE_PRESETS["cinematic-illustrated"].label, "Cinematic 2.5D Explainer");
  assert.equal(normalizeStyleSettings({ preset: "unknown" }).preset, DEFAULT_STYLE_SETTINGS.preset);
});

test("style command is parsed as a Remotion action", () => {
  assert.deepEqual(parseRemotionCommand("style"), { action: "style", argument: "" });
  assert.deepEqual(parseRemotionCommand("style cinematic-illustrated"), { action: "style", argument: "cinematic-illustrated" });
});

test("style settings persist outside the repository", async t => {
  const root = await mkdtemp(join(tmpdir(), "remotion-style-settings-"));
  const env = { HOME: root, ALVARETH_DATA_DIR: join(root, "data") };
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(getStyleSettings(env).preset, "cinematic-illustrated");
  const updated = updateStyleSettings({ preset: "3d-glass" }, env);
  assert.equal(updated.preset, "3d-glass");
  assert.equal(getStyleSettings(env).preset, "3d-glass");
  assert.deepEqual(JSON.parse(await readFile(getStyleSettingsPath(env), "utf8")), updated);
});

test("visual preset changes visuals but preserves storyboard content and specialized scenes", () => {
  const plan = {
    title: "Demo",
    visualBible: { compositionRules: "Original note" },
    scenes: [
      { id: "one", text: "Judul tetap", visualType: "cinematic", generateAiFootage: false },
      { id: "two", text: "Data tetap", visualType: "data-chart", chartData: [{ label: "A", value: 3 }] },
      { id: "three", text: "Footage tetap", visualType: "cinematic", generateAiFootage: true }
    ]
  };
  const styled = applyVisualStyle(plan, "cinematic-illustrated");
  assert.equal(styled.scenes[0].text, "Judul tetap");
  assert.equal(styled.scenes[0].visualType, "illustrated");
  assert.equal(styled.scenes[0].accent, "#F5C96B");
  assert.equal(styled.scenes[1].visualType, "data-chart");
  assert.deepEqual(styled.scenes[1].chartData, [{ label: "A", value: 3 }]);
  assert.equal(styled.scenes[2].visualType, "cinematic");
  assert.match(styled.visualBible.artStyle, /vector illustration/i);
  assert.equal(styled.visualStyle, "cinematic-illustrated");
});

test("all selectable visual presets map to supported renderers", () => {
  const plan = { scenes: [{ text: "Satu", visualType: "cinematic", generateAiFootage: false }] };
  assert.equal(applyVisualStyle(plan, "3d-glass").scenes[0].visualType, "3d");
  assert.equal(applyVisualStyle(plan, "kinetic-bold").scenes[0].visualType, "kinetic");
  assert.equal(applyVisualStyle(plan, "clean-editorial").scenes[0].visualType, "editorial");
  const project = validateVideoProject({ scenes: [{ text: "Ilustrasi", duration: 4, visualType: "illustrated" }] });
  assert.equal(project.scenes[0].visualType, "illustrated");
});

test("VoxCPM2 exposes a free local cinematic narrator voice design", () => {
  assert.match(VOXCPM_STYLES.cinematic, /cinematic narrator/i);
  assert.match(VOXCPM_STYLES.cinematic, /Indonesian male/i);
});
