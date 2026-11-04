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
function music(chords, bpm, seconds, seed) {
  const count = RATE * seconds, a = new Array(count), beat = 60 / bpm
  let rand = seed, peak = 0
  const noise = () => { rand = rand * 16807 % 2147483647; return rand / 1073741823.5 - 1 }
  for (let i = 0; i < count; i++) {
    const t = i / RATE, chord = chords[Math.floor(t / (beat * 4)) % chords.length], local = t % (beat * 4), bi = Math.floor(local / beat), bt = local % beat
    let pad = 0
    for (const m of chord) { const f = 440 * Math.pow(2, (m - 69) / 12); pad += Math.sin(2 * Math.PI * f * t) * .12 + Math.sin(4 * Math.PI * f * t) * .035 }
    const f = 440 * Math.pow(2, (chord[bi % chord.length] + 12 - 69) / 12)
    const pluck = Math.sin(2 * Math.PI * f * bt) * Math.exp(-bt * 4) * .12
    const kick = bt < .16 ? Math.sin(2 * Math.PI * (75 - 35 * bt / .16) * bt) * Math.exp(-bt * 24) * .16 : 0
    const hat = bt < .035 && (bi === 1 || bi === 3) ? noise() * Math.exp(-bt * 110) * .025 : 0
    const fade = Math.max(0, Math.min(1, t / 1.5, (seconds - t) / 2))
    a[i] = (pad * .42 + pluck + kick + hat) * fade; peak = Math.max(peak, Math.abs(a[i]))
  }
  return a.map(x => x / (peak || 1) * .62)
}
function effect(type, seconds, seed) {
  const count = Math.floor(RATE * seconds), a = new Array(count)
  let rand = seed, peak = 0
  const noise = () => { rand = rand * 16807 % 2147483647; return rand / 1073741823.5 - 1 }
  for (let i = 0; i < count; i++) {
    const t = i / RATE, p = t / seconds
    const x = type === 'whoosh' ? (noise() * .45 + .3 * Math.sin(2 * Math.PI * (700 - 500 * p) * t)) * Math.pow(Math.sin(Math.PI * p), 2)
      : type === 'pop' ? (Math.sin(2 * Math.PI * (520 - 300 * p) * t) + .25 * Math.sin(2 * Math.PI * 1040 * t)) * Math.exp(-t * 14)
      : (Math.sin(2 * Math.PI * (90 - 35 * p) * t) * Math.exp(-t * 8) + .25 * Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 22))
    a[i] = x; peak = Math.max(peak, Math.abs(x))
  }
  return a.map(x => x / (peak || 1) * .7)
}
export async function ensureVideoAudioAssets() {
  await mkdir(AUDIO_DIR, { recursive: true })
  const assets = {
    'music-cinematic.wav': music([[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,59]], 82, 24, 5),
    'music-upbeat.wav': music([[60,64,67,71],[55,59,62,67],[57,60,64,69],[53,57,60,65]], 112, 24, 9),
    'music-calm.wav': music([[60,64,67,72],[57,60,64,69],[53,57,60,65],[55,59,62,67]], 76, 24, 12),
    'sfx-whoosh.wav': effect('whoosh', .8, 11), 'sfx-pop.wav': effect('pop', .32, 13), 'sfx-impact.wav': effect('impact', .65, 17)
  }
  await Promise.all(Object.entries(assets).map(([name, samples]) => writeFile(join(AUDIO_DIR, name), wav(samples))))
}
