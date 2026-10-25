/* 
Downloader Facebook
Source Scrape : https://whatsapp.com/channel/0029VbBJKfE0gcfCAJZEVh3R/125
*/
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";

const MAX_MEDIA_BYTES = 150 * 1024 * 1024;
const MAX_INLINE_VIDEO_BYTES = 50 * 1024 * 1024;

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

    const fileName = `facebook-video.${detected?.ext || 'mp4'}`;
    const caption = `📥 Download dari Facebook\nKualitas: ${results[0].quality}`;
    const message = buffer.length > MAX_INLINE_VIDEO_BYTES
      ? { document: buffer, fileName, mimetype: mime, caption }
      : { video: buffer, fileName, mimetype: mime, caption };

    const sent = await conn.sendMessage(m.chat, message, { quoted: m, noAlvarethPreview: true });
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