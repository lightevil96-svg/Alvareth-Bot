import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), "remotion", "public", "audio");
const RATE = 24000;

function wav(samples) {
  const size = samples.length * 2;
  const buffer = Buffer.alloc(44 + size);
  buffer.write("RIFF");
  buffer.writeUInt32LE(36 + size, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(size, 40);
  samples.forEach((value, index) => {
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), 44 + index * 2);
  });
  return buffer;
}

function makeEffect(type, seconds, seed) {
  const count = Math.floor(RATE * seconds);
  const samples = new Float32Array(count);
  let state = seed >>> 0;
  let peak = 0;
  let previousNoise = 0;
  const noise = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 2147483648) - 1;
  };
  const pulse = (time, center, width) => Math.max(0, 1 - Math.abs(time - center) / width);
  for (let index = 0; index < count; index++) {
    const time = index / RATE;
    const progress = time / seconds;
    const random = noise();
    const highNoise = random - previousNoise * 0.72;
    previousNoise = random;
    let sample = 0;
    if (type === "whoosh") {
      const envelope = Math.pow(Math.sin(Math.PI * progress), 1.7);
      sample = (highNoise * 0.72 + Math.sin(2 * Math.PI * (780 - 420 * progress) * time) * 0.24) * envelope;
    } else if (type === "swipe") {
      const envelope = Math.pow(Math.sin(Math.PI * progress), 2.2);
      sample = (highNoise * 0.95 + Math.sin(2 * Math.PI * (1450 - 900 * progress) * time) * 0.12) * envelope;
    } else if (type === "click") {
      sample = (Math.sin(2 * Math.PI * 1550 * time) * 0.45 + highNoise * 0.55) * Math.exp(-time * 42);
    } else if (type === "pop") {
      sample = (Math.sin(2 * Math.PI * (610 - 300 * progress) * time) + 0.22 * Math.sin(2 * Math.PI * 1220 * time)) * Math.exp(-time * 13);
    } else if (type === "impact" || type === "thud") {
      const strength = type === "impact" ? 1 : 0.78;
      const transient = Math.exp(-time * (type === "impact" ? 34 : 24));
      const body = Math.sin(2 * Math.PI * (92 - 38 * progress) * time) * Math.exp(-time * 7.5);
      sample = strength * (body * 0.92 + highNoise * 0.34 * transient);
    } else if (type === "footstep") {
      const envelope = Math.max(pulse(time, 0.055, 0.07), pulse(time, seconds * 0.57, 0.08));
      sample = (Math.sin(2 * Math.PI * (88 - 28 * progress) * time) * 0.75 + highNoise * 0.42) * envelope;
    } else if (type === "sparkle") {
      const chime = [1046.5, 1318.5, 1568, 2093].reduce((sum, frequency, harmonic) => {
        const delay = harmonic * 0.045;
        const local = Math.max(0, time - delay);
        return sum + Math.sin(2 * Math.PI * frequency * local) * Math.exp(-local * (8 + harmonic * 2)) * 0.23;
      }, 0);
      sample = chime + highNoise * 0.06 * Math.exp(-time * 16);
    } else if (type === "riser") {
      const envelope = progress * progress;
      const frequency = 140 + 1050 * progress;
      sample = (Math.sin(2 * Math.PI * frequency * time) * 0.38 + highNoise * 0.48) * envelope;
    } else if (type === "typing") {
      const keyRate = 0.115;
      const nearest = Math.round(time / keyRate) * keyRate;
      const envelope = Math.max(0, 1 - Math.abs(time - nearest) / 0.018) * (0.65 + 0.35 * Math.abs(Math.sin(nearest * 37)));
      sample = (highNoise * 0.75 + Math.sin(2 * Math.PI * 1850 * time) * 0.25) * envelope;
    } else if (type === "water") {
      const bubbles = Math.sin(2 * Math.PI * (260 + 170 * Math.sin(time * 19)) * time) * 0.36;
      const splash = Math.max(0, Math.sin(Math.PI * progress)) * 0.5;
      sample = (highNoise * 0.7 + bubbles) * splash;
    } else if (type === "drop") {
      const envelope = Math.exp(-time * 18);
      sample = (Math.sin(2 * Math.PI * (980 - 620 * progress) * time) * 0.65 + highNoise * 0.2) * envelope;
    } else if (type === "camera") {
      const shutter = Math.exp(-time * 52);
      const spring = Math.sin(2 * Math.PI * (320 - 80 * progress) * time) * Math.exp(-time * 15);
      sample = highNoise * 0.48 * shutter + spring * 0.38;
    }
    samples[index] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const gain = type === "whoosh" || type === "swipe" ? 0.5 : 0.68;
  if (peak > 0) {
    for (let index = 0; index < samples.length; index++) samples[index] = samples[index] / peak * gain;
  }
  return samples;
}

export async function ensureVideoAudioAssets() {
  await mkdir(AUDIO_DIR, { recursive: true });
  const definitions = {
    "sfx-whoosh.wav": ["whoosh", 0.72, 11],
    "sfx-swipe.wav": ["swipe", 0.42, 17],
    "sfx-click.wav": ["click", 0.12, 19],
    "sfx-pop.wav": ["pop", 0.34, 23],
    "sfx-impact.wav": ["impact", 0.62, 29],
    "sfx-footstep.wav": ["footstep", 0.48, 31],
    "sfx-thud.wav": ["thud", 0.42, 37],
    "sfx-sparkle.wav": ["sparkle", 0.78, 41],
    "sfx-riser.wav": ["riser", 1.05, 43],
    "sfx-typing.wav": ["typing", 0.78, 47],
    "sfx-water.wav": ["water", 0.85, 53],
    "sfx-drop.wav": ["drop", 0.28, 59],
    "sfx-camera.wav": ["camera", 0.3, 61]
  };
  await Promise.all(Object.entries(definitions).map(async ([filename, [type, duration, seed]]) => {
    await writeFile(join(AUDIO_DIR, filename), wav(makeEffect(type, duration, seed)));
  }));
}
