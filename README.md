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

Perintah `.s` membaca media reply dari payload asli WhatsApp dan mencari pesan sumber melalui stanza ID bila preview tidak lengkap. Cache media kini mempertahankan `Buffer`/`Uint8Array` (termasuk mediaKey dan hash terenkripsi) agar unduhan reply self-chat tidak rusak akibat serialisasi JSON. Media sumber dari cache diprioritaskan sebelum thumbnail reply. Konversi dilakukan lokal dengan Sharp/FFmpeg; tidak memakai upload file publik atau API stiker pihak ketiga.

- Foto: WebP statis maksimal 100 KB, dengan beberapa tingkat kompresi.
- Video/GIF animasi: WebP animasi maksimal 500 KB, video maksimal 10 detik, FPS/quality diturunkan bertahap bila perlu.
- Pesan error tidak mengutip pesan sumber sehingga tidak membawa kartu preview GitHub.
- Foto langsung dengan caption `.s` juga didukung.

Untuk pengujian di TokoPanel, setelah source terbaru diterapkan dan bot direstart, reply foto dengan `.s`. Log yang benar diawali `[STICKER] Media terdeteksi`; kegagalan akan menampilkan `[STICKER] GAGAL` beserta tahap dan detail error. Jika server masih menampilkan pesan lama “Gagal membuat stiker dari media tersebut”, berarti plugin stiker yang aktif belum memakai versi diagnostik terbaru. Uji pula video pendek. Konten yang tidak ada di cache/payload WhatsApp harus dikirim ulang.

## Auto-download tautan (AutoDL)

Cukup kirim **satu tautan media/file yang didukung** dalam satu pesan WhatsApp, tanpa mengetik perintah unduh. Bot akan meneruskan link itu ke plugin downloader yang sudah ada (bukan membuat permintaan ke provider acak). Link yang tidak cocok dan pesan berisi beberapa link tidak diproses otomatis.

- **Chat pribadi:** AutoDL aktif secara default. Gunakan `.disable autodl` untuk mematikan atau `.enable autodl` untuk mengaktifkannya kembali. Link yang dikirim dari akun WhatsApp milik bot sendiri juga diterima **jika pesannya hanya berupa satu URL teks mandiri**; balasan/kiriman bot yang sudah dicatat ID-nya diabaikan agar tidak membuat loop.
- **Grup:** AutoDL nonaktif secara default agar tidak mengunduh setiap link yang dibagikan anggota. Admin/owner dapat memakai `.enable autodl` atau `.disable autodl` dalam grup yang sudah diizinkan.
- **Tautan yang dideteksi router utama:** TikTok (video/foto), Instagram (post/Reels), Facebook (video/share), X/Twitter (status), YouTube (video/Shorts, otomatis 720p), YouTube Music (audio), Pinterest (Pin), Spotify (track), SoundCloud (track), CapCut (template), MediaFire (file), Sfile.co (file), dan GitHub (root repository selain repo bot sendiri). Router lama tetap mendukung layanan tambahan melalui perintah downloader yang tersedia, misalnya Videy, Douyin, Apple Music, Reddit, Threads, Vimeo, dan layanan all-in-one. Ketersediaan file untuk layanan lain mengikuti plugin dan API eksternal.
- **Perintah khusus tetap ada:** `.ytmp3` untuk audio YouTube biasa; `.clip URL mulai akhir` untuk klip yang membutuhkan rentang waktu; dan command downloader lain tetap berfungsi seperti sebelumnya.

### YouTube Clip (`.clip`) — progres terminal

Kirim `.clip https://youtu.be/VIDEO_ID 25:00 27:00`. Format waktu mendukung `MM:SS` atau `HH:MM:SS`; durasi tidak dibatasi oleh kode bot. Progres persentase dan tahap proses dicatat di terminal TokoPanel melalui log `[CLIP:<job>]`. Chat WhatsApp menerima hasil video atau pesan gagal setelah proses selesai.

Tidak ada batas ukuran sumber 256 MB/96 MB atau batas output 45 MB yang dipaksakan oleh plugin. Jika pengiriman sebagai video ditolak WhatsApp, bot mencoba mengirim file yang sama sebagai dokumen. File dialirkan dari disk agar tidak perlu dimuat seluruhnya ke RAM, dan folder sementara dibersihkan setelah proses selesai.

**Batas waktu:** tidak ada idle timeout atau hard timeout aplikasi pada yt-dlp, FFmpeg, pemeriksaan metadata, dan unduhan API khusus `.clip`. Proses menunggu sampai program/provider mengembalikan hasil atau error. Ini berarti satu metode yang benar-benar macet tidak akan otomatis dialihkan ke metode berikutnya. Tidak ada batas durasi/ukuran dari kode bot, tetapi YouTube, API pihak ketiga, WhatsApp, dan kapasitas disk/hosting tetap dapat membatasi atau menolak permintaan.

**Pemilihan kualitas multi-metode:** setiap strategi yt-dlp membaca inventaris format dari metadata, lalu memilih format video berdasarkan jumlah piksel/resolusi, tinggi/lebar, FPS, dan bitrate; audio terbaik dipilih terpisah bila diperlukan. Pemeriksaan mencoba profil YouTube default dan `web_safari` (HLS). Jika `YTDLP_POT_PROVIDER_URL` diatur, profil `mweb` dengan PO Token Provider juga diuji. Tiga strategi yt-dlp menggunakan format ID terbaik yang ditemukan, sedangkan Qbyte memeriksa daftar formatnya sendiri. Keempat hasil metode (tiga yt-dlp dan Qbyte) diunduh berurutan, diperiksa dengan FFprobe, lalu dibandingkan berdasarkan resolusi aktual, FPS, bitrate, dan ukuran. Hanya kandidat terbaik yang dikirim; kandidat lain dibersihkan. Proses ini membutuhkan waktu, bandwidth, dan ruang sementara lebih banyak daripada berhenti pada metode pertama yang berhasil.

**Validasi dan batas kualitas:** hasil MP4 dipetakan eksplisit ke track video dan audio, dikodekan H.264 CRF 18 + AAC 192 kbps, lalu diperiksa dengan `ffprobe` dan `blackdetect`. File audio-only, tanpa track gambar, atau hampir seluruhnya hitam ditolak. Caption menampilkan resolusi dan FPS aktual. Bot tidak meng-upscale video sumber: jika semua inventaris hanya menyediakan 360p, hasil maksimalnya tetap 360p. Jika sumber aslinya HD tetapi format HD tidak muncul, server mungkin memerlukan EJS/PO Token Provider. `YTDLP_POT_PROVIDER_URL=http://127.0.0.1:4416` hanya berfungsi jika plugin [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) dan server providernya sudah terpasang/berjalan; gunakan alamat localhost/jaringan privat, jangan publikasikan server provider tanpa perlindungan.

**TokoPanel:** setelah update GitHub terpasang, restart bot agar kode baru aktif. Jalankan `npm run test:clip` dari terminal shell bila ingin mengulang tes. Periksa log `[CLIP:<job>]` di console TokoPanel; source aktif saat ini menampilkan progres di terminal, bukan sebagai pesan progres langsung di WhatsApp.
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
