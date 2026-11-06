import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ensureVideoAudioAssets } from "./audio-assets.js";
import { resolveRenderSettings } from "./engine/performance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let serveUrlPromise;

async function getServeUrl() {
  if (!serveUrlPromise) {
    serveUrlPromise = ensureVideoAudioAssets().then(() => import("@remotion/bundler")).then(({ bundle }) => bundle({
      entryPoint: join(__dirname, "remotion", "index.jsx"),
      publicDir: join(__dirname, "remotion", "public"),
      symlinkPublicDir: true,
      webpackOverride: config => config
    })).catch(error => { serveUrlPromise = null; throw error; });
  }
  return serveUrlPromise;
}

export async function renderVideoProject(project, outputPath, onProgress = () => {}) {
  console.log("[REMOTION:RENDER] Menyiapkan bundle Remotion...");
  const [{ renderMedia, selectComposition }, serveUrl] = await Promise.all([import("@remotion/renderer"), getServeUrl()]);
  console.log("[REMOTION:RENDER] Bundle siap; memilih komposisi video.");
  await mkdir(dirname(outputPath), { recursive: true });
  const inputProps = {
    title: project.title,
    scenes: project.scenes,
    brandCredit: project.brandCredit || "",
    fps: project.fps,
    width: project.width,
    height: project.height,
    musicStyle: project.musicStyle,
    soundEffects: project.soundEffects,
    voiceoverTracks: project.voiceoverTracks || [],
    captions: project.captions || [],
    mediaCredits: project.mediaCredits || [],
    musicTrackSrc: project.musicTrackSrc || "",
    musicVolume: project.musicVolume ?? 0.16,
    musicBpm: project.musicBpm || 0,
    captionStyle: project.captionStyle || "tiktok",
    captionPosition: project.captionPosition || "bottom"
  };
  const chromiumOptions = { gl: "angle" };
  const composition = await selectComposition({ serveUrl, id: "LightJurnalVideo", inputProps, chromiumOptions });
  const renderSettings = resolveRenderSettings(project);
  console.log("[REMOTION:RENDER] Mulai encode " + composition.durationInFrames + " frame @ " + composition.fps + " FPS.");
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    chromiumOptions,
    concurrency: renderSettings.concurrency,
    crf: renderSettings.crf,
    x264Preset: renderSettings.x264Preset,
    timeoutInMilliseconds: renderSettings.timeoutInMilliseconds,
    offthreadVideoThreads: renderSettings.offthreadVideoThreads,
    offthreadVideoCacheSizeInBytes: renderSettings.offthreadVideoCacheSizeInBytes,
    onProgress: ({ progress }) => onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))))
  });
  console.log("[REMOTION:RENDER] Encode selesai.");
  return outputPath;
}
