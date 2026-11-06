import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("edit plugin declares owner-only routing and an explicit runtime owner guard", async () => {
  const source = await readFile(new URL("../plugins/owner/edit.js", import.meta.url), "utf8");
  assert.match(source, /handler\.rowner\s*=\s*true/);
  assert.match(source, /context\.isROwner\s*!==\s*true/);
  assert.match(source, /Fitur AI Edit hanya dapat digunakan oleh owner/);
  assert.match(source, /nativeFlow/);
  assert.match(source, /Auto Edit/);
  assert.match(source, /Import JSON/);
});

test("raw JSON session hook checks owner status, sender binding, bot echoes and command prefixes", async () => {
  const plugin = await readFile(new URL("../plugins/owner/edit.js", import.meta.url), "utf8");
  const handler = await readFile(new URL("../handler.js", import.meta.url), "utf8");
  assert.match(plugin, /global\.__alvarethEditPromptHandler\s*=/);
  assert.match(plugin, /context\.isROwner\s*!==\s*true\s*\|\|\s*wasBotSentMessage\(m\)/);
  assert.match(plugin, /session\.sender\s*!==\s*m\.sender/);
  assert.match(plugin, /hasCommandPrefix\(prompt/);
  assert.match(handler, /global\.__alvarethEditPromptHandler/);
});
