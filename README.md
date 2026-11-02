# Alvareth Bot

Bot WhatsApp Multi-Device berbasis Node.js, Baileys, dan sistem plugin. Nama bot: **Alvareth Bot**; nama owner ditentukan lewat `OWNER_NAME` di `.env`.

## Struktur proyek

```text
.
├── index.js                    # Supervisor proses
├── main.js                     # Socket WhatsApp, sesi, database, loader plugin
├── handler.js                  # Normalisasi pesan dan routing perintah
├── config.js                   # Konfigurasi global
├── .env.example                # Contoh variabel lingkungan
├── plugins/                    # Fitur bot, dikelompokkan berdasarkan kategori
├── lib/                        # Helper dan integrasi bersama
├── json/                       # Data statis untuk sejumlah fitur/game
├── src/                        # Font, latar, dan aset fitur
├── media/                      # Gambar dan audio
├── scripts/start-with-update.js # Update aman sebelum proses bot dijalankan
├── AI_CONTEXT.md               # Catatan teknis untuk pemeliharaan
└── package.json                # Dependency dan perintah npm
```

## Kebutuhan

Gunakan Node.js 22+ dan npm. Beberapa fitur multimedia memerlukan FFmpeg serta tools gambar yang sesuai dengan fitur yang dipakai. Git diperlukan agar updater saat startup dapat mengambil perubahan dari remote.

## Instalasi dan menjalankan

```bash
cp .env.example .env
# Edit .env dan isi BOT_NUMBER, OWNER_NUMBER, serta OWNER_NAME.
npm install
npm start
```

Nomor WhatsApp di `.env` menggunakan angka internasional saja tanpa tanda `+` atau spasi. Jangan commit `.env`, sesi WhatsApp, atau database runtime.

- `npm start` menjalankan `scripts/start-with-update.js`, yang mencoba mengambil pembaruan dari `origin/main` secara fast-forward sebelum memulai bot.
- `AUTO_UPDATE_ENABLED=false` menonaktifkan pembaruan startup.
- `AUTO_UPDATE_BRANCH` mengubah branch yang diperiksa; default-nya `main`.
- `npm run dev` menjalankan mode watch untuk `index.js` dan melewati updater startup.
- `npm test` menjalankan pemeriksaan sintaks pada file entry dan beberapa modul utama. GitHub Actions juga menjalankan pemeriksaan sintaks terhadap seluruh file JavaScript.

## Menjalankan dengan PM2

Untuk menjalankan jalur updater saat startup:

```bash
npm install -g pm2
pm2 start npm --name alvareth-bot -- start
pm2 save
pm2 startup
pm2 logs alvareth-bot
```

Ikuti instruksi yang dikeluarkan oleh `pm2 startup` jika diminta. Hindari menjalankan dua instance bot menggunakan sesi WhatsApp yang sama.

## Perbaikan reply gambar/video pada `.s`

Perintah `.s` sekarang membaca media yang di-reply dari payload asli WhatsApp, bukan hanya `m.quoted.mimetype`. Jika pesan reply hanya berisi preview/thumbnail, bot mencoba mencari media asli memakai ID pesan yang dibalas dan cache lokal (termasuk gambar/video yang dikirim dari akun WhatsApp sendiri). Balasan petunjuk/error stiker dikirim sebagai teks biasa tanpa kartu tautan GitHub. Alternatif: kirim foto dengan caption `.s`. Video stiker tetap maksimal 10 detik.

Untuk pengujian di TokoPanel: setelah update source dan restart, reply sebuah foto dengan `.s`. Cari log `[STICKER] Deteksi media` dengan `quotedType: "imageMessage"`, kemudian pastikan stiker benar-benar terkirim. Coba pula reply video pendek. Jika `hasReply: true` tetapi `quotedType: null`, kirim ulang medianya karena payload asli belum terambil di sesi bot tersebut. Perubahan ini tidak menjamin konten yang tidak tersedia dari WhatsApp dapat diunduh.

## Auto-download tautan (AutoDL)

Cukup kirim **satu tautan media/file yang didukung** dalam satu pesan WhatsApp, tanpa mengetik perintah unduh. Bot akan meneruskan link itu ke plugin downloader yang sudah ada (bukan membuat permintaan ke provider acak). Link yang tidak cocok dan pesan berisi beberapa link tidak diproses otomatis.

- **Chat pribadi:** AutoDL aktif secara default. Gunakan `.disable autodl` untuk mematikan atau `.enable autodl` untuk mengaktifkannya kembali. Link yang dikirim dari akun WhatsApp milik bot sendiri juga diterima **jika pesannya hanya berupa satu URL teks mandiri**; balasan/kiriman bot yang sudah dicatat ID-nya diabaikan agar tidak membuat loop.
- **Grup:** AutoDL nonaktif secara default agar tidak mengunduh setiap link yang dibagikan anggota. Admin/owner dapat memakai `.enable autodl` atau `.disable autodl` dalam grup yang sudah diizinkan.
- **Tautan yang dideteksi router utama:** TikTok (video/foto), Instagram (post/Reels), Facebook (video/share), X/Twitter (status), YouTube (video/Shorts, otomatis 720p), YouTube Music (audio), Pinterest (Pin), Spotify (track), SoundCloud (track), CapCut (template), MediaFire (file), Sfile.co (file), dan GitHub (root repository selain repo bot sendiri). Router lama tetap mendukung layanan tambahan melalui perintah downloader yang tersedia, misalnya Videy, Douyin, Apple Music, Reddit, Threads, Vimeo, dan layanan all-in-one. Ketersediaan file untuk layanan lain mengikuti plugin dan API eksternal.
- **Perintah khusus tetap ada:** `.ytmp3` untuk audio YouTube biasa; `.clip URL mulai akhir` untuk klip yang membutuhkan rentang waktu; dan command downloader lain tetap berfungsi seperti sebelumnya.

### YouTube Clip (`.clip`) — progres WhatsApp

Kirim `.clip https://youtu.be/VIDEO_ID 25:00 27:00`. Bot langsung mengirim **satu pesan progres** dan berusaha mengedit pesan itu saat ada pembaruan dari yt-dlp, FFmpeg, atau kompresi. Indikator seperti `▓▓▓▓░░░░░░ 40%` adalah **persentase tahap aktif**, bukan estimasi total keseluruhan. Pada tahap awal, validasi, atau **upload WhatsApp**, bot menampilkan keterangan `persentase belum tersedia` alih-alih membuat persentase fiktif. Setelah media terkirim, status menjadi **100% selesai**.

Jika edit pesan ditolak oleh Baileys/WhatsApp, bot menggunakan pesan teks biasa yang dibatasi jumlah/frekuensinya agar chat tidak dibanjiri. Saat downloader atau upload gagal, pesan status berubah menjadi error yang bisa dibaca di chat dan log TokoPanel. Video dikirim melalui path file lokal untuk mengurangi beban RAM, dan ada percobaan cadangan menggunakan Buffer jika fork tidak mendukung path. Batas klip 15 menit dan file akhir 45 MB tidak berubah; folder sementara tetap dibersihkan.

**TokoPanel:** restart baru cukup bila startup menggunakan Git checkout yang berhasil mengunduh commit terbaru. Jalankan `npm run test:clip` dari terminal shell untuk tes terbatas bila tersedia. Periksa log `[CLIP:<job>]` dan pastikan pesan progres langsung muncul di WhatsApp. Persentase bisa berhenti saat provider tidak mengirim data progres.
- **Pengamanan:** router utama hanya memakai host dan jenis link yang dikenal, mengabaikan pesan keluaran bot, mendeteksi ID berulang, serta membatasi 2 unduhan otomatis bersamaan dengan antrean terbatas. Router lama dilewati jika router utama sudah memilih downloader; router lama tetap menangani fitur lama seperti TikTok link polos dari akun sendiri. Peraturan izin/limit/registrasi plugin asli tetap diperiksa.

**Pemeriksaan TokoPanel:** setelah mengambil update GitHub dan melakukan restart proses bot, log harus menampilkan `[AUTODL] Router 2026-11-02/self-link-fix aktif`. Ketika mengirim link Facebook seperti `https://www.facebook.com/share/r/...`, log perlu menampilkan `[AUTODL] Tautan dikenali: Facebook`. Jika hanya terlihat `CHAT` tanpa banner tersebut, server kemungkinan masih menggunakan kode lama. **Kolom Console Pterodactyl/TokoPanel umumnya bukan shell untuk menjalankan `git pull`**; gunakan fitur deployment/file manager atau SSH/terminal sungguhan. `npm start` mencoba fast-forward update dari Git hanya jika folder server benar-benar memiliki `.git` dan akses ke remote.

AutoDL tidak menjamin unduhan dari konten privat, yang membutuhkan login, yang diblokir penyedia, atau layanan API yang sedang bermasalah. Fitur ini menggunakan downloader yang sudah ada; untuk verifikasi akhir, lakukan tes WhatsApp dari server yang sebenarnya.

## Database dan sesi

Data runtime disimpan di luar checkout Git secara default:

- Database: `~/.alvareth-bot-data/database.json`
- Sesi WhatsApp: `~/.alvareth-bot-data/sessions/`
- Backup database startup: `~/.alvareth-bot-data/backups/`

Lokasi dapat diubah melalui `ALVARETH_DATA_DIR` dan `WA_SESSION_DIR`. Saat migrasi dari instalasi lama, kode menyalin data lama ke lokasi baru; jangan hapus salinan lama sampai bot berhasil memuat data dan sesi dengan benar.

## GitHub Actions dan deployment

Workflow yang ada saat ini **belum mengonfigurasi auto-deploy ke VPS**. Workflow yang tersedia adalah pemeriksaan sintaks JavaScript dan workflow khusus untuk mengimpor arsip ZIP dengan commit pemicu tertentu. Push ke GitHub saja tidak me-restart bot di VPS.

Untuk server, siapkan `.env` dan dependensi di server. Setelah memperbarui checkout dengan aman, jalankan `npm install` jika dependency berubah, lalu restart proses PM2 yang sesuai. Jangan membuat atau mengandalkan workflow `deploy.yml` sebelum file tersebut benar-benar ditambahkan dan konfigurasi akses server diverifikasi.

## Docker (opsional)

```bash
cp .env.example .env
# Edit .env terlebih dahulu
docker compose up -d --build
```

## Keamanan dan atribusi

Repository ini mewarisi struktur dan sebagian kode dari source sebelumnya. Pertahankan `LICENSE` dan atribusi yang berlaku ketika membagikan ulang atau memodifikasinya. Audit keamanan menyeluruh atas seluruh plugin, dependency, dan API pihak ketiga belum dilakukan. Periksa log dan sumber plugin saat mengatasi error, serta jangan pernah memasukkan token, `.env`, atau sesi WhatsApp ke repository.

## Panduan AI dan kontribusi

Sebelum mengubah kode, AI/developer wajib membaca [`AGENTS.md`](AGENTS.md), [`AI_CONTEXT.md`](AI_CONTEXT.md), dan [`docs/AI_CHANGELOG.md`](docs/AI_CHANGELOG.md). Setiap perubahan bermakna harus memperbarui changelog dan ringkasan terbaru di `AI_CONTEXT.md` dalam PR yang sama. Ikuti aturan keamanan, jalankan tes yang relevan, dan laporkan dengan jujur apa yang sudah serta belum diverifikasi.
