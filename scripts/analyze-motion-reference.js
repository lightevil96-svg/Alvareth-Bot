import { analyzeReferenceVideo } from '../lib/motion-engine/reference-analyzer.js';

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('Usage: npm run motion:analyze-reference -- <video-path> [<video-path> ...]');
  process.exitCode = 2;
} else {
  for (const videoPath of inputs) {
    try {
      const report = await analyzeReferenceVideo(videoPath);
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } catch (error) {
      console.error('[REFERENCE ANALYZER] ' + videoPath + ': ' + String(error?.message || error));
      process.exitCode = 1;
    }
  }
}
