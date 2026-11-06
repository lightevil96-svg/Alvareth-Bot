import test from "node:test";
import assert from "node:assert/strict";

test("edit plugin is owner-only and exposes the interactive editor menu", async () => {
  const { default: handler } = await import("../plugins/owner/edit.js");
  const replies = [];
  const sent = [];
  const m = {
    chat: "edit-test-chat",
    sender: "edit-owner",
    reply: async value => replies.push(String(value))
  };
  const conn = { sendMessage: async (...args) => sent.push(args) };

  assert.equal(handler.rowner, true);
  await handler(m, { conn, text: "", isROwner: false, usedPrefix: "!" });
  assert.match(replies.at(-1), /hanya dapat digunakan oleh owner/i);
  assert.equal(sent.length, 0);

  await handler(m, { conn, text: "", isROwner: true, usedPrefix: "!" });
  assert.equal(sent.length, 1);
  const rows = sent[0][1].nativeFlow[0].sections.flatMap(section => section.rows);
  assert.deepEqual(rows.map(row => row.id), [
    "!edit auto",
    "!edit settings",
    "!edit guide",
    "!edit json",
    "!edit status",
    "!edit cancel"
  ]);
});

test("raw JSON prompt session is bound to the owner sender and rejects malformed JSON", async () => {
  await import("../plugins/owner/edit.js");
  const sessions = global.__alvarethEditSessions;
  const key = "edit-json-chat:edit-json-owner";
  sessions.set(key, {
    sender: "edit-json-owner",
    chat: "edit-json-chat",
    sourcePath: "/tmp/not-read-by-this-test",
    createdAt: Date.now(),
    awaitingJson: true,
    settings: { ratio: "9:16", maxDurationSeconds: 60, removeSilence: true }
  });
  const replies = [];
  const conn = { prefix: "." };
  const otherOwner = await global.__alvarethEditPromptHandler({
    chat: "edit-json-chat",
    sender: "different-owner",
    text: "{broken",
    reply: async value => replies.push(String(value))
  }, { conn, isROwner: true });
  assert.equal(otherOwner, false);

  const consumed = await global.__alvarethEditPromptHandler({
    chat: "edit-json-chat",
    sender: "edit-json-owner",
    text: "{broken",
    reply: async value => replies.push(String(value))
  }, { conn, isROwner: true });
  assert.equal(consumed, true);
  assert.match(replies.at(-1), /JSON tidak valid/i);
  assert.equal(sessions.get(key).awaitingJson, true);
  sessions.delete(key);
});
