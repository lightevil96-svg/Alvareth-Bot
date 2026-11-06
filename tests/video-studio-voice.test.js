import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_VOICE_SETTINGS,
  getVoiceSettings,
  getVoiceSettingsPath,
  normalizeVoiceSettings,
  updateVoiceSettings
} from "../video-studio/voice-settings.js";
import { buildWordBoundaryCaptionGroups } from "../video-studio/media/voiceover.js";

test("Edge TTS is the default fast online voice provider", () => {
  assert.equal(DEFAULT_VOICE_SETTINGS.provider, "edge-tts");
  assert.equal(normalizeVoiceSettings().voice, "id-ID-GadisNeural");
  assert.equal(normalizeVoiceSettings(null).provider, "edge-tts");
});

test("voice settings are persisted outside the repository and normalized safely", async t => {
  const root = await mkdtemp(join(tmpdir(), "remotion-voice-settings-"));
  const env = { HOME: root, ALVARETH_DATA_DIR: join(root, "data") };
  t.after(() => rm(root, { recursive: true, force: true }));

  const initial = getVoiceSettings(env);
  assert.equal(initial.provider, "edge-tts");
  const updated = updateVoiceSettings({
    provider: "voxcpm2",
    voice: "id-ID-ArdiNeural",
    rate: "+10%",
    pitch: "-10Hz",
    volume: "+10%",
    voxStyle: "storytelling"
  }, env);
  assert.equal(updated.provider, "voxcpm2");
  assert.equal(updated.voice, "id-ID-ArdiNeural");
  assert.equal(getVoiceSettings(env).voxStyle, "storytelling");

  const stored = JSON.parse(await readFile(getVoiceSettingsPath(env), "utf8"));
  assert.deepEqual(stored, updated);
});

test("voice settings reject unknown providers and clamp unsafe tuning values", () => {
  const settings = normalizeVoiceSettings({
    provider: "unknown",
    voice: "not-a-voice",
    rate: "+99%",
    pitch: "-99Hz",
    volume: "+99%",
    voxStyle: "unknown"
  });
  assert.equal(settings.provider, "edge-tts");
  assert.equal(settings.voice, "id-ID-GadisNeural");
  assert.equal(settings.rate, "+30%");
  assert.equal(settings.pitch, "-20Hz");
  assert.equal(settings.volume, "+20%");
  assert.equal(settings.voxStyle, "warm");
});

test("Edge TTS word-boundary metadata creates real timed subtitle groups", () => {
  const words = [
    { text: "Halo", start: 0, end: 0.2 },
    { text: "dunia,", start: 0.21, end: 0.5 },
    { text: "apa", start: 0.6, end: 0.8 },
    { text: "kabar?", start: 0.81, end: 1.1 },
    { text: "Baik", start: 1.2, end: 1.4 }
  ];
  const groups = buildWordBoundaryCaptionGroups(words, 2, 2, 5);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].words.map(word => word.text), ["Halo", "dunia,", "apa", "kabar?"]);
  assert.equal(groups[0].startSeconds, 2);
  assert.equal(groups[0].endSeconds, 3.1);
  assert.deepEqual(groups[1].words.map(word => word.text), ["Baik"]);
  assert.equal(groups[1].startSeconds, 3.2);
});

test("word-boundary captions ignore invalid or out-of-range timing events", () => {
  const groups = buildWordBoundaryCaptionGroups([
    { text: "valid", start: 0.1, end: 0.4 },
    { text: "bad", start: 0.5, end: 0.4 },
    { text: "late", start: 3, end: 3.2 }
  ], 0, 2, 5);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].words.map(word => word.text), ["valid"]);
});
