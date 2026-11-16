import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const MOTION_QA_FRAME_WIDTH = 72;
export const MOTION_QA_FRAME_HEIGHT = 128;

export function parseFrameRate(value) {
  const source = String(value || '').trim();
  if (!source) return 0;
  const [numerator, denominator = '1'] = source.split('/');
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0 ? top / bottom : 0;
}

export function summarizeMotionFrames(buffer, options = {}) {
  const width = Math.max(1, Number(options.width) || MOTION_QA_FRAME_WIDTH);
  const height = Math.max(1, Number(options.height) || MOTION_QA_FRAME_HEIGHT);
  const frameBytes = width * height * 3;
  const frameCount = Math.floor((buffer?.length || 0) / frameBytes);
  const frames = [];
  const warnings = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const offset = frameIndex * frameBytes;
    let sum = 0;
    let sumSquares = 0;
    let red = 0;
    let blue = 0;
    for (let pixel = 0; pixel < frameBytes; pixel += 3) {
      const r = buffer[offset + pixel] / 255;
      const g = buffer[offset + pixel + 1] / 255;
      const b = buffer[offset + pixel + 2] / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSquares += luma * luma;
      red += r;
      blue += b;
    }
    const pixels = width * height;
    const mean = sum / pixels;
    const variance = Math.max(0, sumSquares / pixels - mean * mean);
    frames.push({
      meanLuma: mean,
      contrast: Math.sqrt(variance),
      warmth: (red - blue) / pixels
    });
  }

  if (frameCount < 3) warnings.push('Kurang dari tiga frame sampel berhasil dibaca.');
  const blackFrames = frames.filter(frame => frame.meanLuma < 0.025).length;
  if (blackFrames) warnings.push(blackFrames + ' frame sampel hampir seluruhnya hitam.');
  const lowContrastFrames = frames.filter(frame => frame.contrast < 0.025).length;
  if (lowContrastFrames >= Math.max(2, Math.ceil(frameCount / 2))) {
    warnings.push('Sebagian besar frame sampel memiliki kontras sangat rendah.');
  }

  const differences = [];
  for (let index = 1; index < frames.length; index++) {
    differences.push(
      Math.abs(frames[index].meanLuma - frames[index - 1].meanLuma) +
      Math.abs(frames[index].warmth - frames[index - 1].warmth) * 0.25 +
      Math.abs(frames[index].contrast - frames[index - 1].contrast)
    );
  }
  const frozenPairs = differences.filter(value => value < 0.00015).length;
  if (frameCount >= 4 && frozenPairs >= frameCount - 2) {
    warnings.push('Sampel berurutan nyaris identik; periksa kemungkinan frame beku.');
  }

  return {
    sampleCount: frameCount,
    blackFrames,
    lowContrastFrames,
    frozenPairs,
    averageLuma: frames.length ? frames.reduce((sum, frame) => sum + frame.meanLuma, 0) / frames.length : 0,
    averageContrast: frames.length ? frames.reduce((sum, frame) => sum + frame.contrast, 0) / frames.length : 0,
    averageWarmth: frames.length ? frames.reduce((sum, frame) => sum + frame.warmth, 0) / frames.length : 0,
    warnings
  };
}

export async function runMotionRenderQa(videoPath, options = {}) {
  const execute = options.execFileImpl || execFileAsync;
  const ffprobe = options.ffprobePath || 'ffprobe';
  const ffmpeg = options.ffmpegPath || 'ffmpeg';
  try {
    const probeResult = await execute(ffprobe, [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', String(videoPath)
    ], { maxBuffer: 2 * 1024 * 1024 });
    const probe = JSON.parse(String(probeResult.stdout || '{}'));
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const video = streams.find(stream => stream.codec_type === 'video');
    const audio = streams.some(stream => stream.codec_type === 'audio');
    if (!video) return { status: 'failed', warnings: ['Stream video tidak ditemukan oleh FFprobe.'] };

    const fps = parseFrameRate(video.avg_frame_rate || video.r_frame_rate);
    const durationSeconds = Number(probe.format?.duration || video.duration || 0);
    const frameCount = Number(video.nb_frames) > 0
      ? Number(video.nb_frames)
      : Math.max(1, Math.round(durationSeconds * fps));
    const sampleCount = Math.min(8, Math.max(3, frameCount));
    const indexes = Array.from({ length: sampleCount }, (_, index) =>
      Math.max(0, Math.min(frameCount - 1, Math.round(((index + 1) / (sampleCount + 1)) * (frameCount - 1)))
    );
    const select = indexes.map(index => 'eq(n\\,' + index + ')').join('+');
    const frameResult = await execute(ffmpeg, [
      '-v', 'error', '-i', String(videoPath),
      '-vf', 'select=' + select + ',scale=' + MOTION_QA_FRAME_WIDTH + ':' + MOTION_QA_FRAME_HEIGHT + ':flags=area,format=rgb24',
      '-vsync', '0', '-f', 'rawvideo', 'pipe:1'
    ], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 });
    const frameBuffer = Buffer.isBuffer(frameResult.stdout)
      ? frameResult.stdout
      : Buffer.from(frameResult.stdout || '');
    const visual = summarizeMotionFrames(frameBuffer);
    const warnings = [...visual.warnings];
    if (video.width !== 1080 || video.height !== 1920) {
      warnings.push('Resolusi output ' + video.width + 'x' + video.height + '; target 1080x1920.');
    }
    if (Math.abs(fps - 30) > 0.5) warnings.push('Frame rate output ' + fps + ' FPS; target 30 FPS.');
    if (!audio) warnings.push('Audio stream tidak ditemukan pada MP4.');
    if (!(durationSeconds > 0)) warnings.push('Durasi output tidak dapat diverifikasi.');
    return {
      status: warnings.length ? 'warning' : 'passed',
      durationSeconds,
      fps,
      resolution: { width: video.width, height: video.height },
      hasAudio: audio,
      visual,
      warnings
    };
  } catch (error) {
    return {
      status: 'not-run',
      warnings: ['Visual QA otomatis tidak dapat dijalankan: ' + String(error?.message || error).slice(0, 240)]
    };
  }
}
