import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(MODULE_DIR, "..", "remotion", "public");
const WORKER = join(MODULE_DIR, "..", "scripts", "moss_sfx_worker.py");

const CUE_SECONDS = {
  whoosh: 0.72, swipe: 0.42, click: 0.12, pop: 0.34, impact: 0.62,
  footstep: 0.48, thud: 0.42, sparkle: 0.78, riser: 1.05,
  typing: 0.78, water: 0.85, drop: 0.28, camera: 0.3
};

const CUE_PROMPTS = {
  whoosh: "A short cinematic airy whoosh sweeping quickly from left to right, with a soft low-frequency body and a crisp high-frequency tail.",
  swipe: "A quick clean air swipe sound for a fast visual transition, crisp attack and short airy decay.",
  click: "One crisp mechanical interface button click, close and dry, with a tiny plastic tick.",
  pop: "A small bright pop as a graphic element appears, rounded attack and short natural decay.",
  impact: "A solid cinematic impact with a deep low thump and a crisp transient, like an object striking a firm surface.",
  footstep: "Two realistic footsteps on a hard indoor floor, close-miked, natural shoe contact and subtle room reflections.",
  thud: "A heavy soft object landing on a padded surface, deep short thud with little reverberation.",
  sparkle: "A brief delicate magical shimmer made of tiny bright glassy chimes, no musical melody.",
  riser: "A short airy rising tension sweep that quickly builds and resolves, no music bed.",
  typing: "A short cluster of tactile mechanical keyboard key presses, close and dry.",
  water: "A small realistic water splash with droplets and a short liquid tail.",
  drop: "A single water droplet falling into a shallow pool with a bright plink and tiny ripple.",
  camera: "A close camera shutter click with a small mechanical spring return."
};

function clean(value, max = 400) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function buildPrompt(scene, event) {
  const cue = clean(event.cue, 40);
  const base = clean(event.description, 280) || CUE_PROMPTS[cue] || "A short realistic cinematic sound effect.";
  const context = clean(scene.visualDescription || scene.aiVideoPrompt || scene.narration || scene.text, 180);
  return [
    "Generate one isolated, realistic Foley sound effect for a video edit.",
    base,
    context ? "Visible action context: " + context + "." : "",
    "Sound effect only. No speech, no voice, no narration, no music, no soundtrack, no background song."
  ].filter(Boolean).join(" ");
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      killTimer.unref?.();
      settled = true;
      reject(new Error("MOSS-SoundEffect melewati batas waktu. Periksa VRAM dan VIDEO_STUDIO_MOSS_SFX_TIMEOUT_MS."));
    }, timeoutMs);
    const collect = (current, chunk) => (current + chunk.toString()).slice(-16000);
    child.stdout.on("data", chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = collect(stderr, chunk); });
    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Tidak dapat menjalankan MOSS-SoundEffect worker: " + error.message));
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error("MOSS-SoundEffect gagal (exit " + code + "): " + clean(stderr || stdout, 1200)));
      else resolve({ stdout, stderr });
    });
  });
}

export async function prepareSoundEffects(project, jobId) {
  const scenes = Array.isArray(project?.scenes) ? project.scenes.map(scene => ({ ...scene })) : [];
  if (String(process.env.VIDEO_STUDIO_MOSS_SFX_ENABLED || "true").toLowerCase() === "false") {
    return { scenes, generatedCount: 0, warnings: [] };
  }

  const maxEvents = Math.max(1, Math.min(24, Number(process.env.VIDEO_STUDIO_MOSS_SFX_MAX_EVENTS) || 16));
  const unique = new Map();
  const links = [];

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex];
    const declared = Array.isArray(scene.soundEvents) ? scene.soundEvents : [];
    const events = declared.length
      ? declared
      : scene.soundCue && scene.soundCue !== "none"
        ? [{ cue: scene.soundCue, delaySeconds: 0, intensity: scene.soundIntensity }]
        : [];
    scene.soundEvents = events.slice(0, 5).map(event => ({ ...event }));
    for (let eventIndex = 0; eventIndex < scene.soundEvents.length; eventIndex++) {
      const event = scene.soundEvents[eventIndex];
      if (!CUE_PROMPTS[event.cue]) continue;
      const prompt = buildPrompt(scene, event);
      const seconds = Math.max(0.25, Math.min(4, Number(event.durationSeconds) || CUE_SECONDS[event.cue]));
      const key = prompt.toLowerCase() + "|" + seconds.toFixed(2);
      if (!unique.has(key)) {
        unique.set(key, { id: "sfx-" + String(unique.size + 1).padStart(3, "0"), prompt, seconds, index: unique.size });
      }
      links.push({ sceneIndex, eventIndex, key });
    }
  }

  if (!unique.size) return { scenes, generatedCount: 0, warnings: [] };

  const selected = Array.from(unique.entries()).slice(0, maxEvents);
  const selectedKeys = new Set(selected.map(([key]) => key));
  const overflowCount = unique.size - selected.length;
  const folder = join(PUBLIC_DIR, "generated", jobId, "moss-sfx");
  await mkdir(folder, { recursive: true });
  const inputPath = join(folder, "events.json");
  const outputDir = folder;
  await writeFile(inputPath, JSON.stringify(selected.map(([, item]) => ({
    id: item.id,
    prompt: item.prompt,
    seconds: item.seconds
  })), null, 2), "utf8");

  const python = clean(process.env.VIDEO_STUDIO_MOSS_SFX_PYTHON || "python3", 500);
  const modelId = clean(process.env.VIDEO_STUDIO_MOSS_SFX_MODEL_ID || "OpenMOSS-Team/MOSS-SoundEffect-v2.0", 180);
  const device = clean(process.env.VIDEO_STUDIO_MOSS_SFX_DEVICE || "cuda", 40);
  const steps = Math.max(10, Math.min(100, Number(process.env.VIDEO_STUDIO_MOSS_SFX_STEPS) || 50));
  const timeoutMs = Math.max(60000, Math.min(3600000, Number(process.env.VIDEO_STUDIO_MOSS_SFX_TIMEOUT_MS) || 900000));
  const args = [
    WORKER, "--input", inputPath, "--output-dir", outputDir,
    "--model-id", modelId, "--device", device, "--steps", String(steps), "--cfg-scale", "4.0"
  ];

  const warnings = [];
  try {
    await runCommand(python, args, timeoutMs);
  } catch (error) {
    warnings.push("MOSS-SoundEffect lokal tidak tersedia; SFX procedural dipakai sebagai fallback: " + clean(error.message, 220));
    return { scenes, generatedCount: 0, warnings };
  }

  let generatedCount = 0;
  for (const link of links) {
    const item = unique.get(link.key);
    if (!item || !selectedKeys.has(link.key)) continue;
    const filename = "sfx_" + String(item.index + 1).padStart(3, "0") + ".wav";
    const audioPath = join(outputDir, filename);
    try {
      const info = await stat(audioPath);
      if (info.size < 1000 || info.size > 32 * 1024 * 1024) continue;
      scenes[link.sceneIndex].soundEvents[link.eventIndex].src =
        "generated/" + jobId + "/moss-sfx/" + filename;
      generatedCount++;
    } catch {
      // Keep the procedural cue as a safe local fallback.
    }
  }

  if (overflowCount > 0) warnings.push(overflowCount + " variasi SFX melewati batas " + maxEvents + " per video; efek sisanya memakai library procedural lokal.");
  return { scenes, generatedCount, warnings };
}
