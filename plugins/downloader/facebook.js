/* 
Downloader Facebook
Source Scrape : https://whatsapp.com/channel/0029VbBJKfE0gcfCAJZEVh3R/125
*/
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const MAX_MEDIA_BYTES = 150 * 1024 * 1024;
const MAX_INLINE_VIDEO_BYTES = 50 * 1024 * 1024;
const TARGET_INLINE_VIDEO_BYTES = 48 * 1024 * 1024;

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-8000); });
    child.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(command + " gagal (kode " + code + "): " + (stderr.trim().slice(-1200) || "proses gagal")));
    });
  });
}

async function compressForInlineVideo(buffer, sourceExt = "mp4") {
  const workDir = await mkdtemp(join(tmpdir(), "alvareth-facebook-"));
  const safeExt = /^[a-z0-9]{1,8}$/i.test(sourceExt) ? sourceExt : "mp4";
  const inputPath = join(workDir, "input." + safeExt);
  const outputPath = join(workDir, "output.mp4");

  try {
    await writeFile(inputPath, buffer);

    let duration = 0;
    try {
      const probe = await runCommand("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", inputPath
      ]);
      duration = Number.parseFloat(probe.stdout.trim());
    } catch {
      // Kompresi berbasis kualitas tetap dicoba jika ffprobe tidak tersedia.
    }

    const scaleFilter = maxDimension =>
      "scale=w='min(" + maxDimension + ",iw)':h='min(" + maxDimension + ",ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";

    // Coba pertahankan kualitas setinggi mungkin, sambil mengecilkan video agar
    // bisa dikirim sebagai media inline WhatsApp (bukan sebagai dokumen).
    for (const attempt of [
      { dimension: 1280, crf: 30 },
      { dimension: 1280, crf: 35 },
      { dimension: 960, crf: 38 },
      { dimension: 720, crf: 40 }
    ]) {
      await runCommand("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", inputPath, "-map", "0:v:0", "-map", "0:a?",
        "-vf", scaleFilter(attempt.dimension),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", String(attempt.crf),
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
        "-max_muxing_queue_size", "1024", "-movflags", "+faststart",
        outputPath
      ]);
      const output = await readFile(outputPath);
      if (output.length > 0 && output.length <= TARGET_INLINE_VIDEO_BYTES) return output;
    }

    // Jika CRF belum cukup kecil, hitung bitrate dari durasi agar ukuran akhir
    // berada di bawah batas media inline, dengan cadangan untuk audio/container.
    if (Number.isFinite(duration) && duration > 0) {
      const videoBitrate = Math.max(
        120000,
        Math.floor((TARGET_INLINE_VIDEO_BYTES * 8 * 0.86 / duration) - 112000)
      );

      for (const dimension of [720, 480]) {
        await runCommand("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", inputPath, "-map", "0:v:0", "-map", "0:a?",
          "-vf", scaleFilter(dimension),
          "-c:v", "libx264", "-preset", "veryfast",
          "-b:v", String(videoBitrate), "-maxrate", String(videoBitrate),
          "-bufsize", String(videoBitrate * 2),
          "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
          "-max_muxing_queue_size", "1024", "-movflags", "+faststart",
          outputPath
        ]);
        const output = await readFile(outputPath);
        if (output.length > 0 && output.length <= MAX_INLINE_VIDEO_BYTES) return output;
      }
    }

    const finalSize = await stat(outputPath).then(value => value.size).catch(() => 0);
    throw new Error(
      "Video masih terlalu besar setelah kompresi" +
      (finalSize ? " (" + (finalSize / 1024 / 1024).toFixed(1) + " MB)" : "") +
      ". Coba tautan atau video yang lebih pendek."
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getToken() {
  const url = "https://fbdownloader.to/id";
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  const regex = /k_exp="(.*?)".*?k_token="(.*?)"/s;
  const match = html.match(regex);
  if (!match) throw new Error("Token tidak ditemukan");

  return {
    k_exp: match[1],
    k_token: match[2]
  };
}

async function fbDownloader(fbUrl) {
  const { k_exp, k_token } = await getToken();

  const payload = new URLSearchParams({
    k_exp,
    k_token,
    p: "home",
    q: fbUrl,
    lang: "id",
    v: "v2",
    W: ""
  });

  const { data } = await axios.post("https://fbdownloader.to/api/ajaxSearch", payload, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "Mozilla/5.0",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://fbdownloader.to",
      "Referer": "https://fbdownloader.to/id"
    }
  });

  if (!data || !data.data) throw new Error("Gagal mengambil data video");

  const html = data.data;
  const results = [];

  const rowRegex = /<td class="video-quality">(.*?)<\/td>[\s\S]*?(?:href="(.*?)"|data-videourl="(.*?)")/g;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const quality = match[1].trim();
    const url = match[2] || match[3];
    if (quality && url) results.push({ quality, url });
  }

  return results;
}

let handler = async (m, { conn, text }) => {
  if (!text) return m.reply("Masukkan link Facebook terlebih dahulu, contoh:\n.fb https://facebook.com/...");

  try {
    const results = await fbDownloader(text);
    if (!results.length) return m.reply("❌ Tidak ada video ditemukan.");

    const videoUrl = results[0].url;

    const mediaResponse = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 90000,
      maxContentLength: MAX_MEDIA_BYTES,
      maxBodyLength: MAX_MEDIA_BYTES,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36',
        Accept: 'video/mp4,video/*,application/octet-stream,*/*'
      },
      validateStatus: status => status >= 200 && status < 300
    });
    const buffer = Buffer.from(mediaResponse.data);
    if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) {
      throw new Error('File video kosong atau melebihi batas 150 MB.');
    }

    const detected = await fileTypeFromBuffer(buffer);
    const responseMime = String(mediaResponse.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    const mime = detected?.mime || responseMime;
    if (!mime.startsWith('video/') || responseMime.includes('text/html') || responseMime.includes('application/json')) {
      throw new Error('Tautan Facebook tidak mengembalikan file video yang valid.');
    }

    let videoBuffer = buffer;
    let finalMime = mime;
    let fileName = `facebook-video.${detected?.ext || 'mp4'}`;
    let compressed = false;

    if (buffer.length > MAX_INLINE_VIDEO_BYTES) {
      await m.reply(
        "⏳ Video berukuran " + (buffer.length / 1024 / 1024).toFixed(1) +
        " MB. Sedang dikompres agar bisa diputar langsung di chat..."
      );
      videoBuffer = await compressForInlineVideo(buffer, detected?.ext || "mp4");
      finalMime = "video/mp4";
      fileName = "facebook-video.mp4";
      compressed = true;
    }

    const caption = `📥 Download dari Facebook\nKualitas sumber: ${results[0].quality}` +
      (compressed ? "\n✅ Dikompres otomatis agar bisa diputar langsung." : "");
    const sent = await conn.sendMessage(m.chat, {
      video: videoBuffer,
      fileName,
      mimetype: finalMime,
      caption
    }, { quoted: m, noAlvarethPreview: true });
    if (!sent?.key?.id) throw new Error('WhatsApp tidak mengembalikan ID pesan video Facebook.');
  } catch (e) {
    m.reply("❌ Gagal mengunduh video: " + e.message);
  }
};

handler.help = ['facebook <link>'];
handler.tags = ['downloader'];
handler.command = /^fb|facebook$/i;
handler.limit = true;
export default handler;