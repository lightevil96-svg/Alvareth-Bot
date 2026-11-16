import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const REFERENCE_SAMPLE_WIDTH = 72;
export const REFERENCE_SAMPLE_HEIGHT = 128;

export function parseReferenceFrameRate(value) {
  const source = String(value || '').trim();
  if (!source) return 0;
  const [numerator, denominator = '1'] = source.split('/');
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0 ? top / bottom : 0;
}

function toHex(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
}

export function summarizeReferenceFrames(buffer, options = {}) {
  const width = Math.max(1, Math.floor(Number(options.width) || REFERENCE_SAMPLE_WIDTH));
  const height = Math.max(1, Math.floor(Number(options.height) || REFERENCE_SAMPLE_HEIGHT));
  const frameBytes = width * height * 3;
  const frameCount = Math.floor((buffer?.length || 0) / frameBytes);
  const frames = [];
  const palette = new Map();
  let totalPixels = 0;
  let totalLuma = 0;
  let totalLumaSquares = 0;
  let totalWarmth = 0;
  let totalSaturation = 0;
  let darkInkCandidates = 0;
  let earthToneCandidates = 0;
  let edgeCandidates = 0;
  let edgeComparisons = 0;
  let topCaptionCandidates = 0;
  let bottomCaptionCandidates = 0;
  let yellowCaptionCandidates = 0;
  let previousLuma = null;
  let motionDifference = 0;
  let motionComparisons = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const offset = frameIndex * frameBytes;
    const lumaValues = new Float32Array(width * height);
    let frameLuma = 0;
    let frameLumaSquares = 0;
    let frameWarmth = 0;
    let frameSaturation = 0;
    let frameDark = 0;
    let frameEarth = 0;
    let frameTopCaption = 0;
    let frameBottomCaption = 0;
    let frameYellowCaption = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = y * width + x;
        const byteIndex = offset + pixelIndex * 3;
        const red = buffer[byteIndex] / 255;
        const green = buffer[byteIndex + 1] / 255;
        const blue = buffer[byteIndex + 2] / 255;
        const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const saturation = maximum - minimum;
        lumaValues[pixelIndex] = luma;
        frameLuma += luma;
        frameLumaSquares += luma * luma;
        frameWarmth += red - blue;
        frameSaturation += saturation;

        if (luma < 0.19) frameDark++;
        if (red > green && green > blue && red - blue > 0.12 && luma > 0.08) frameEarth++;

        const inTopBand = y >= Math.floor(height * 0.04) && y <= Math.floor(height * 0.27);
        const inBottomBand = y >= Math.floor(height * 0.66) && y <= Math.floor(height * 0.92);
        const whiteCaption = luma > 0.78 && saturation < 0.24;
        const yellowCaption = red > 0.68 && green > 0.48 && blue < 0.38 && red > green;
        if ((inTopBand || inBottomBand) && whiteCaption) {
          if (inTopBand) frameTopCaption++;
          if (inBottomBand) frameBottomCaption++;
        }
        if ((inTopBand || inBottomBand) && yellowCaption) frameYellowCaption++;

        const quantized = [red, green, blue].map(channel => Math.min(15, Math.floor(channel * 16)));
        const paletteKey = (quantized[0] << 8) | (quantized[1] << 4) | quantized[2];
        const item = palette.get(paletteKey) || { count: 0, red: 0, green: 0, blue: 0 };
        item.count++;
        item.red += red;
        item.green += green;
        item.blue += blue;
        palette.set(paletteKey, item);
      }
    }

    const pixels = width * height;
    frameLuma /= pixels;
    frameLumaSquares /= pixels;
    frameWarmth /= pixels;
    frameSaturation /= pixels;
    frameDark /= pixels;
    frameEarth /= pixels;
    frameTopCaption /= Math.max(1, width * Math.floor(height * 0.24));
    frameBottomCaption /= Math.max(1, width * Math.floor(height * 0.26));
    frameYellowCaption /= Math.max(1, width * Math.floor(height * 0.5));

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        const horizontal = Math.abs(lumaValues[index + 1] - lumaValues[index - 1]);
        const vertical = Math.abs(lumaValues[index + width] - lumaValues[index - width]);
        edgeComparisons++;
        if (Math.max(horizontal, vertical) > 0.16) edgeCandidates++;
      }
    }

    if (previousLuma) {
      for (let index = 0; index < lumaValues.length; index++) {
        motionDifference += Math.abs(lumaValues[index] - previousLuma[index]);
        motionComparisons++;
      }
    }
    previousLuma = lumaValues;
    frames.push({
      meanLuma: frameLuma,
      contrast: Math.sqrt(Math.max(0, frameLumaSquares - frameLuma * frameLuma)),
      warmth: frameWarmth,
      saturation: frameSaturation,
      darkInkCandidateRatio: frameDark,
      earthToneCandidateRatio: frameEarth,
      topCaptionCandidateRatio: frameTopCaption,
      bottomCaptionCandidateRatio: frameBottomCaption,
      yellowCaptionCandidateRatio: frameYellowCaption
    });

    totalPixels += pixels;
    totalLuma += frameLuma;
    totalLumaSquares += frameLumaSquares;
    totalWarmth += frameWarmth;
    totalSaturation += frameSaturation;
    darkInkCandidates += frameDark;
    earthToneCandidates += frameEarth;
    topCaptionCandidates += frameTopCaption;
    bottomCaptionCandidates += frameBottomCaption;
    yellowCaptionCandidates += frameYellowCaption;
  }

  const topCaptionRatio = frames.length
    ? frames.reduce((sum, frame) => sum + frame.topCaptionCandidateRatio, 0) / frames.length
    : 0;
  const bottomCaptionRatio = frames.length
    ? frames.reduce((sum, frame) => sum + frame.bottomCaptionCandidateRatio, 0) / frames.length
    : 0;
  const captionPlacement = topCaptionRatio > bottomCaptionRatio * 1.15
    ? 'upper-biased'
    : bottomCaptionRatio > topCaptionRatio * 1.15
      ? 'lower-biased'
      : 'mixed-or-undetermined';

  const dominantPalette = [...palette.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([, item]) => ({
      color: '#' + toHex((item.red / item.count) * 255) +
        toHex((item.green / item.count) * 255) +
        toHex((item.blue / item.count) * 255),
      share: Number((item.count / Math.max(1, totalPixels)).toFixed(4))
    }));

  return {
    sampleCount: frameCount,
    frameSize: { width, height },
    averageLuma: frames.length ? totalLuma / frames.length : 0,
    averageContrast: frames.length
      ? Math.sqrt(Math.max(0, totalLumaSquares / frames.length - (totalLuma / frames.length) ** 2))
      : 0,
    averageWarmth: frames.length ? totalWarmth / frames.length : 0,
    averageSaturation: frames.length ? totalSaturation / frames.length : 0,
    darkInkCandidateRatio: frames.length ? darkInkCandidates / frames.length : 0,
    earthToneCandidateRatio: frames.length ? earthToneCandidates / frames.length : 0,
    edgeDensity: edgeComparisons ? edgeCandidates / edgeComparisons : 0,
    frameDifference: motionComparisons ? motionDifference / motionComparisons : 0,
    captionPlacementCandidate: captionPlacement,
    topCaptionCandidateRatio: topCaptionRatio,
    bottomCaptionCandidateRatio: bottomCaptionRatio,
    yellowCaptionCandidateRatio: frames.length ? yellowCaptionCandidates / frames.length : 0,
    dominantPalette,
    notes: [
      'Pixel metrics are visual clues, not semantic recognition or proof of character identity.',
      'Outline thickness, exact character proportions, prop meaning and camera intent still require frame-level human/vision review.'
    ]
  };
}

export async function analyzeReferenceVideo(videoPath, options = {}) {
  const execute = options.execFileImpl || execFileAsync;
  const ffprobe = options.ffprobePath || 'ffprobe';
  const ffmpeg = options.ffmpegPath || 'ffmpeg';
  const width = Math.max(16, Math.floor(Number(options.width) || REFERENCE_SAMPLE_WIDTH));
  const height = Math.max(16, Math.floor(Number(options.height) || REFERENCE_SAMPLE_HEIGHT));
  const maxSamples = Math.max(3, Math.min(24, Math.floor(Number(options.maxSamples) || 12)));
  const sourcePath = String(videoPath || '').trim();
  if (!sourcePath) throw new Error('Path video referensi wajib diberikan.');

  const probeResult = await execute(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,nb_frames:format=duration',
    '-of', 'json',
    sourcePath
  ], { maxBuffer: 2 * 1024 * 1024 });
  const probe = JSON.parse(String(probeResult.stdout || '{}'));
  const video = (Array.isArray(probe.streams) ? probe.streams : [])[0];
  if (!video) throw new Error('FFprobe tidak menemukan stream video pada referensi.');
  const fps = parseReferenceFrameRate(video.avg_frame_rate) || parseReferenceFrameRate(video.r_frame_rate);
  const durationSeconds = Number(probe.format?.duration || video.duration || 0);
  const totalFrames = Number(video.nb_frames) > 0
    ? Number(video.nb_frames)
    : Math.round(durationSeconds * fps);
  if (!(fps > 0) || !(durationSeconds > 0) || !(totalFrames > 0)) {
    throw new Error('Metadata FPS, durasi atau jumlah frame video referensi tidak valid.');
  }

  const sampleCount = Math.min(maxSamples, totalFrames);
  if (sampleCount < 3) throw new Error('Video referensi terlalu pendek untuk dianalisis.');
  const indexes = [...new Set(Array.from({ length: sampleCount }, (_, index) =>
    Math.max(0, Math.min(totalFrames - 1, Math.round(((index + 1) / (sampleCount + 1)) * (totalFrames - 1))))
  ))];
  const select = indexes.map(index => 'eq(n\\,' + index + ')').join('+');
  const frameResult = await execute(ffmpeg, [
    '-v', 'error',
    '-i', sourcePath,
    '-vf', 'select=' + select + ',scale=' + width + ':' + height + ':flags=area,format=rgb24',
    '-vsync', '0',
    '-f', 'rawvideo',
    'pipe:1'
  ], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 });
  const frameBuffer = Buffer.isBuffer(frameResult.stdout)
    ? frameResult.stdout
    : Buffer.from(frameResult.stdout || '');
  const visual = summarizeReferenceFrames(frameBuffer, { width, height });
  if (visual.sampleCount < 3) {
    throw new Error('FFmpeg hanya menghasilkan ' + visual.sampleCount + ' frame sampel; minimal tiga diperlukan.');
  }

  return {
    source: sourcePath,
    metadata: {
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      fps,
      durationSeconds,
      totalFrames,
      aspectRatio: Number(video.height) > 0 ? Number(video.width) / Number(video.height) : 0
    },
    sampledFrameIndexes: indexes,
    visual
  };
}
