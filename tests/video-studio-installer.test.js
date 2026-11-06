import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildVideoStudioInstallerEnvironment,
  getVideoStudioInstallerPaths,
  readVideoStudioInstallerStatus
} from "../video-studio/installer.js";

test("installer subprocess receives runtime variables but never WhatsApp credentials", () => {
  const env = buildVideoStudioInstallerEnvironment({
    HOME: "/home/alvareth",
    PATH: "/usr/bin",
    CUDA_VISIBLE_DEVICES: "0",
    NVIDIA_VISIBLE_DEVICES: "all",
    HF_ENDPOINT: "https://hf-mirror.com",
    OWNER_NUMBER: "628000000000",
    BOT_TOKEN: "must-not-leak",
    VIDEO_STUDIO_API_KEY: "must-not-leak"
  });
  assert.equal(env.HOME, "/home/alvareth");
  assert.match(env.PATH, /^\/home\/alvareth\/\.local\/bin:/);
  assert.equal(env.CUDA_VISIBLE_DEVICES, "0");
  assert.equal(env.NVIDIA_VISIBLE_DEVICES, "all");
  assert.equal(env.VIDEO_STUDIO_OLLAMA_MODEL, undefined);
  assert.equal(env.HF_ENDPOINT, "https://hf-mirror.com");
  assert.equal(env.OWNER_NUMBER, undefined);
  assert.equal(env.BOT_TOKEN, undefined);
  assert.equal(env.VIDEO_STUDIO_API_KEY, undefined);
  const cpuEnv = buildVideoStudioInstallerEnvironment({
    HOME: "/home/alvareth",
    PATH: "/usr/bin",
    VOXCPM_TORCH_INDEX_URL: "https://download.pytorch.org/whl/cu128"
  }, "cpu");
  assert.equal(cpuEnv.VOXCPM_TORCH_INDEX_URL, "https://download.pytorch.org/whl/cpu");
});

test("installer status reports running, completed, and failed setup from persistent files", async t => {
  const root = await mkdtemp(join(tmpdir(), "alvareth-installer-"));
  const env = { HOME: root, ALVARETH_DATA_DIR: join(root, "data") };
  const paths = getVideoStudioInstallerPaths(env);
  await mkdir(paths.lockDir, { recursive: true });
  await mkdir(paths.logDir, { recursive: true });
  await writeFile(paths.pidPath, String(process.pid));
  await writeFile(paths.logPath, "download started\nmodel downloaded\n");
  t.after(() => rm(root, { recursive: true, force: true }));

  let status = readVideoStudioInstallerStatus(env);
  assert.equal(status.status, "running");
  assert.equal(status.pid, process.pid);
  assert.match(status.logTail, /model downloaded/);

  await rm(paths.lockDir, { recursive: true, force: true });
  await writeFile(paths.exitCodePath, "0\n");
  status = readVideoStudioInstallerStatus(env);
  assert.equal(status.status, "completed");
  assert.equal(status.exitCode, 0);

  await writeFile(paths.exitCodePath, "1\n");
  status = readVideoStudioInstallerStatus(env);
  assert.equal(status.status, "failed");
  assert.equal(status.exitCode, 1);
});
