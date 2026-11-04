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

### Mengatasi `.update` gagal HTTP 403 (GitHub)

Jika WhatsApp menampilkan `Membaca commit terbaru gagal: HTTP 403`, updater lama gagal pada GitHub REST API. Hal ini sering terjadi akibat limit akses GitHub tanpa token (60 request/jam per IP), tetapi status 403 juga bisa disebabkan penolakan akses. **Updater terbaru** memakai REST API dengan token opsional, dan otomatis memakai `git ls-remote` serta `git diff` dari repository bare sementara jika REST menghasilkan 403/429 atau error server. Verifikasi baseline, daftar file berubah, dan perlindungan file lokal tetap wajib; bot **tidak** menjalankan `git reset --hard` atau menghapus database, sesi, maupun konfigurasi.

**Bootstrap satu kali jika versi `.update` lama sudah terblokir:** karena `.update` yang rusak tidak dapat memperbarui dirinya sendiri, buka [versi terbaru `plugins/owner/update.js`](https://github.com/lightevil96-svg/Alvareth-Bot/blob/main/plugins/owner/update.js), klik **Raw** untuk mengambil isi lengkap file, lalu pada TokoPanel → **Files** buka `plugins/owner/update.js` dan ganti isinya dengan versi terbaru tersebut, kemudian **Save** dan **Restart**. *Hanya file updater ini yang diganti secara manual.* Saat `.update` dijalankan ulang, pemeriksaan SHA akan mengenali updater yang sudah sama dengan commit GitHub, sehingga tidak ditimpa. Hindari mengedit file lain dan **jangan** menghapus `.alvareth-bot-data/update-state-v1.json`, karena berisi baseline aman yang dibutuhkan untuk membandingkan perubahan.

Jika akses Git menggunakan `git ls-remote` juga ditolak/tidak tersedia, opsional atur `ALVARETH_GITHUB_TOKEN` pada **Environment** TokoPanel, memakai token GitHub *fine-grained*, read-only, hanya repository yang diperlukan. **Jangan menaruh token di kode, WhatsApp, GitHub, atau log**, dan jangan meminta akses tulis yang tidak diperlukan. Bila GitHub menerapkan limit sekundernya, tunggu sesuai `retry-after`/reset dan jangan mengulang `.update` terus-menerus.

### YouTube Clip (`.clip`) — progres terminal

Kirim `.clip https://youtu.be/VIDEO_ID 25:00 27:00`. Format waktu mendukung `MM:SS` atau `HH:MM:SS`; durasi tidak dibatasi oleh kode bot. Progres persentase dan tahap proses dicatat di terminal TokoPanel melalui log `[CLIP:<job>]`. Chat WhatsApp menerima hasil video atau pesan gagal setelah proses selesai.

Downloader tidak memaksakan batas sumber 256 MB/96 MB atau kompresi output 45 MB. Pengiriman memakai satu helper bersama untuk `.clip` dan `.download`: file lokal divalidasi (path, izin baca, ukuran, MIME, dan ruang temp), lalu Baileys membaca path dari disk sehingga video ratusan MB tidak dimuat utuh ke RAM. **Semua file yang terdeteksi sebagai video dikirim menggunakan payload video WhatsApp tanpa ambang ukuran**, termasuk MP4, M4V, MOV, MKV, WebM, AVI, dan format video lain yang MIME-nya dikenali. Aturan ini berlaku sama untuk `.clip` dan `.download`; tidak ada fallback otomatis menjadi dokumen jika endpoint video menolak file. File nonvideo (PDF, ZIP, DOCX, dan lainnya) tetap dikirim sebagai dokumen. Tidak ada retry otomatis setelah status upload ambigu, untuk menghindari pesan ganda. File final tetap disimpan di `downloads/clip` agar dapat dikirim ulang melalui `.download`; hanya folder kerja sementara yang dibersihkan.

**Pengiriman WhatsApp:** Baileys `0.3.18-final` menerima `{ url: absolutePath }` untuk media dan opsi `mediaUploadTimeoutMs`; helper mengatur timeout upload default 30 menit. Satu upload diproses pada satu waktu per socket, dengan antrean maksimum 3 pekerjaan. Saat startup, bot mengarahkan `TMPDIR` Node/Baileys ke direktori sementara yang dapat ditulis pada storage server (default `~/.alvareth-bot-data/tmp`, atau di bawah `ALVARETH_DATA_DIR` jika diatur), bukan `/tmp` tmpfs Pterodactyl yang default-nya 100 MiB. `ALVARETH_WA_TMPDIR` dapat dipakai untuk memilih path absolut lain. Sebelum upload, helper memeriksa ruang pada direktori tersebut: perkiraan kebutuhan 1,2× ukuran file + 16 MiB untuk dokumen, atau 2,2× untuk semua pesan video (Baileys juga menyimpan salinan sementara untuk thumbnail). Batas ukuran di sisi bot default 2 GiB − 10 MiB; batas layanan WhatsApp/hosting dapat lebih rendah. Jika upload gagal, file tidak dihapus dan pesan error membedakan ENOSPC, ENOENT, EACCES, timeout, ECONNRESET, HTTP 413, dan HTTP 428. Resolusi `sendMessage` dengan ID pesan berarti proses Baileys selesai mengirim/relay; itu **bukan** bukti tanda terima atau pesan sudah dibaca penerima.

**File manager (`.download`):** ketik `.download` di chat pribadi, buka folder, lalu pilih file. Balasan daftar WhatsApp (list/button/native-flow), termasuk yang dibungkus ephemeral/view-once, dirutekan kembali ke perintah. Semua file video yang terdeteksi berdasarkan MIME atau ekstensi dikirim sebagai pesan video tanpa melihat ukuran file; file nonvideo dikirim sebagai dokumen. Jika WhatsApp/provider menolak video karena ukuran atau container tidak didukung, bot melaporkan kegagalan dan mempertahankan file sumber—tidak mengubahnya menjadi dokumen. Jika upload gagal, file tetap tersedia di folder asal untuk dicoba kembali setelah memperbaiki koneksi/ruang temp.

**Environment opsional:**
- `ALVARETH_DOWNLOAD_MAX_BYTES`: batas ukuran file yang boleh dikirim; default `2 GiB - 10 MiB`.
- `ALVARETH_WA_UPLOAD_TIMEOUT_MS`: batas waktu upload media Baileys; default `1800000` (30 menit).
- `ALVARETH_WA_MAX_PENDING_UPLOADS`: maksimum upload aktif + antrean; default `3` (satu diproses pada satu waktu).
- `ALVARETH_WA_TMPDIR`: direktori sementara absolut untuk enkripsi media Baileys; default `~/.alvareth-bot-data/tmp` (atau `ALVARETH_DATA_DIR/tmp`). Pastikan folder berada pada storage server yang memiliki ruang kosong cukup.

**Batas waktu:** tidak ada idle timeout atau hard timeout aplikasi pada yt-dlp, FFmpeg, pemeriksaan metadata, dan unduhan API khusus `.clip`. Proses menunggu sampai program/provider mengembalikan hasil atau error. Ini berarti satu metode yang benar-benar macet tidak akan otomatis dialihkan ke metode berikutnya. Tidak ada batas durasi/ukuran dari kode bot, tetapi YouTube, API pihak ketiga, WhatsApp, dan kapasitas disk/hosting tetap dapat membatasi atau menolak permintaan.

**Pemilihan kualitas multi-metode:** sekarang tersedia **lima jalur**: unduhan video/audio terpisah (baru), yt-dlp sections, FFmpeg segment clip, FFmpeg stream seek, dan Qbyte API. Setiap metode memeriksa inventaris kualitas sumber, mencoba format HD lain jika stream pertama tidak memiliki gambar/ternyata lebih rendah dari metadata, dan memverifikasi hasil dengan FFprobe serta FFmpeg blackdetect sebelum dianggap sukses. Unduhan yt-dlp menggunakan kombinasi profil YouTube default, `web_safari` dan `mweb` opsional (jika PO Token Provider dikonfigurasi). Untuk gabungan VP9/AV1 dengan AAC/Opus, yt-dlp memakai wadah sementara MKV lalu dikonversi ke H.264/AAC MP4. Lima metode dibandingkan berdasarkan **resolusi aktual**, FPS, dan bitrate; hanya kandidat terbaik yang disimpan di disk sementara hasil lebih rendah langsung dibersihkan. Proses dapat lebih lama karena mencoba ulang format dan metode saat sumber HD gagal.

**Validasi dan batas kualitas:** hasil MP4 dipetakan eksplisit ke track video dan audio, dikodekan H.264 CRF 18 + AAC 192 kbps, lalu diperiksa dengan `ffprobe` dan `blackdetect`. File audio-only, tanpa track gambar, atau hampir seluruhnya hitam ditolak. Caption menampilkan resolusi dan FPS aktual. Jika metadata sumber menampilkan 1080p tetapi tidak ada format HD yang berhasil diekstrak secara valid, caption memberi **peringatan penurunan kualitas** dan menyebut resolusi sumber yang terdeteksi; bot tidak mengklaim hasil 360p setara dengan sumber 1080p. Bot tidak meng-upscale video sumber: jika semua inventaris hanya menyediakan 360p, hasil maksimalnya tetap 360p. Jika sumber aslinya HD tetapi format HD tidak muncul, server mungkin memerlukan EJS/PO Token Provider. `YTDLP_POT_PROVIDER_URL=http://127.0.0.1:4416` hanya berfungsi jika plugin [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) dan server providernya sudah terpasang/berjalan; gunakan alamat localhost/jaringan privat, jangan publikasikan server provider tanpa perlindungan.

**Jika YouTube menampilkan “Sign in to confirm you’re not a bot”:** masalahnya adalah penolakan akses dari YouTube, bukan kesalahan resolusi atau FFmpeg. `.clip` kini mengenali verifikasi, tidak mengulang empat metode yt-dlp yang ditolak oleh sesi yang sama, dan mencoba API Qbyte. Gangguan Qbyte HTTP 502/503/504 dicoba ulang sekali. Jika tetap gagal, WhatsApp menampilkan pesan yang menjelaskan bahwa autentikasi YouTube dibutuhkan.

Untuk menggunakan sesi YouTube milik sendiri, ikuti [panduan ekspor cookies yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies) dan [FAQ format cookies](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp). Ekspor hanya cookies YouTube dalam format **Netscape/Mozilla cookies.txt**, bukan JSON. Simpan di server secara privat sebagai `/home/container/.alvareth-bot-data/youtube-cookies.txt` (otomatis terdeteksi jika folder kerja adalah `/home/container`), atau set environment variable `YTDLP_COOKIES_FILE` ke path absolut file tersebut. Batasi izin akses dengan `chmod 700 /home/container/.alvareth-bot-data` dan `chmod 600 /home/container/.alvareth-bot-data/youtube-cookies.txt`, lalu restart bot dan coba `.clip` lagi.

**Keamanan:** jangan kirim file cookies, isi cookies, atau detail akun lewat WhatsApp, GitHub, maupun percakapan ChatGPT. Cookies adalah kredensial sesi yang sensitif dan dapat kedaluwarsa. Penggunaan akun bersama yt-dlp memiliki risiko pembatasan akun; akses juga dapat tetap diblokir oleh YouTube berdasarkan IP server. Bot tidak dapat mengatasi penolakan server YouTube hanya dengan menaikkan pengaturan kualitas.

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


## LightJurnal Video Studio — prompt-first Remotion editing

LightJurnal sends one natural-language prompt to Alvareth-Bot. The AI planner turns the brief into a creative direction and storyboard, then compiles it into a validated Remotion project. Scene count, per-scene pacing, aspect ratio, FPS, palette, layout, motion, transitions, music mood and sound cues are inferred from the prompt; users do not configure them manually.

### Setup

1. Install dependencies after updating the bot: npm install.
2. Optional but recommended: configure a text-model provider using VIDEO_STUDIO_AI_API_KEY, VIDEO_STUDIO_AI_BASE_URL, and VIDEO_STUDIO_AI_MODEL in the private server environment. The default base URL is OpenAI-compatible (https://api.openai.com/v1). If no key is supplied, the planner tries the existing API-Faa GPT-prompt endpoint as a best-effort fallback.
3. The API key for LightJurnal is generated automatically on first startup and saved outside the Git checkout at ~/.alvareth-bot-data/video-studio/api-key with owner-only file permissions. It is never committed to GitHub. An explicit VIDEO_STUDIO_API_KEY environment value (at least 32 characters) overrides the generated key.
4. CORS defaults to https://lightjurnal.my.id; override with VIDEO_STUDIO_ALLOWED_ORIGINS only when needed.
5. The HTTP server starts when Pterodactyl provides SERVER_PORT (or when PORT is explicitly set). The existing WhatsApp bot and this API run in the same Alvareth-Bot process.
6. The HTTP API still requires an HTTPS reverse proxy or Cloudflare Tunnel in front of the Pterodactyl allocation. Do not expose the raw API over plain HTTP to browsers.
7. In LightJurnal → Video Studio, enter the HTTPS API URL and API key once. These are connection credentials, not creative settings; the prompt is the only video brief input.

### API

- GET /api/video-studio/health — public readiness check (does not reveal the key).
- GET /api/video-studio/limits — supported renderer limits; requires Bearer authentication.
- POST /api/video-studio/plan — accepts a prompt and returns a normalized creative brief/storyboard.
- POST /api/video-studio/jobs — accepts a validated plan and enqueues the compiled Remotion project. Legacy manual payloads remain supported for compatibility.
- GET /api/video-studio/jobs — recent render jobs.
- GET /api/video-studio/jobs/:id — inspect job status.
- GET /api/video-studio/jobs/:id/download — download completed MP4.

All routes except health require a Bearer VIDEO_STUDIO_API_KEY. Model credentials stay on the server and are never sent to the browser.

### Creative and rendering behavior

- The AI chooses narrative structure, scene count, variable scene durations, visual hierarchy, palette, composition, motion, transitions, music mood and selected sound cues.
- The renderer currently supports typography and designed motion graphics: hero, editorial, split, stat, quote, steps and outro layouts, plus animated geometric motifs.
- Renderer safety limits: maximum 60 scenes, 20 seconds per scene, and 300 seconds total. These are server safeguards, not user-facing controls.
- Not yet implemented: synthesized spoken voice-over, automatic stock-footage search, AI-generated scene footage, uploaded-media editing, photorealistic/3D assets, and a drag-and-drop editing timeline. Narration is currently retained as a script in the storyboard, not spoken audio.
- A VPS deployment, dependency installation, HTTPS reverse proxy, configured AI provider, browser Chromium and real MP4 render test must be verified on the live Pterodactyl instance before claiming production readiness.

### Official Remotion Agent Skills

Run npm run skills:remotion in the repository to install the full official Remotion Agent Skills collection. See video-studio/SKILLS.md for the 13 skills and when to load each one.
