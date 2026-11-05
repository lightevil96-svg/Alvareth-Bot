import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomInt } from "crypto";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "remotion", "public");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function safeText(value, max = 600) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function getConfig(kind) {
  const baseUrl = safeText(process.env.VIDEO_STUDIO_COMFYUI_URL || "http://127.0.0.1:8188", 300).replace(/\/+$/, "");
  const workflowFile = kind === "video"
    ? safeText(process.env.VIDEO_STUDIO_COMFYUI_VIDEO_WORKFLOW_FILE, 500)
    : kind === "image"
      ? safeText(process.env.VIDEO_STUDIO_COMFYUI_IMAGE_WORKFLOW_FILE, 500)
      : safeText(process.env.VIDEO_STUDIO_COMFYUI_MUSIC_WORKFLOW_FILE, 500);
  return { baseUrl, workflowFile, apiKey: safeText(process.env.VIDEO_STUDIO_COMFYUI_API_KEY, 300) };
}
export function isComfyConfigured(kind) {
  const config = getConfig(kind);
  return Boolean(config.workflowFile);
}

export function applyComfyWorkflowVariables(value, variables) {
  if (Array.isArray(value)) return value.map(item => applyComfyWorkflowVariables(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyComfyWorkflowVariables(item, variables)]));
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([A-Z_]+)\}\}$/);
  if (exact && Object.hasOwn(variables, exact[1])) return variables[exact[1]];
  return value.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => Object.hasOwn(variables, key) ? String(variables[key]) : "{{" + key + "}}");
}

function comfyUrl(baseUrl, path) {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("URL ComfyUI harus menggunakan HTTP/HTTPS tanpa kredensial tertanam.");
  return new URL(path.replace(/^\/+/, ""), base.toString() + "/").toString();
}
async function requestJson(url, options, timeoutMs, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (apiKey) headers["X-API-Key"] = apiKey;
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error("ComfyUI HTTP " + response.status + ": " + body.slice(0, 220));
    try { return JSON.parse(body); }
    catch { throw new Error("ComfyUI mengirim JSON yang tidak valid."); }
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") throw new Error("ComfyUI melewati batas waktu koneksi.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function findOutputFile(history, kind) {
  const entries = Object.values(history?.outputs || {});
  const keys = kind === "video" ? ["videos", "gifs"] : kind === "image" ? ["images"] : ["audio", "audios", "gifs"];
  const extensions = kind === "video" ? /\.(mp4|webm|mov)$/i : kind === "image" ? /\.(png|jpg|jpeg|webp)$/i : /\.(wav|mp3|flac|ogg|m4a)$/i;
  for (const output of entries) {
    for (const key of keys) {
      const files = Array.isArray(output?.[key]) ? output[key] : [];
      const found = files.find(file => file?.filename && extensions.test(file.filename));
      if (found) return found;
    }
  }
  return null;
}

async function downloadOutput(config, file, destination, kind, timeoutMs) {
  const url = new URL(comfyUrl(config.baseUrl, "/view"));
  url.searchParams.set("filename", safeText(file.filename, 220));
  url.searchParams.set("subfolder", safeText(file.subfolder, 220));
  url.searchParams.set("type", safeText(file.type || "output", 32));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (config.apiKey) headers["X-API-Key"] = config.apiKey;
    const response = await fetch(url.toString(), { headers, signal: controller.signal });
    if (!response.ok) throw new Error("Unduhan hasil ComfyUI gagal (HTTP " + response.status + ").");
    const contentType = String(response.headers.get("content-type") || "");
    const maxBytes = kind === "video" ? 48 * 1024 * 1024 : kind === "image" ? 20 * 1024 * 1024 : 32 * 1024 * 1024;
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error("Hasil ComfyUI melebihi batas ukuran file.");
    if (contentType.includes("text/html") || contentType.includes("application/json")) throw new Error("ComfyUI mengembalikan respons non-media.");
    if (!response.body) throw new Error("Stream hasil ComfyUI tidak tersedia.");
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Hasil ComfyUI melewati batas ukuran file.");
      }
      chunks.push(Buffer.from(part.value));
    }
    if (!total) throw new Error("File hasil ComfyUI kosong.");
    await writeFile(destination, Buffer.concat(chunks, total));
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") throw new Error("Unduhan hasil ComfyUI melewati batas waktu.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadReferenceImage(config, filePath, timeoutMs) {
  const bytes = await readFile(filePath);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Character reference image kosong atau melebihi 20 MB.");
  const form = new FormData();
  form.append("image", new Blob([bytes]), basename(filePath));
  form.append("overwrite", "true");
  const uploaded = await requestJson(comfyUrl(config.baseUrl, "/upload/image"), {
    method: "POST",
    body: form
  }, Math.min(timeoutMs, 60000), config.apiKey);
  const name = safeText(uploaded?.name, 220);
  const subfolder = safeText(uploaded?.subfolder, 220);
  if (!name) throw new Error("ComfyUI tidak mengembalikan nama image reference yang valid.");
  return subfolder ? subfolder + "/" + name : name;
}

export async function generateComfyAsset({ kind, prompt, negativePrompt = "", jobId, filename, ratio = "9:16", durationSeconds = 5, fps = 24, width, height, referenceImagePath = "" }) {
  if (!["video", "image", "music"].includes(kind)) throw new Error("Jenis generasi ComfyUI tidak didukung.");
  const config = getConfig(kind);
  if (!config.workflowFile) throw new Error("Workflow ComfyUI untuk " + kind + " belum dikonfigurasi.");
  const timeoutMs = clamp(Number(process.env.VIDEO_STUDIO_COMFYUI_TIMEOUT_MS) || 900000, 60000, 1800000);
  const workflowText = await readFile(config.workflowFile, "utf8");
  const parsed = JSON.parse(workflowText);
  const graph = parsed && parsed.prompt && typeof parsed.prompt === "object" ? parsed.prompt : parsed;
  if (!graph || typeof graph !== "object" || Array.isArray(graph) || !Object.keys(graph).length) throw new Error("Workflow ComfyUI harus berupa API prompt graph JSON yang tidak kosong.");
  if (referenceImagePath && !workflowText.includes("{{REFERENCE_IMAGE}}")) {
    throw new Error("Workflow video harus menggunakan placeholder {{REFERENCE_IMAGE}} pada node LoadImage agar character reference dipakai.");
  }
  const uploadedReference = referenceImagePath ? await uploadReferenceImage(config, referenceImagePath, timeoutMs) : "";
  const dimensions = kind === "image"
    ? { width: 1024, height: 1024 }
    : ratio === "16:9" ? { width: 1920, height: 1080 } : ratio === "1:1" ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
  const variables = {
    PROMPT: safeText(prompt, 1800),
    NEGATIVE_PROMPT: safeText(negativePrompt, 1000),
    WIDTH: Math.min(1920, Math.max(512, Number(width) || dimensions.width)),
    HEIGHT: Math.min(1920, Math.max(512, Number(height) || dimensions.height)),
    DURATION: clamp(Number(durationSeconds) || 5, 2, 10),
    FPS: clamp(Number(fps) || 24, 12, 30),
    SEED: randomInt(1, 2147483646),
    SCENE_ID: safeText(filename, 80),
    REFERENCE_IMAGE: uploadedReference
  };
  const workflow = applyComfyWorkflowVariables(graph, variables);
  const submitted = await requestJson(comfyUrl(config.baseUrl, "/prompt"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow })
  }, Math.min(timeoutMs, 60000), config.apiKey);
  const promptId = safeText(submitted?.prompt_id, 120);
  if (!promptId) throw new Error("ComfyUI tidak mengembalikan prompt_id.");

  const startedAt = Date.now();
  let output = null;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const history = await requestJson(comfyUrl(config.baseUrl, "/history/" + encodeURIComponent(promptId)), {}, Math.min(timeoutMs, 30000), config.apiKey);
    const record = history?.[promptId];
    if (record?.status?.status_str === "error") throw new Error("Workflow ComfyUI gagal dijalankan.");
    output = findOutputFile(record, kind);
    if (output) break;
  }
  if (!output) throw new Error("ComfyUI tidak menghasilkan file " + kind + " sebelum batas waktu.");

  const extension = String(output.filename).match(/\.(mp4|webm|mov|png|jpg|jpeg|webp|wav|mp3|flac|ogg|m4a)$/i)?.[0]?.toLowerCase();
  const folder = join(PUBLIC_DIR, "generated", safeText(jobId, 80));
  await mkdir(folder, { recursive: true });
  const fallbackExtension = kind === "video" ? ".mp4" : kind === "image" ? ".png" : ".wav";
  const outputName = safeText(filename, 100) + (extension || fallbackExtension);
  const destination = join(folder, outputName);
  await downloadOutput(config, output, destination, kind, Math.min(timeoutMs, 120000));
  return {
    src: "generated/" + safeText(jobId, 80) + "/" + outputName,
    path: destination,
    filename: outputName,
    prompt: variables.PROMPT,
    width: variables.WIDTH,
    height: variables.HEIGHT,
    durationSeconds: variables.DURATION,
    provider: "ComfyUI"
  };
}
