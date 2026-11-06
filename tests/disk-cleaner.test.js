import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Disk Manager preview and cleanup only remove stale files from allowlisted temp roots", async t => {
  const base = await mkdtemp(path.join(tmpdir(), "alvareth-disk-"));
  const data = path.join(base, "data");
  const waTmp = path.join(data, "tmp");
  const project = path.join(base, "project");
  const generated = path.join(project, "video-studio", "remotion", "public", "generated");
  await mkdir(waTmp, { recursive: true });
  await mkdir(generated, { recursive: true });
  await mkdir(path.join(data, "session"), { recursive: true });
  await writeFile(path.join(waTmp, "old-media.bin"), Buffer.alloc(4096));
  await writeFile(path.join(waTmp, "new-media.bin"), Buffer.alloc(128));
  await writeFile(path.join(generated, "old-render-asset.bin"), Buffer.alloc(2048));
  await writeFile(path.join(data, "session", "creds.json"), "keep-me");
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await utimes(path.join(waTmp, "old-media.bin"), old, old);
  await utimes(path.join(generated, "old-render-asset.bin"), old, old);
  await symlink(path.join(data, "session", "creds.json"), path.join(waTmp, "session-link")).catch(() => {});

  const oldEnv = {
    data: process.env.ALVARETH_DATA_DIR,
    tmp: process.env.ALVARETH_WA_TMPDIR
  };
  process.env.ALVARETH_DATA_DIR = data;
  process.env.ALVARETH_WA_TMPDIR = waTmp;
  const moduleUrl = new URL("../lib/disk-cleaner.js?test=" + Date.now(), import.meta.url);
  try {
    const cleaner = await import(moduleUrl);
    const preview = await cleaner.getSafeCleanupPreview();
    assert.equal(preview.totalFiles, 2);
    assert.equal(preview.totalBytes, 6144);
    const result = await cleaner.cleanSafeTempFiles(preview);
    assert.equal(result.deletedFiles, 2);
    assert.equal(result.deletedBytes, 6144);
    await assert.rejects(stat(path.join(waTmp, "old-media.bin")));
    await assert.rejects(stat(path.join(generated, "old-render-asset.bin")));
    assert.equal((await stat(path.join(waTmp, "new-media.bin"))).size, 128);
    assert.equal(await import("node:fs/promises").then(fs => fs.readFile(path.join(data, "session", "creds.json"), "utf8")), "keep-me");
  } finally {
    oldEnv.data === undefined ? delete process.env.ALVARETH_DATA_DIR : process.env.ALVARETH_DATA_DIR = oldEnv.data;
    oldEnv.tmp === undefined ? delete process.env.ALVARETH_WA_TMPDIR : process.env.ALVARETH_WA_TMPDIR = oldEnv.tmp;
    await rm(base, { recursive: true, force: true });
  }
});

test("Disk Manager cleanup rejects expired previews", async () => {
  const cleaner = await import("../lib/disk-cleaner.js");
  await assert.rejects(
    cleaner.cleanSafeTempFiles({ candidates: [], expiresAt: new Date(Date.now() - 1000).toISOString(), createdAt: new Date().toISOString() }),
    /kedaluwarsa/
  );
});

test("formatBytes produces readable storage units", async () => {
  const { formatBytes } = await import("../lib/disk-cleaner.js");
  assert.equal(formatBytes(1024), "1.00 KB");
  assert.equal(formatBytes(1024 ** 3), "1.00 GB");
});
