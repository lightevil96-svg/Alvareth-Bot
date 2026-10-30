# AI Context — Alvareth Bot

> **Tujuan:** orientasi singkat untuk AI/developer yang melanjutkan proyek.
> **Repository:** https://github.com/lightevil96-svg/Alvareth-Bot
> **Branch produksi:** `main`
> **Ditinjau:** 2026-10-29
>
> Baca `AGENTS.md` terlebih dahulu, lalu file ini dan `docs/AI_CHANGELOG.md`. Catatan membantu orientasi, tetapi kode saat ini tetap menjadi sumber kebenaran.

## 1. Gambaran proyek

Alvareth Bot adalah bot WhatsApp Multi-Device berbasis Node.js, ES Modules, Baileys fork, dan sistem plugin.

| Bagian | Fungsi |
| --- | --- |
| `index.js` | Supervisor/worker proses |
| `main.js` | Socket WhatsApp, sesi, database, loader dan lifecycle plugin |
| `handler.js` | Normalisasi pesan, izin, routing command, event grup |
| `config.js` | Metadata, pengaturan global dan integrasi |
| `plugins/` | Fitur bot; struktur plugin besar harus dipertahankan |
| `lib/` | Helper bersama, serializer, scraper dan integrasi |
| `json/`, `src/`, `media/` | Data dan aset fitur |
| `scripts/start-with-update.js` | Fast-forward update sebelum bot dimulai |
| `AI_CONTEXT.md` | Orientasi teknis dan gotcha yang masih aktif |
| `docs/AI_CHANGELOG.md` | Riwayat perubahan, hasil tes, akar masalah dan pencegahannya |

`package.json` memakai `"type": "module"`. README mensyaratkan Node.js 22+; workflow sintaks GitHub memakai Node 20. Periksa versi di lingkungan yang benar-benar menjalankan bot sebelum mendiagnosis masalah runtime.

## 2. Mulai bekerja dengan benar

1. Baca `AGENTS.md`, README, bagian terkait dalam file ini, dan riwayat di `docs/AI_CHANGELOG.md`.
2. Periksa branch, commit terbaru, file yang relevan, semua pemanggil/helper terkait, serta status workflow. Jangan menebak isi kode dari nama file saja.
3. Temukan akar masalah dan perbaiki sumber masalah bersama bila bug dipakai banyak fitur. Pertahankan API, format pesan, izin, dan perilaku yang sudah berfungsi.
4. **Default: langsung commit perubahan ke branch `main`** sesuai permintaan pemilik proyek. Jangan membuat branch fitur atau PR kecuali pengguna secara eksplisit memintanya. Pastikan SHA `main` terbaru sebelum menulis, jangan menimpa perubahan lain, dan jangan force-push/reset. Jika proteksi branch atau izin GitHub menolak perubahan langsung, berhenti dan jelaskan hambatannya; jangan diam-diam beralih ke PR.
5. Jalankan `npm test` dan pemeriksaan yang relevan. Untuk perubahan plugin, uji jalur terkait; untuk fitur eksternal, bedakan tes sintaks dari tes API dan tes WhatsApp langsung.
6. Periksa diff akhir agar perubahan tidak menyertakan rahasia, data runtime, atau file yang tidak terkait.
7. **Catat setiap perubahan bermakna dalam `docs/AI_CHANGELOG.md` pada commit `main` yang sama/berurutan langsung dengan perubahan kode.** Perbarui bagian “Pembaruan terbaru” di file ini dengan ringkasan satu baris. Catat masalah, akar penyebab, perbaikan, file/commit, tes yang dijalankan, hasil, dan hal yang belum diverifikasi. Jangan mengklaim tes atau perilaku live yang tidak benar-benar diuji.

## 3. Aturan wajib: boleh dan tidak boleh

### Boleh / harus
- Membaca dan menelusuri kode, mencari pemanggil fungsi, menambah tes, memperbaiki dokumentasi, serta melakukan refactor terukur yang mempertahankan kompatibilitas.
- Memperbaiki akar masalah pada helper bersama bila bukti menunjukkan banyak plugin terdampak.
- Menambah fallback API yang berbeda sumber, timeout, validasi respons, deduplikasi, dan pesan error yang membantu; tandai fallback eksternal sebagai best-effort.
- Memeriksa hasil GitHub Actions, membuat commit kecil yang terfokus langsung di `main`, dan mendokumentasikan pelajaran untuk mencegah regresi.
- Menggunakan `.env.example` untuk dokumentasi konfigurasi; gunakan variabel lingkungan untuk credential.

### Tidak boleh
- **Jangan commit, menampilkan, atau menyalin** `.env`, token/API key, kredensial, folder sesi WhatsApp, database runtime, nomor pribadi, atau log yang mengandung rahasia.
- Jangan menghapus atau menimpa data pengguna, database, sesi, backup, atau perubahan lokal. Jangan gunakan `git reset --hard`, force push, atau destructive sync sebagai jalan pintas tanpa izin eksplisit dan backup terverifikasi.
- Jangan menghapus plugin, mengurangi fitur, mengganti arsitektur besar, mengubah branding/owner, mengubah izin akses, atau menambah dependency besar tanpa kebutuhan yang jelas.
- Jangan membuat retry tak terbatas. HTTP 403 biasanya berarti request ditolak; hindari mengulang request yang sama terus-menerus dan coba sumber lain bila tersedia.
- Jangan menganggap status HTTP sukses berarti hasil API valid; validasi struktur dan data sebelum mengirim pesan/media.
- Jangan mengklaim “sudah berfungsi” hanya karena kode tersimpan atau workflow sintaks lolos. Jelaskan yang benar-benar diuji dan yang masih perlu dicoba di WhatsApp/TokoPanel.
- Jangan mengasumsikan push GitHub otomatis men-deploy atau me-restart VPS.

## 4. Gotcha arsitektur yang penting

- **Pesan WhatsApp dan serializer:** sebagian objek pesan bisa kehilangan helper/properti seperti `m.reply()`, `m.react()`, atau nilai routing. Periksa `handler.js` dan `lib/simple.js` terlebih dahulu. Bila helper umum rusak, evaluasi kompatibilitas di satu tempat sebelum menambal plugin satu per satu. Pertahankan fallback normalisasi pesan yang sudah ada.
- **Plugin:** plugin dimuat secara rekursif dari `plugins/`. Ikuti konvensi handler yang dipakai file sejenis; periksa izin `handler.group`, `handler.admin`, `handler.botAdmin`, limit, dan format command sebelum mengubahnya.
- **TikTok search/downloader:** `plugins/search/tiktok.js` memakai helper di `lib/scrape/tikwm.js`. API eksternal bisa membatasi IP/host. Jangan memperlakukan HTTP 403 sebagai kueri kosong; gunakan fallback berbeda dan tetap jelaskan jika semua penyedia gagal. Semua direktori kerja TikTok (video, render foto, dan fallback yt-dlp) harus memakai `ALVARETH_TIKTOK_TMPDIR` bila diatur; jangan membuat jalur sementara tambahan langsung di `os.tmpdir()`.
- **Updater saat startup:** `npm start` menjalankan `scripts/start-with-update.js`, yang mengambil update Git secara fast-forward dan memulai versi lokal bila pembaruan gagal. Ini bukan update/deploy VPS jarak jauh. Perubahan updater harus mempertahankan data dan perubahan tracked lokal.
- **Data persisten:** database default berada di `~/.alvareth-bot-data/database.json`; sesi di `~/.alvareth-bot-data/sessions/`. Lokasi dapat berbeda lewat `ALVARETH_DATA_DIR` dan `WA_SESSION_DIR`. Jangan menghapus salinan lama sebelum migrasi berhasil diverifikasi.
- **Deploy:** saat ini jangan menganggap tersedia auto-deploy ke VPS hanya karena ada workflow GitHub. Periksa file workflow yang benar-benar ada.

## 5. Tes dan cara melaporkan

Perintah dasar:
- `npm test` — pemeriksaan sintaks file utama dan beberapa modul.
- GitHub Actions `JavaScript syntax checks` — pemeriksaan sintaks semua file JavaScript dalam cakupan workflow.
- Jalankan tes/skrip unit atau tes manual tambahan bila tersedia.

Pada laporan akhir, sebutkan file/fungsi yang berubah, akar masalah, hasil tes nyata, commit/PR, serta batasan yang belum diuji. Tes sintaks bukan bukti API pihak ketiga atau pengiriman WhatsApp berhasil.

## 6. Pembaruan terbaru

- 2026-10-30 — TikTok downloader: watermark fallback ditunda sampai setelah embed/yt-dlp dan sumber di bawah 720 piksel pada sisi terpanjang ditolak agar tidak dikirim sebagai HD.
- 2026-10-30 — Ditambahkan .clean khusus owner untuk menghapus direktori sementara TikTok alvareth-tiktok-* yang berusia lebih dari 2 jam; data persisten dan file unduhan lain tidak disentuh.
- 2026-10-30 — Perbaikan ENOSPC TikTok: semua proses sementara video/foto/fallback diarahkan ke root konfigurasi yang sama, dengan pembersihan direktori usang dan pemeriksaan ruang awal; cek kondisi disk/kuota hosting tetap diperlukan.
- 2026-10-29 — Panduan AI diseragamkan: root `AGENTS.md`, konteks ringkas di file ini, dan `docs/AI_CHANGELOG.md` untuk catatan perubahan/regresi; perubahan ini dokumentasi saja.
- 2026-10-29 — PR #13: fallback pencarian TikTok lewat Bing/Google jika API utama gagal; pemeriksaan sintaks GitHub lolos, akses live dari TokoPanel belum diverifikasi.
- 2026-10-29 — PR #11: updater menambah retry jaringan terbatas dan detail penyebab `fetch failed`; koneksi live dari TokoPanel tetap harus diuji.
- 2026-10-29 — PR #10: unduhan YouTube kualitas terbaik mencoba yt-dlp dan melaporkan resolusi/FPS hasil aktual; verifikasi runtime tetap diperlukan.
- 2026-10-22 — Normalisasi pesan dan fallback `m.reply()`/`m.react()` ditangani di layer bersama; pertahankan dan regression-test, jangan menghapus hanya karena satu plugin bisa berjalan.
- Perubahan historis lain dan format pencatatannya ada di `docs/AI_CHANGELOG.md`.
