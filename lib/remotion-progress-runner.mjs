import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const PROGRESS_PREFIX = '__ALVARETH_REMOTION_PROGRESS__'

function emit(payload) {
  try {
    process.stdout.write(PROGRESS_PREFIX + JSON.stringify(payload) + '\n')
  } catch {}
}

function requiredArgument(value, label) {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(label + ' wajib diisi.')
  return result
}

async function main() {
  const [entryArgument, compositionIdArgument, outputArgument, glArgument = '', browserArgument = '', concurrencyArgument = '1'] = process.argv.slice(2)
  const rootDir = process.cwd()
  const entryPoint = path.resolve(rootDir, requiredArgument(entryArgument, 'Entry point'))
  const compositionId = requiredArgument(compositionIdArgument, 'Composition ID')
  const outputLocation = path.resolve(rootDir, requiredArgument(outputArgument, 'Output path'))
  const gl = String(glArgument || '').trim()
  const browserExecutable = String(browserArgument || '').trim() || undefined
  const concurrencyNumber = Number(concurrencyArgument)
  const concurrency = Number.isSafeInteger(concurrencyNumber) && concurrencyNumber > 0
    ? concurrencyNumber
    : 1
  const chromiumOptions = gl ? { gl } : {}

  emit({ kind: 'stage', stage: 'Membundelkan proyek Remotion' })
  const serveUrl = await bundle({
    entryPoint,
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    onProgress: percent => emit({
      kind: 'bundle',
      percent: Number(percent)
    })
  })

  emit({ kind: 'stage', stage: 'Memilih composition' })
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    browserExecutable,
    chromiumOptions,
    logLevel: 'error'
  })

  emit({
    kind: 'composition',
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
    width: composition.width,
    height: composition.height
  })

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    concurrency,
    browserExecutable,
    chromiumOptions,
    logLevel: 'error',
    disallowParallelEncoding: true,
    disableSharedMemoryCapture: true,
    onStart: ({ frameCount, resolvedConcurrency }) => emit({
      kind: 'render-start',
      frameCount: Number(frameCount),
      fps: Number(composition.fps),
      concurrency: Number(resolvedConcurrency)
    }),
    onProgress: value => emit({
      kind: 'render',
      progress: Number(value.progress),
      renderedFrames: Number(value.renderedFrames),
      encodedFrames: Number(value.encodedFrames),
      renderEstimatedTime: Number(value.renderEstimatedTime),
      stitchStage: String(value.stitchStage || '')
    })
  })

  emit({ kind: 'done' })
}

main().catch(error => {
  console.error('[ALVARETH REMOTION] Render gagal:', error?.stack || error)
  process.exitCode = 1
})
