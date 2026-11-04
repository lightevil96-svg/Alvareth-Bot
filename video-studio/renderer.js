import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ensureVideoAudioAssets } from "./audio-assets.js";

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
  const [{ renderMedia, selectComposition }, serveUrl] = await Promise.all([import("@remotion/renderer"), getServeUrl()]);
  await mkdir(dirname(outputPath), { recursive: true });
  const inputProps = {
    title: project.title,
    scenes: project.scenes,
    fps: project.fps,
    width: project.width,
    height: project.height,
    musicStyle: project.musicStyle,
    soundEffects: project.soundEffects,
    voiceoverTracks: project.voiceoverTracks || [],
    captions: project.captions || [],
    mediaCredits: project.mediaCredits || []
  };
  const composition = await selectComposition({ serveUrl, id: "LightJurnalVideo", inputProps });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))))
  });
  return outputPath;
}
