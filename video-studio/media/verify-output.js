import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

// Reject corrupt/incomplete exports before marking jobs completed or sending to WhatsApp.
export async function verifyVideoOutput(path, project) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout);
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
  if (!video || video.codec_name !== 'h264' || video.width !== project.width || video.height !== project.height) throw new Error('MP4 gagal validasi codec/resolusi.');
  const [num, den] = String(video.avg_frame_rate).split('/').map(Number);
  if (!den || Math.abs(num / den - project.fps) > .01) throw new Error('Frame rate MP4 tidak cocok.');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - project.durationInFrames / project.fps) > .2) throw new Error('Durasi MP4 tidak cocok dengan timeline.');
  if (project.voiceoverTracks?.length && !audio) throw new Error('Track narasi hilang dari MP4.');
  await run('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { timeout: 180000, maxBuffer: 1024 * 1024 });
  return { duration, videoCodec: video.codec_name, audioCodec: audio?.codec_name || null };
}
