import test from "node:test";
import assert from "node:assert/strict";
import { fitTextBlock } from "../video-studio/remotion/text-layout.js";

test("short scene headlines keep a large readable size", () => {
  const layout = fitTextBlock("Rumi dan Cahaya Hutan", 1200, {
    maxFontSize: 92,
    minFontSize: 28,
    maxLines: 4,
    fontWeight: 850
  });
  assert.equal(layout.text, "Rumi dan Cahaya Hutan");
  assert.equal(layout.lineCount, 1);
  assert.equal(layout.fontSize, 92);
  assert.equal(layout.fits, true);
});

test("long scene headlines shrink to fit the available width and line budget", () => {
  const text = "Petualangan kecil yang membawa Rumi menemukan cahaya misterius di tengah hutan yang luas";
  const layout = fitTextBlock(text, 360, {
    maxFontSize: 92,
    minFontSize: 24,
    maxLines: 4,
    fontWeight: 850
  });
  assert.ok(layout.fontSize < 92);
  assert.ok(layout.lineCount <= 4);
  assert.equal(layout.text.replace(/\n/g, " ").replace(/\s+/g, " ").trim(), text);
  assert.equal(layout.fits, true);
});

test("explicit line breaks and unusually long words remain inside the text layout", () => {
  const text = "Judul pertama\nSupercalifragilisticexpialidocious";
  const layout = fitTextBlock(text, 180, {
    maxFontSize: 48,
    minFontSize: 18,
    maxLines: 5,
    fontWeight: 800
  });
  assert.ok(layout.lineCount <= 5);
  assert.ok(layout.text.replace(/\n/g, " ").replace(/\s+/g, " ").includes("Judul pertama"));
  assert.ok(layout.text.replace(/\n/g, "").includes("Supercalifragilisticexpialidocious"));
  assert.equal(layout.fits, true);
});
