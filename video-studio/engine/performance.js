import { availableParallelism, totalmem } from "os";
import { readFileSync } from "fs";

const GIB = 1024 ** 3;

function readLimit(paths) {
  for (const path of paths) {
    try {
      const value = readFileSync(path, "utf8").trim();
      if (!value || value === "max") continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 2 ** 60) return parsed;
    } catch {}
  }
  return null;
}

export function getContainerResources() {
  const cpuCount = Math.max(1, Number(availableParallelism?.() || 1));
  const memoryLimit = readLimit([
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes"
  ]);
  return {
    cpuCount,
    memoryBytes: memoryLimit || totalmem(),
    memoryLimitDetected: Boolean(memoryLimit)
  };
}

function parseConcurrency(value, cores) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const percent = raw.match(/^(\d+(?:\.\d+)?)%$/);
  if (percent) return Math.max(1, Math.min(cores, Math.floor(cores * Math.max(1, Math.min(100, Number(percent[1]))) / 100)));
  if (/^\d+$/.test(raw)) return Math.max(1, Math.min(cores, Number(raw)));
  return null;
}

export function resolveRenderConcurrency({
  cores = getContainerResources().cpuCount,
  memoryBytes = getContainerResources().memoryBytes,
  override = process.env.VIDEO_STUDIO_RENDER_CONCURRENCY
} = {}) {
  const cpuCount = Math.max(1, Math.floor(Number(cores) || 1));
  const configured = parseConcurrency(override, cpuCount);
  if (configured !== null) return Math.min(8, configured);
  const cpuTarget = cpuCount <= 2 ? 1 : Math.max(1, cpuCount - 1);
  const memoryGiB = Math.max(0.5, Number(memoryBytes) / GIB);
  const memoryTarget = Math.max(1, Math.floor((memoryGiB * 0.55) / 1.25));
  return Math.max(1, Math.min(8, cpuTarget, memoryTarget));
}

export function resolveOffthreadVideoThreads(cores = getContainerResources().cpuCount) {
  const cpuCount = Math.max(1, Math.floor(Number(cores) || 1));
  if (cpuCount <= 2) return 1;
  return Math.max(2, Math.min(4, Math.ceil(cpuCount / 4)));
}

// Remotion uses this for an individual delayRender() frame wait, not the total job duration.
 // Use a very long timer (~24.8 days) so slow frames are not cut off.
export function resolveRenderTimeout() {
  // Leave headroom for Remotion's internal timer offset to avoid Node's 32-bit overflow.
  return 2_147_000_000;
}

export function resolveH264Bitrate({ width, height, fps }) {
  const pixelsPerSecond = Math.max(1, Number(width) * Number(height) * Number(fps));
  const bitsPerSecond = Math.max(5000000, Math.min(24000000, pixelsPerSecond * 0.075));
  return Math.round(bitsPerSecond / 500000) * 500 + "k";
}

export function resolveRenderSettings(project) {
  const resources = getContainerResources();
  return {
    concurrency: resolveRenderConcurrency(resources),
    crf: 18,
    x264Preset: "medium",
    timeoutInMilliseconds: resolveRenderTimeout(),
    offthreadVideoThreads: resolveOffthreadVideoThreads(resources.cpuCount),
    offthreadVideoCacheSizeInBytes: Math.max(128 * 1024 ** 2, Math.min(1024 * 1024 ** 2, Math.floor(resources.memoryBytes * 0.18)))
  };
}
