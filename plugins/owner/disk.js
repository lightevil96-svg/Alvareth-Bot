import {
  cleanSafeTempFiles,
  formatBytes,
  getDiskReport,
  getSafeCleanupPreview
} from "../../lib/disk-cleaner.js";

const previews = global.__alvarethDiskCleanupPreviews || (global.__alvarethDiskCleanupPreviews = new Map());

function diskMenu(prefix = ".") {
  return [
    "🧹 *ALVARETH DISK MANAGER*",
    "",
    "• " + prefix + "disk — laporan storage",
    "• " + prefix + "disk scan — pindai ukuran folder",
    "• " + prefix + "disk clean — pratinjau file sementara yang aman dibersihkan",
    "• " + prefix + "disk confirm — setujui penghapusan pratinjau",
    "• " + prefix + "disk cancel — batalkan pratinjau",
    "",
    "Pembersihan hanya menyasar file sementara WhatsApp dan aset sementara Remotion yang tidak berubah selama minimal 24 jam.",
    "Sesi WhatsApp, database, konfigurasi, model, node_modules, log, backup, dan hasil MP4 tidak disentuh."
  ].join("\n");
}

async function showReport(m, { scan = false } = {}) {
  const report = getDiskReport();
  const fs = report.filesystem;
  const lines = [
    "💽 *LAPORAN STORAGE ALVARETH*",
    "",
    fs
      ? "Filesystem: " + fs.device + "\nTerpakai: " + fs.used + " / " + fs.size + " (" + fs.usePercent + ")\nTersedia: " + fs.available + "\nMount: " + fs.mount
      : "Informasi filesystem tidak dapat dibaca.",
    "",
    "*Folder terbesar pada direktori bot:*",
    ...(report.folders.length ? report.folders.map(item => "• " + item.size + " — " + item.path) : ["Data ukuran folder belum tersedia."]),
    "",
    "Waktu pemindaian: " + new Date(report.scannedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
    scan ? "\nGunakan .disk clean untuk melihat kandidat pembersihan aman." : "Ketik .disk clean untuk melihat kandidat pembersihan aman."
  ];
  return m.reply(lines.join("\n"));
}

const handler = async (m, context = {}) => {
  if (context.isROwner !== true) return m.reply("Fitur Disk Manager hanya untuk owner.");

  const prefix = context.usedPrefix || ".";
  const args = String(context.text || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const action = args[0] || "status";
  const key = String(m.sender || "") + ":" + String(m.chat || "");

  if (action === "menu" || action === "help") return m.reply(diskMenu(prefix));
  if (action === "status" || action === "scan") return showReport(m, { scan: action === "scan" });

  if (action === "clean" || action === "preview") {
    const preview = await getSafeCleanupPreview();
    if (!preview.totalFiles) {
      previews.delete(key);
      return m.reply(
        "✅ *TIDAK ADA FILE SEMENTARA LAMA YANG AMAN DIBERSIHKAN*\n\n" +
        "Folder yang diperiksa: temporary media WhatsApp dan aset sementara Remotion.\n" +
        "File yang lebih baru dari 24 jam sengaja dilewati agar proses aktif tidak terganggu."
      );
    }
    previews.set(key, preview);
    const lines = [
      "🧹 *PRATINJAU DISK CLEANER*",
      "",
      ...preview.candidates.map(item =>
        "*" + item.label + "*\n" +
        "File kandidat: " + item.fileCount + "\n" +
        "Estimasi ruang: " + formatBytes(item.sizeBytes)
      ),
      "",
      "*Total:* " + preview.totalFiles + " file • " + formatBytes(preview.totalBytes),
      "Kandidat hanya file biasa yang lebih lama dari 24 jam. Symlink dan file baru dilewati.",
      "",
      "Untuk menyetujui penghapusan, ketik *" + prefix + "disk confirm* dalam 5 menit.",
      "Ketik " + prefix + "disk cancel untuk membatalkan."
    ];
    return m.reply(lines.join("\n"));
  }

  if (action === "confirm") {
    const preview = previews.get(key);
    if (!preview) return m.reply("Tidak ada pratinjau aktif. Jalankan .disk clean terlebih dahulu.");
    previews.delete(key);
    try {
      const result = await cleanSafeTempFiles(preview);
      return m.reply([
        "✅ *PEMBERSIHAN SELESAI*",
        "File dihapus: " + result.deletedFiles,
        "Ruang dibebaskan: " + formatBytes(result.deletedBytes),
        result.errors.length ? "Peringatan: " + result.errors.join(" | ") : "Tidak ada error penghapusan.",
        "",
        "Ketik " + prefix + "disk scan untuk memeriksa storage kembali."
      ].join("\n"));
    } catch (error) {
      return m.reply("❌ Pembersihan dibatalkan: " + String(error?.message || error));
    }
  }

  if (action === "cancel") {
    const removed = previews.delete(key);
    return m.reply(removed ? "Pratinjau pembersihan dibatalkan." : "Tidak ada pratinjau aktif.");
  }

  return m.reply(diskMenu(prefix));
};

handler.help = ["disk", "disk scan", "disk clean", "disk confirm", "disk cancel"];
handler.tags = ["owner"];
handler.command = /^disk$/i;
handler.rowner = true;

export default handler;
