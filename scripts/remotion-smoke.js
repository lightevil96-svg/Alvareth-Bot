// Default is real local integration; --fixture exercises rendering without claiming AI inference.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planVideoPrompt, normalizeVideoPlan } from '../video-studio/prompt/planner.js';
import { compileVideoPlan } from '../video-studio/prompt/compile.js';
import { prepareVideoMedia } from '../video-studio/media/pipeline.js';
import { renderVideoProject } from '../video-studio/renderer.js';
import { validateVideoProject } from '../video-studio/validate.js';
const fixture = process.argv.includes('--fixture');
const prompt = 'Buat video promosi kopi lokal untuk Reels, narasi bahasa Indonesia, gaya premium hangat, teks singkat dan efek suara halus, tanpa musik. Jangan buat klaim harga atau kesehatan.';
const out = resolve(process.env.REMOTION_SMOKE_DIR || '/tmp/alvareth-remotion-smoke');
await mkdir(out, {recursive:true});
const plan = fixture ? normalizeVideoPlan({title:'Kopi Lokal',ratio:'9:16',fps:24,musicStyle:'none',scenes:[
  {text:'Awali dengan aroma',subtext:'Kopi lokal • momen sederhana',durationSeconds:3,layout:'hero',motion:'scale-in',soundCue:'pop',background:'#17130F',accent:'#E4B77D',backgroundEffect:'orbs'},
  {text:'Nikmati jedanya',subtext:'Temukan rasa pilihanmu',durationSeconds:3,layout:'outro',transition:'wipe',soundCue:'whoosh',background:'#17130F',accent:'#E4B77D',callouts:[{text:'Kopi lokal',position:'top-right',delaySeconds:1,durationSeconds:1}]}]},prompt) : await planVideoPrompt(prompt);
let project=compileVideoPlan(plan);
if (!fixture) {
  process.env.VIDEO_STUDIO_VOICE_REQUIRED='true';
  project=validateVideoProject(await prepareVideoMedia(project,'production-smoke'));
  if (!project.voiceoverTracks.length) throw new Error('Smoke test requires actual VoxCPM2 speech');
}
await writeFile(join(out,'plan.json'),JSON.stringify({fixture,prompt,plan},null,2));
await renderVideoProject(project,join(out,'smoke.mp4'));
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(out,'smoke.mp4')]));
execFileSync('ffmpeg',['-v','error','-xerror','-i',join(out,'smoke.mp4'),'-f','null','-'],{timeout:60000});
const video=probe.streams.find(s=>s.codec_type==='video'), audio=probe.streams.find(s=>s.codec_type==='audio');
if (video?.codec_name!=='h264'||video.width!==project.width||video.height!==project.height||!audio) throw new Error('Unexpected output streams');
await writeFile(join(out,'verification.json'),JSON.stringify({fixture,voiceover:project.voiceoverTracks.length>0,probe},null,2));
console.log(JSON.stringify({output:join(out,'smoke.mp4'),fixture,voiceover:project.voiceoverTracks.length>0,duration:probe.format.duration}));
