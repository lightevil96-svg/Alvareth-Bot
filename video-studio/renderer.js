import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
let serveUrlPromise

async function getServeUrl() {
  if (!serveUrlPromise) {
    serveUrlPromise = import('@remotion/bundler').then(({ bundle }) => bundle({
      entryPoint: join(__dirname, 'remotion', 'index.jsx'),
      webpackOverride: config => config
    })).catch(error => { serveUrlPromise = null; throw error })
  }
  return serveUrlPromise
}

export async function renderVideoProject(project, outputPath, onProgress = () => {}) {
  const [{ renderMedia, selectComposition }, serveUrl] = await Promise.all([import('@remotion/renderer'), getServeUrl()])
  await mkdir(dirname(outputPath), { recursive: true })
  const inputProps = { title: project.title, scenes: project.scenes, fps: project.fps, width: project.width, height: project.height }
  const composition = await selectComposition({ serveUrl, id: 'LightJurnalVideo', inputProps })
  await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: outputPath, inputProps,
    onProgress: ({ progress }) => onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))))
  })
  return outputPath
}
