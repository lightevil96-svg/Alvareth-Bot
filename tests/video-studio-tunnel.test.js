import test from "node:test";
import assert from "node:assert/strict";
import { getCloudflaredAssetName } from "../video-studio/tunnel.js";

test("selects the official cloudflared Linux binary for x64 and ARM64", () => {
  assert.equal(getCloudflaredAssetName("linux", "x64"), "cloudflared-linux-amd64");
  assert.equal(getCloudflaredAssetName("linux", "arm64"), "cloudflared-linux-arm64");
});

test("does not guess unsupported operating systems or architectures", () => {
  assert.equal(getCloudflaredAssetName("win32", "x64"), null);
  assert.equal(getCloudflaredAssetName("linux", "ia32"), null);
});
