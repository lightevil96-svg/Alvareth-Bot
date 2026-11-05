import { SFX_SECONDS } from "./engine/sound-design.js";
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
const AUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), 'remotion', 'public', 'audio')
const RATE = 22050
function wav(samples) {
  const size = samples.length * 2, b = Buffer.alloc(44 + size)
  b.write('RIFF'); b.writeUInt32LE(36 + size, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40)
  samples.forEach((v, i) => b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2))
  return b
}
export function effect(type, seconds, seed) {
  const count = Math.floor(RATE * seconds), a = new Array(count)
  let rand = seed, peak = 0
  const noise = () => { rand = rand * 16807 % 2147483647; return rand / 1073741823.5 - 1 }
  for (let i = 0; i < count; i++) {
    const t = i / RATE, p = t / seconds
    const x = ['whoosh','swish','riser'].includes(type) ? (noise() * .45 + .3 * Math.sin(2 * Math.PI * (700 - 500 * p) * t)) * Math.pow(Math.sin(Math.PI * p), 2)
      : ['pop','click','chime','sparkle'].includes(type) ? (Math.sin(2 * Math.PI * (520 - 300 * p) * t) + .25 * Math.sin(2 * Math.PI * 1040 * t)) * Math.exp(-t * (type === 'chime' || type === 'sparkle' ? 5 : type === 'click' ? 50 : 14))
      : (Math.sin(2 * Math.PI * (90 - 35 * p) * t) * Math.exp(-t * 8) + .25 * Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 22))
    a[i] = x * Math.min(1, t / .005, (seconds - t) / .025); peak = Math.max(peak, Math.abs(x))
  }
  return a.map(x => x / (peak || 1) * .7)
}
export async function ensureVideoAudioAssets() {
  await mkdir(AUDIO_DIR, { recursive: true })
  const assets = Object.fromEntries(Object.entries(SFX_SECONDS).map(([cue, seconds], i) => ['sfx-' + cue + '.wav', effect(cue, seconds, 11 + i * 2)]));
  await Promise.all(Object.entries(assets).map(([name, samples]) => writeFile(join(AUDIO_DIR, name), wav(samples))));
}
