import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "remotion", "public");

function safeText(value, max = 120) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function chooseVideoFile(video, ratio = "9:16") {
  const files = Array.isArray(video?.video_files) ? video.video_files : [];
  const target = ratio === "16:9" ? 16 / 9 : ratio === "1:1" ? 1 : 9 / 16;
  const candidates = files.filter(file => {
    if (!file || file.file_type !== "video/mp4" || !file.link) return false;
    try {
      const url = new URL(file.link);
      return url.protocol === "https:" && (url.hostname === "videos.pexels.com" || url.hostname.endsWith(".pexels.com"));
    } catch { return false; }
  });
  candidates.sort((a, b) => {
    const aspectA = Number(a.width || 0) / Math.max(1, Number(a.height || 0));
    const aspectB = Number(b.width || 0) / Math.max(1, Number(b.height || 0));
    const scoreA = Math.abs(Math.log(Math.max(0.01, aspectA) / target)) * 1000 + Math.abs(Number(a.width || 0) - (ratio === "16:9" ? 1280 : 720)) / 100;
    const scoreB = Math.abs(Math.log(Math.max(0.01, aspectB) / target)) * 1000 + Math.abs(Number(b.width || 0) - (ratio === "16:9" ? 1280 : 720)) / 100;
    return scoreA - scoreB;
  });
  return candidates[0] || null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error("Pexels HTTP " + response.status + ": " + body.slice(0, 200));
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") throw new Error("Permintaan footage melewati batas waktu.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function searchPexels(query, key, orientation, timeoutMs) {
  const url = new URL("https://api.pexels.com/v1/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "6");
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("size", "medium");
  const response = await fetchWithTimeout(url.toString(), { headers: { Authorization: key, accept: "application/json" } }, timeoutMs);
  return response.json();
}

async function downloadVideo(file, destination, timeoutMs) {
  const response = await fetchWithTimeout(file.link, { headers: { accept: "video/mp4" } }, timeoutMs);
  const contentType = String(response.headers.get("content-type") || "");
  const declared = Number(response.headers.get("content-length") || 0);
  const maxBytes = 32 * 1024 * 1024;
  if (declared > maxBytes) throw new Error("Footage Pexels terlalu besar untuk batas render.");
  if (contentType && !contentType.includes("video") && !contentType.includes("octet-stream")) throw new Error("Pexels mengembalikan file yang bukan video.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error("Ukuran file footage tidak valid.");
  await writeFile(destination, bytes);
}

export async function prepareStockFootage(project, jobId) {
  const key = safeText(process.env.VIDEO_STUDIO_PEXELS_API_KEY || process.env.PEXELS_API_KEY, 300);
  if (!key) return {
    scenes: project.scenes,
    mediaCredits: [],
    footageCount: 0,
    warnings: ["Footage dinamis belum aktif: tambahkan VIDEO_STUDIO_PEXELS_API_KEY pada .env server. Video tetap dapat dibuat dengan motion graphics."]
  };

  const maxScenes = Math.max(1, Math.min(15, Number(process.env.VIDEO_STUDIO_PEXELS_MAX_SCENES) || 8));
  const timeoutMs = Math.max(10000, Math.min(120000, Number(process.env.VIDEO_STUDIO_MEDIA_TIMEOUT_MS) || 45000));
  const candidates = project.scenes.map((scene, index) => ({ scene, index }))
    .filter(item => safeText(item.scene.stockSearchQuery !== undefined ? item.scene.stockSearchQuery : item.scene.visualDescription, 120));
  const selected = candidates.length <= maxScenes
    ? candidates
    : Array.from({ length: maxScenes }, (_, index) => candidates[Math.round(index * (candidates.length - 1) / Math.max(1, maxScenes - 1))]);
  const folder = join(PUBLIC_DIR, "generated", jobId);
  await mkdir(folder, { recursive: true });
  const scenes = project.scenes.map(scene => ({ ...scene }));
  const mediaCredits = [];
  const usedIds = new Set();
  const warnings = [];
  const orientation = project.ratio === "16:9" ? "landscape" : project.ratio === "1:1" ? "square" : "portrait";

  for (const item of selected) {
    const query = safeText(item.scene.stockSearchQuery !== undefined ? item.scene.stockSearchQuery : item.scene.visualDescription, 90);
    try {
      const result = await searchPexels(query, key, orientation, timeoutMs);
      const videos = Array.isArray(result?.videos) ? result.videos : [];
      const video = videos.find(candidate => !usedIds.has(candidate.id) && chooseVideoFile(candidate, project.ratio));
      if (!video) {
        warnings.push("Footage yang cocok tidak ditemukan untuk scene " + (item.index + 1) + ".");
        continue;
      }
      const file = chooseVideoFile(video, project.ratio);
      const filename = "footage-" + String(item.index + 1).padStart(2, "0") + ".mp4";
      await downloadVideo(file, join(folder, filename), timeoutMs);
      usedIds.add(video.id);
      const photographer = safeText(video.user?.name || "Kontributor Pexels", 90);
      scenes[item.index].footageSrc = "generated/" + jobId + "/" + filename;
      scenes[item.index].footageCredit = photographer;
      scenes[item.index].footageUrl = safeText(video.url, 240);
      mediaCredits.push({
        provider: "Pexels",
        photographer,
        photographerUrl: safeText(video.user?.url, 240),
        videoUrl: safeText(video.url, 240)
      });
    } catch (error) {
      warnings.push("Footage scene " + (item.index + 1) + " dilewati: " + safeText(error.message, 160));
    }
  }

  const uniqueCredits = Array.from(new Map(mediaCredits.map(item => [item.photographer + "|" + item.videoUrl, item])).values());
  return { scenes, mediaCredits: uniqueCredits, footageCount: usedIds.size, warnings };
}
