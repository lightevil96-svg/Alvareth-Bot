## 2026-11-04 — Dedicated Cloudflare Tunnel for LightJurnal Video Studio

- **Permintaan/gejala:** LightJurnal Video Studio tidak dapat terhubung langsung ke Alvareth; server log menunjukkan `cloudflared` binary tidak ditemukan. Quick Tunnel lama menghasilkan URL sementara, sedangkan hostname produksi belum memiliki route yang stabil.
- **Akar masalah:** `video-studio/tunnel.js` hanya mencari `./bin/cloudflared`, tidak mendeteksi binary dari PATH atau memasang binary otomatis, dan hanya menjalankan Quick Tunnel. Tidak ada named tunnel token flow yang persisten untuk hostname produksi.
- **Cloudflare:** membuat remotely-managed tunnel `lightjurnal-video-studio`, mengatur ingress `video.lightjurnal.my.id` → `http://127.0.0.1:2132` dengan fallback 404, dan membuat DNS CNAME proxied `video.lightjurnal.my.id` → tunnel UUID. Tunnel SSH lama `chromebook-lightjurnal`, domain utama, dan DNS record yang sudah ada tidak diubah.
- **Perubahan kode:** `video-studio/tunnel.js` sekarang membaca token dari `VIDEO_STUDIO_TUNNEL_TOKEN` atau file privat di data directory, mendeteksi binary dari konfigurasi/lokasi lokal/PATH, serta mengunduh rilis resmi cloudflared untuk Linux x64/ARM64 dengan verifikasi SHA-256 dari GitHub Releases. Named tunnel dijalankan memakai `--token-file` agar token tidak muncul pada argumen proses, dan reconnect memakai exponential backoff terbatas. Menambahkan regression test untuk pemetaan platform, konfigurasi environment, dan dokumentasi setup.
- **Frontend:** LightJurnal akan memakai default API URL `https://video.lightjurnal.my.id` sehingga URL tidak perlu diisi manual; API key tetap hanya dimasukkan satu kali pada sesi browser.
- **Belum diverifikasi:** konektor Cloudflare belum bisa menjadi Healthy sampai pemilik menambahkan token tunnel ke environment Pterodactyl (atau mengunggah token file privat) dan me-restart bot. Akses shell/Pterodactyl tidak tersedia dari koneksi ini; tidak mengklaim binary telah terpasang di host atau render MP4 live telah diuji.

## 2026-11-04 — Automatic self-update tanpa perintah .update

- **Permintaan:** Alvareth harus memeriksa dan menerapkan pembaruan GitHub sendiri tanpa owner mengetik `.update`.
- **Akar masalah:** updater aman sudah tersedia di `plugins/owner/update.js`, tetapi hanya dipanggil oleh command owner. `lib/auto-update.js` yang lama memakai jalur PM2 terpisah dan tidak dihubungkan ke lifecycle worker; konfigurasi PM2 juga tidak sesuai dengan supervisor cluster internal `index.js`.
- **Perubahan:** `lib/auto-update.js` kini menjadi scheduler yang memanggil handler updater yang sama dengan pesan log sintetis. `main.js` memulai scheduler setelah plugin dimuat. Pemeriksaan pertama berjalan 90 detik setelah startup, lalu setiap `AUTO_UPDATE_INTERVAL_MINUTES` (default 10). Jalur otomatis menghormati `AUTO_UPDATE_ENABLED=false`, mencegah overlap dengan command manual, dan memakai worker supervisor untuk restart setelah file/dependency berubah.
- **Keamanan:** tidak membuat updater kedua; kebijakan baseline/hash/conflict, perlindungan .env, sesi, database, data runtime, dan file lokal tetap berasal dari updater owner yang sudah ada. Tidak memerlukan PM2. `.update` tetap tersedia sebagai fallback manual.
- **Tes:** menambahkan tes untuk pemanggilan updater yang sama, log-only reply, lock command manual, pencegahan overlap, flag disable, dan updater plugin yang belum tersedia. GitHub Actions updater regression menjalankan tes transport + scheduler.
- **Belum diverifikasi:** bot live di Pterodactyl/WhatsApp, akses GitHub dari jaringan hosting, instalasi dependency nyata, dan restart worker setelah update pada server pengguna. CI bukan bukti deployment VPS.
- **Pelajaran regresi:** jangan membuat auto-updater kedua yang menulis file atau mengasumsikan PM2. Panggil mesin update yang sama dari worker setelah plugin dimuat; biarkan supervisor yang sudah ada mengelola restart.

## 2026-11-04 — Optional AI voice-over, word-timed captions, and Pexels footage

- Added an optional ElevenLabs TTS pipeline using the `/with-timestamps` endpoint. Character alignment is converted to timed word groups; scene durations are aligned to speech when the alignment fits the renderer's limits.
- Added a Pexels video search/download pipeline. The planner now emits concise English `stockSearchQuery` values for scenes where real-world footage improves the story. Downloaded assets are stored under the Remotion public directory, selected for the target aspect ratio, and credited on-screen and in job metadata.
- Remotion now layers stock footage under designed typography, plays voice-over tracks, displays word-highlighted captions, and ducks background music when narration exists.
- Added optional server environment variables for ElevenLabs and Pexels. Missing keys produce explicit job warnings and the renderer falls back to motion graphics without blocking the video.
- Added stage indicators for media preparation, voice generation, footage search, and rendering; added focused unit tests for alignment grouping, scene-aligned chunking, footage selection, asset-path validation, and media metadata.
- **Verification boundary:** CI can verify syntax, JSX compilation, and deterministic unit tests. It cannot prove that the user's provider keys are valid, that the Pexels catalogue returns suitable footage for every topic, or that the final MP4 renders correctly on the Pterodactyl VPS. A live provider/render test remains required.

## 2026-11-04 — Remotion JSX compile and focused regression checks passed

- **CI result:** Video Studio regression workflow passed JavaScript module syntax checks, compiled video-studio/remotion/index.jsx with esbuild (including Composition.jsx), and passed every test in tests/video-studio.test.js.
- **Coverage:** validated prompt normalization, variable scene duration, explicit requested duration, safe compilation, unsupported enum/color rejection, legacy project compatibility, and renderer limits.
- **Remaining verification:** esbuild proves JSX syntax and module graph compilation with Remotion/React treated as external packages. It is not a full Remotion webpack bundle or MP4 render. A real render still needs to run on the configured Pterodactyl/Chromium/FFmpeg environment.
- **Skills:** all 13 official Remotion Agent Skills and the project-specific remotion-professional-editor skill are present under .agents/skills.

## 2026-11-04 — Remotion skills installed and regression checks green

- **Skills installed:** the official remotion-dev/skills collection was installed by the GitHub Actions installer into .agents/skills. The repository contains 13 official skills plus the project-specific remotion-professional-editor skill (14 skill directories total).
- **Regression tests:** the focused Video Studio workflow passed its JavaScript module checks and all tests in tests/video-studio.test.js after the JSON parser export fix. The same workflow passed again after the Remotion composition polish. The latest workflow also compiles the Remotion JSX entrypoint with esbuild.
- **Frontend checks:** LightJurnal quality checks and the Pages build/deployment completed successfully for the prompt-only Video Studio revision.
- **Important verification boundary:** these checks do not prove that the live Pterodactyl instance has installed the latest dependencies, configured a working AI text-model credential, or successfully rendered a real MP4. The Remotion JSX bundle and an end-to-end render still need to be verified on the deployment runtime.

## 2026-11-04 — Remotion composition polish

- **Temuan review:** the new AI plan could choose fade, wipe, slide, zoom, or cut, but the renderer only implemented wipe; light-background detection also recognized only a few exact hex values, which could cause low-contrast text on other pale colors.
- **Perbaikan:** Composition.jsx now implements slide and zoom entrances, respects cut/fade/wipe behavior, calculates light/dark text contrast from relative luminance, and uses more suitable type scaling for landscape/square output. The outro no longer forces a generic “SELESAI” label when no CTA was supplied.
- **Tes:** targeted Node regression tests and JavaScript syntax checks passed on the prior code commit. This JSX composition change still requires a Remotion bundle/MP4 render check on the project runtime.
- **Batasan:** no new footage or spoken TTS was added; current output remains motion graphics with procedural music and selected SFX.

## 2026-11-04 — Video Studio test fix: export JSON parser

- **Temuan CI:** focused Video Studio regression workflow passed all JavaScript syntax checks but failed before test execution because tests imported parseJsonResponse while planner.js kept it private.
- **Akar masalah:** the parser was intentionally used internally but was also directly covered by a unit test; its function declaration was not exported.
- **Perbaikan:** exported parseJsonResponse from video-studio/prompt/planner.js so the parser can be tested without calling an external AI provider.
- **Tes:** rerun Video Studio regression workflow after this commit. The first run failed at module instantiation; do not treat it as a passing test. Full test result remains pending.
- **Pelajaran:** test helper visibility must match test imports; verify focused workflow logs rather than relying only on repository-wide syntax checks.

## 2026-11-04 — Video Studio prompt-only AI Creative Director

- Permintaan: membuat hasil Remotion lebih natural dan profesional, menghapus pengaturan kreatif manual, serta menjadikan prompt sebagai satu-satunya input untuk menentukan pacing, warna, scene, motion, transisi, rasio, FPS, dan audio.
- Akar masalah: LightJurnal sebelumnya membagi teks per baris menjadi scene dengan durasi seragam, warna latar seragam, dan beberapa pengaturan kreatif manual. Backend hanya memvalidasi payload teks sederhana; AI prompt interpreter dan storyboard compiler belum ada. Komposisi Remotion masih berupa typography dengan gerakan yang terbatas.
- Perubahan backend: menambahkan video-studio/prompt/planner.js untuk prompt-to-storyboard JSON, provider OpenAI-compatible yang dikonfigurasi di server, dan fallback best-effort ke API-Faa GPT-prompt. Menambahkan video-studio/prompt/compile.js sebagai adapter aman dari storyboard ke schema Remotion. POST /api/video-studio/plan menghasilkan storyboard; POST /jobs menerima plan yang sudah dikompilasi. Validasi mendukung durasi dinamis, maksimal 60 scene, 20 detik per scene, dan 300 detik total.
- Perubahan visual: Composition.jsx sekarang memiliki layout hero/editorial/split/stat/quote/steps/outro, motif geometris bergerak, beberapa preset motion, progress scene, musik fade-in/fade-out, dan sound cue yang dipilih per scene alih-alih SFX acak pada setiap scene.
- Skills: menambahkan npm run skills:remotion untuk memasang 13 official Remotion Agent Skills dari remotion-dev/skills, beserta panduan pemilihan skill di video-studio/SKILLS.md.
- Kompatibilitas: payload manual lama tetap didukung oleh endpoint jobs; API key LightJurnal tetap terpisah dari kredensial model AI. Prompt, plan, dan metadata pekerjaan tidak menyimpan API key.
- Batasan jujur: narration baru disimpan sebagai naskah dan belum disintesis menjadi suara. Pencarian stock footage, AI-generated video per scene, upload media, 3D/photorealistic footage, dan timeline drag-and-drop belum tersedia. Hasil renderer saat ini berupa motion graphics dengan musik prosedural dan SFX terpilih.
- Tes: menambahkan unit tests untuk normalisasi storyboard, variasi durasi berdasarkan panjang narasi, parsing JSON, durasi eksplisit, validasi compiler, enum allowlist, dan kompatibilitas payload lama. Hasil runtime test/CI belum dijalankan pada saat commit ini; render MP4 live, API AI provider, Chromium/Pterodactyl, dan koneksi browser tetap perlu diverifikasi.
- Skills: versi official Remotion skills yang dituju 4.0.540, sesuai versi Remotion pada package.json. Instalasi aktual perlu dijalankan pada checkout lokal dengan npm run skills:remotion.

## 2026-11-04 — Spesifikasi AI Prompt Understanding untuk Video Studio

- **Permintaan:** dokumentasikan di repository bagaimana AI berikutnya harus memahami prompt pengguna dan menerjemahkannya menjadi storyboard serta proyek Remotion, agar AI coding agent lain dapat membaca GitHub dan melanjutkan implementasi.
- **Perubahan:** menambahkan `video-studio/PROMPT_ENGINEERING.md` sebagai kontrak implementasi. Isinya mencakup pipeline prompt intake → intent extraction → creative brief → storyboard → audio direction → JSON planning envelope → safe Remotion compiler → validation → render; contoh JSON; aturan prompt; batas kompatibilitas renderer sekarang; struktur modul yang disarankan; acceptance criteria; dan instruksi untuk AI agent berikutnya. Memperbarui `AI_CONTEXT.md` agar panduan ini wajib dibaca.
- **Status:** dokumentasi/specification only. Tidak menambahkan AI provider, prompt interpreter, storyboard generator, TTS, atau klaim fitur tersebut sudah berjalan.
- **Tes:** memeriksa isi file terkait dan memastikan tautan dokumentasi masuk ke AI_CONTEXT. Belum ada runtime/test AI karena implementasi AI belum dibuat.
- **Belum diverifikasi:** implementasi prompt engine end-to-end, integrasi provider AI, preview storyboard, dan render hasil prompt AI.

## 2026-11-04 — Penyempurnaan kontrol scene dan antrean Video Studio

- **Permintaan/gejala:** tahap pertama perlu membedakan mode Simple dan Professional, menjaga polling antrean saat halaman dibuka ulang, serta membatasi riwayat dan file render parsial.
- **Akar penyebab:** UI awal hanya mengirim durasi default yang sama dan polling belum dimulai ulang untuk pekerjaan aktif yang sudah ada; antrean belum memangkas riwayat terminal.
- **Perubahan:** mode Professional kini menyediakan pengaturan durasi dan warna latar scene; UI mempertahankan token sesi saat koneksi ulang dan melanjutkan polling antrean aktif. Worker membatasi riwayat ke 100 pekerjaan dan menghapus output parsial saat render gagal. Environment example juga mendokumentasikan PORT untuk alokasi Pterodactyl.
- **Tes:** GitHub Actions JavaScript syntax checks lulus pada commit `d558398`; tes validasi proyek lokal lulus 4/4. LightJurnal quality checks dan GitHub Pages deployment lulus pada commit `39ff451`. Perbaikan UI/queue belum diuji terhadap API VPS. Render Remotion sebenarnya tetap menunggu instalasi dependency dan runtime server.
- **Belum diverifikasi:** koneksi HTTPS publik, browser Chromium pada container Pterodactyl, dan render MP4 live.
- **Pelajaran regresi:** UI mode Professional harus menampilkan kontrol yang benar-benar memengaruhi payload, bukan hanya label mode; polling harus pulih setelah reload.

## 2026-11-04 — Fondasi remote Remotion Video Studio untuk LightJurnal

- **Permintaan/gejala:** pengguna ingin LightJurnal menjadi panel kendali, sementara Alvareth-Bot yang sudah berjalan di Pterodactyl menerima perintah dan mengerjakan rendering video.
- **Akar penyebab:** belum ada API render pada server HTTP opsional Alvareth-Bot dan belum ada halaman Video Studio pada LightJurnal.
- **Perubahan:** menambahkan API Bearer-token dengan allowlist CORS, validasi payload proyek, antrean render persisten satu worker, komposisi Remotion motion-typography, endpoint status/unduh, dan dokumentasi konfigurasi. LightJurnal mendapat navigasi dan UI Simple/Professional untuk membuat proyek teks, memantau antrean, preview, dan unduh.
- **Tes:** pemeriksaan sintaks Node.js untuk modul backend/UI dan `node --test tests/video-studio.test.js` lulus 4/4 di lingkungan kerja. Belum menjalankan `npm install`, render MP4 sesungguhnya, workflow GitHub Actions, atau pengujian Pterodactyl/HTTPS.
- **Belum diverifikasi:** dependency Remotion harus dipasang pada server; server HTTP harus berjalan dengan `PORT`; reverse proxy HTTPS, API key, CORS dari domain, browser Chromium, dan ruang disk VPS perlu dikonfigurasi. Upload gambar/video/audio, timeline drag-and-drop, serta kirim hasil melalui WhatsApp belum termasuk tahap pertama.
- **Pelajaran regresi:** jangan memindahkan atau mengubah sesi/database bot. Data render harus tetap di direktori runtime di luar checkout; jangan pernah menaruh API key di frontend atau repository.

## 2026-11-03 — Fix candidate undefined pada finalisasi kualitas tertinggi

- **Gejala:** uji .clip nyata menemukan format 720p melalui metadata, tetapi kedua kandidat (136+251 HTTPS dan 232+251 HLS) gagal pada tahap FFmpeg dengan candidate is not defined. Fallback Qbyte hanya menyediakan 360p dan benar dibatalkan karena lebih rendah dari 720p.
- **Akar masalah:** helper downloadValidatedClipFormat memanggil finalize(inputPath, candidate), tetapi callback finalisasi strategi utama hanya mendeklarasikan parameter inputPath. Callback lalu membaca candidate.video untuk menentukan codec, dimensi, dan opsi stream-copy/encode sehingga terjadi ReferenceError.
- **Perbaikan:** callback kini menerima kedua argumen: async (inputPath, candidate) => { ... }. Format tertinggi tetap satu-satunya yang diunduh; maksimal satu alternatif pada resolusi yang sama tetap menjadi batas retry. Tidak mengaktifkan kembali lima metode download berurutan dan tidak mengizinkan fallback ke resolusi lebih rendah.
- **Regresi:** tambah tes yang memastikan callback finalisasi menerima kandidat terpilih dan menggunakan metadata video kandidat tersebut.
- **Validasi:** GitHub Actions npm run test:clip lulus 32/32, termasuk tes regresi callback finalizer (run 41636334551); pemeriksaan sintaks JavaScript seluruh repo juga lulus (run 41636334438). Live download YouTube dan upload WhatsApp pada TokoPanel tetap perlu diuji.

## 2026-11-03 — .clip memindai metadata dahulu dan hanya mengunduh kualitas tertinggi

- **Gejala/permintaan:** log menunjukkan lima metode downloader dijalankan berurutan meskipun metode pertama sudah menghasilkan 720p. Setiap metode mengulang download/crop/FFmpeg; API Qbyte bahkan mengunduh video 497,7 MB dan audio 258,5 MB untuk hasil 360p. Pengguna meminta sistem melihat semua kualitas lebih dahulu dan hanya mengambil kualitas tertinggi tanpa mengunduh semua kandidat.
- **Akar masalah:** pipeline lama membandingkan kualitas setelah setiap metode menghasilkan file. Inventaris metadata yt-dlp sudah tersedia, tetapi empat strategi yt-dlp dan satu fallback Qbyte tetap dijalankan untuk membandingkan output yang sudah diunduh.
- **Perubahan:** .clip kini memindai seluruh format dari profil YouTube yang tersedia menggunakan --dump-single-json --skip-download, mencatat semua resolusi unik, lalu memilih stream dengan resolusi/piksel tertinggi, FPS, protokol, dan bitrate. Hanya satu metode yt-dlp yang mengunduh dan memotong segmen terpilih. Jika stream tertinggi tidak valid, maksimal satu alternatif pada dimensi/resolusi yang sama boleh dicoba; sistem tidak turun berurutan ke 720p/480p/360p untuk membandingkan hasil.
- **Fallback:** Qbyte hanya dipanggil satu kali jika yt-dlp gagal. Qbyte memeriksa metadata dahulu dan hanya mengunduh satu pasangan video/audio terbaik; fallback di bawah resolusi yang sebelumnya ditemukan yt-dlp dibatalkan. Ukuran sumber dibatasi default 256 MiB per stream, dapat diubah melalui ALVARETH_CLIP_QBYTE_MAX_SOURCE_BYTES.
- **Optimasi FFmpeg:** jika video sumber sudah H.264 dan dimensi kompatibel, video di-stream-copy alih-alih di-encode ulang. Audio hanya di-encode ke AAC bila codec sumber tidak kompatibel dengan MP4.
- **Tes:** GitHub Actions npm run test:clip lulus 31/31 (run 41634506716); pemeriksaan sintaks JavaScript seluruh repo lulus (run 41634506676). Tes mencakup inventaris metadata-only, pemilihan satu resolusi tertinggi, satu alternatif pada resolusi sama, fallback Qbyte satu pasangan, validasi stream video, dan fixture FFprobe nyata.
- **Belum diverifikasi:** uji live download YouTube dan pengiriman video ke WhatsApp melalui TokoPanel harus dilakukan setelah bot direstart. Metadata tidak menjamin stream dapat diunduh; bila format tertinggi ditolak YouTube, sistem akan mencoba satu alternatif pada resolusi sama lalu melaporkan kegagalan, bukan mengunduh semua resolusi.

## 2026-11-03 — Semua ukuran video `.clip` dan `.download` dikirim sebagai video

- **Permintaan:** jangan mengubah video berukuran besar menjadi dokumen. Aturan harus sama pada `.clip` dan `.download`.
- **Perubahan:** helper bersama mengklasifikasikan semua MIME `video/*` dan ekstensi video umum (MP4, M4V, MOV, MKV, WebM, AVI, MPEG/MPG, 3GP, FLV, WMV, TS/M2TS, OGV, dan lainnya) sebagai payload `video`, tanpa ambang 64 MiB. `.clip` tidak lagi menambahkan caption dokumen atau menampilkan status sukses dokumen. `.download` tidak lagi memerlukan `forceVideo` khusus MP4. File nonvideo tetap memakai payload dokumen. Variabel `ALVARETH_WA_INLINE_VIDEO_MAX_BYTES` dihapus dari contoh konfigurasi/dokumentasi.
- **Perilaku gagal:** jika WhatsApp/provider menolak payload video karena ukuran atau container, bot melaporkan kegagalan dan mempertahankan file sumber. Tidak ada fallback otomatis ke dokumen.
- **Tes:** GitHub Actions `npm run test:media` 18/18 lulus (run 41627217911), termasuk MP4 besar, WebM besar, MKV, PDF, dan temporary storage; `npm run test:clip` 30/30 lulus (run 41627217972); download-browser regression lulus (run 41627217800); repository-wide JavaScript syntax checks lulus (run 41627217816). Pengiriman live video besar ke WhatsApp masih perlu diverifikasi.

## 2026-11-03 — Paksa MP4 pada `.download` dikirim sebagai video

- **Gejala:** file MP4 181,6 MB yang dipilih dari `.download` dikirim sebagai dokumen karena helper bersama memakai ambang video inline default 64 MiB.
- **Perubahan:** `.download` kini mengirim opsi `forceVideo` khusus untuk file berekstensi `.mp4`; helper `lib/whatsapp-file-sender.js` mengabaikan ambang 64 MiB hanya ketika opsi tersebut aktif dan ekstensi file `.mp4`. File MP4 dari `.download` menggunakan payload `video`, sedangkan file lain tetap dokumen. `.clip` tidak mengaktifkan override ini sehingga kebijakan sebelumnya (MP4 besar sebagai dokumen) tetap sama. Perbaikan temporary storage global tetap berlaku untuk keduanya.
- **Tes:** GitHub Actions `npm run test:media` 17/17 lulus (run 41626225894), termasuk tes MP4 70 MiB dengan `forceVideo: true`; JavaScript syntax checks lulus (run 41626225846) dan download-browser regression lulus (run 41626225965). Tes mock memverifikasi payload video, bukan pengiriman live WhatsApp.
- **Batasan:** video MP4 berukuran sangat besar tetap tunduk pada batas endpoint video WhatsApp/provider. Jika ditolak, bot tidak mengubahnya otomatis menjadi dokumen; file sumber tetap tersimpan untuk dicoba ulang atau diproses dengan kebijakan lain.

## 2026-11-03 — Alihkan temporary storage Baileys dari tmpfs Pterodactyl

- **Gejala:** upload dokumen MP4 181,6 MB ditolak oleh preflight karena os.tmpdir() hanya menyediakan 100,0 MB, sementara estimasi kebutuhan Baileys 233,9 MB. File sumber tetap tersimpan.
- **Akar penyebab:** Baileys menulis file sementara saat menyiapkan/enkripsi media keluar. Pada Pterodactyl Wings, /tmp container secara default adalah tmpfs 100 MiB yang memakai memori host dan terpisah dari disk server. Node.js memakai /tmp jika TMPDIR tidak diatur.
- **Perubahan:** lib/whatsapp-temp-dir.js menyiapkan dan menguji direktori writable di storage server; default <ALVARETH_DATA_DIR atau ~/.alvareth-bot-data>/tmp, dapat dioverride dengan ALVARETH_WA_TMPDIR. lib/whatsapp-temp-bootstrap.js dijalankan setelah dotenv/config tetapi sebelum import Baileys di main.js, lalu mengatur TMPDIR. Jika override tidak valid, bot mencoba direktori data default. lib/whatsapp-file-sender.js mencatat lokasi temp aktual. Tes regresi mencakup default, override, dan fallback; README, .env.example, serta workflow diperbarui.
- **Tes:** GitHub Actions `npm run test:media` 16/16 lulus (run 41624768802), termasuk uji default, override, fallback, dan urutan import bootstrap sebelum Baileys. JavaScript syntax checks lulus (run 41624768781); download-browser regression (run 41624533274) dan YouTube Clip progress regression (run 41624533073) juga lulus. Workflow sticker terpisah gagal saat instalasi dependency native `canvas` karena `pixman-1` tidak tersedia; tes sticker tidak sempat dijalankan dan kegagalan itu tidak terkait patch ini. Tidak ada pengiriman WhatsApp live.
- **Batasan:** perubahan ini memindahkan file sementara dari tmpfs /tmp ke storage server Pterodactyl; tidak menambah kuota disk server dan tidak mengubah batas file WhatsApp. Disk server tetap harus memiliki ruang kosong sesuai kebutuhan file dan proses enkripsi. Pengiriman live di TokoPanel/WhatsApp masih perlu diverifikasi.
- **Pelajaran regresi:** jangan hanya menaikkan batas ukuran file atau menonaktifkan preflight saat os.tmpdir() adalah tmpfs 100 MiB. Periksa TMPDIR, filesystem aktual, serta kuota disk container sebelum mengubah batas upload.

## 2026-11-03 — Audit dan perbaikan pengiriman `.clip` / `.download` ke WhatsApp

- **Gejala screenshot:** terminal menemukan sumber sekitar 417,6 MB dan format 1920×1080 60 FPS; bot kemudian menyatakan `.clip` gagal, sementara file tetap tersedia di server dan bisa diambil melalui panel. `.download` menampilkan browser folder, tetapi jalur pemilihan/pengiriman belum memberikan hasil yang konsisten.
- **Akar masalah yang dapat dibuktikan dari source:** `downloadYoutubeClip()` menerima `maxOutputBytes` default 0; `fitClipForWhatsApp()` hanya mengompres jika nilai itu >0, sedangkan plugin `.clip` tidak memberikan batas tersebut. Maka file besar dipertahankan pada kualitas asli. Plugin sebelumnya selalu mencoba media `video` dahulu, baru fallback ke `document` untuk semua error; untuk file besar ini salah memilih endpoint di awal dan fallback dapat membuat duplikasi bila status percobaan pertama ambigu. `.download` mengirim dokumen melalui jalur terpisah tanpa konfigurasi `mediaUploadTimeoutMs`, tanpa preflight kapasitas temp, dan tanpa antrean upload bersama. Baileys `@itsliaaa/baileys@0.3.18-final` memang menerima `{ url: localPath }` sebagai media disk-streaming dan opsi `mediaUploadTimeoutMs`; proses enkripsi Baileys menulis file sementara di `os.tmpdir()` sebelum upload. Helper lama `conn.sendFile()` di `lib/simple.js` membaca file penuh ke RAM, sehingga tidak digunakan untuk video besar.
- **Perbaikan:** tambah `lib/whatsapp-file-sender.js`, dipakai oleh `.clip` dan `.download`. Helper memeriksa file/path/symlink/izin baca/MIME/ukuran, memeriksa ruang `os.tmpdir()` (perkiraan 1,2× untuk dokumen, 2,2× untuk video inline), menggunakan `{ url: absolutePath }`, menetapkan `mediaUploadTimeoutMs` default 30 menit, dan menyerialisasi upload per socket (satu aktif; maksimal 3 antrean). MP4/M4V sampai 64 MiB default dikirim sebagai video inline; MP4 yang lebih besar dan container lain (MOV/MKV/WebM/AVI) dikirim sebagai dokumen sejak awal untuk mempertahankan kualitas asli dan menghindari percobaan ganda. Batas bot default 2 GiB−10 MiB, dapat dikonfigurasi. Tidak ada retry otomatis setelah error upload ambigu; file sumber tidak dihapus.
- **Error & retention:** error ENOSPC/ENOENT/EACCES/HTTP 413/HTTP 428/timeout/ECONNRESET mendapat diagnosis yang lebih jelas. `.clip` membedakan kegagalan download/crop/validasi/upload; jika upload gagal setelah file final disimpan, file tetap ada di `downloads/clip` dan pengguna dapat mencoba `.download`. Folder kerja sementara tetap dibersihkan. Keberhasilan hanya dicatat setelah `conn.sendMessage` selesai dan mengembalikan ID pesan; ini bukan bukti read receipt/delivered receipt.
- **Router `.download`:** tambah `lib/interactive-command.js`; `handler.js` meng-unwarp ephemeral/view-once/document-caption/device-sent wrappers sebelum mengambil list/button/native-flow ID. Ini memastikan pilihan daftar tetap menjadi command `.download` saat dibungkus WhatsApp.
- **File diubah:** `plugins/downloader/clip.js`, `plugins/downloader/download.js`, `handler.js`, `lib/whatsapp-file-sender.js`, `lib/interactive-command.js`, `tests/whatsapp-file-sender.test.js`, `tests/interactive-command.test.js`, `tests/clip-policy.test.js`, `package.json`, `.env.example`, `.github/workflows/media-delivery-regression.yml`, `README.md`, `AI_CONTEXT.md`.
- **Tes yang benar-benar dijalankan di GitHub Actions:** media-delivery regression 9/9 sebelum penambahan tes klasifikasi; setelah itu `npm run test:media` 12/12 lulus (workflow 41620068450); `npm run test:download` 4/4 lulus (workflow 41620068403). `npm run test:clip` 30/30 lulus (workflow 41620068611); repository-wide Node syntax checks lulus; download-browser regression lulus. Tidak ada tes yang mengirim file ke akun WhatsApp live.
- **Deployment:** setelah commit main tersedia, TokoPanel harus menarik perubahan sesuai metode deployment proyek, lalu restart bot. Uji `.clip` dengan klip kecil terlebih dahulu, lalu MP4 >64 MiB; periksa log `[CLIP]`, `[WA-FILE]`, dan `[DOWNLOAD]`. Bila upload gagal, file tetap tersedia dan detail error menunjukkan apakah penyebabnya ruang temp, koneksi, timeout, atau batas ukuran.
- **Batasan:** WhatsApp/hosting dapat menerapkan batas lebih rendah dari batas internal 2 GiB−10 MiB; upload file ratusan MB tetap membutuhkan bandwidth dan ruang temp yang cukup. Resolusi `sendMessage` + ID pesan menandakan pipeline Baileys selesai/relay, bukan konfirmasi penerima membaca. Uji live TokoPanel dan pengiriman aktual masih belum dilakukan.

## 2026-11-03 — .clip: hentikan retry upload saat storage ENOSPC

- **Gejala:** klip 181,6 MB selesai dibuat dan tersimpan di `downloads/clip`, tetapi upload WhatsApp gagal dengan `ENOSPC: no space left on device, write`.
- **Akar masalah yang terlihat:** kegagalan terjadi pada tahap upload media, bukan download YouTube. Jalur lama mencoba upload ulang file yang sama sebagai dokumen setelah upload video gagal; ketika penyebabnya ruang disk habis, percobaan kedua dapat mengulang kegagalan dan memperburuk tekanan storage.
- **Perbaikan:** `plugins/downloader/clip.js` mengenali ENOSPC termasuk error bersarang, membaca kapasitas tersedia pada direktori temp Node (`TMPDIR` atau `os.tmpdir()`) untuk diagnostik terminal, dan tidak mengulang upload sebagai dokumen untuk error ini. File hasil final tetap dipertahankan di `downloads/clip`; bot memberi instruksi mengosongkan ruang temporary/server lalu mengambil ulang melalui `.download`. Fallback dokumen tetap aktif untuk kegagalan video non-ENOSPC.
- **Tes regresi:** ditambahkan klasifikasi ENOSPC bersarang, pembeda error lain, dan pemeriksaan bahwa jalur ENOSPC tidak menjalankan fallback dokumen serta file hasil tidak dihapus. Tes lokal/CI dan pengiriman live WhatsApp belum dijalankan pada server pengguna.
- **Batasan:** perubahan ini mencegah retry sia-sia dan kehilangan hasil download, tetapi tidak menambah kapasitas disk server. Untuk mengirim file 181,6 MB, ruang temporary pada container/host tetap harus tersedia; setelah ruang dibebaskan, gunakan `.download` dan pilih file di `downloads/clip`.

## 2026-11-03 — File manager WhatsApp `.download` dan penyimpanan hasil clip

- **Permintaan:** sediakan browser folder di chat dengan daftar interaktif, navigasi masuk/naik halaman, dan kirim file ketika dipilih.
- **Desain/implementasi:** `plugins/downloader/download.js` memakai list message WhatsApp (sesuai dokumentasi fork Baileys, list message hanya didukung di chat pribadi); pemanggilan dari grup ditolak dengan arahan ke chat pribadi. Row ID berisi command `.download` yang dikenali oleh normalisasi `listResponseMessage.singleSelectReply.selectedRowId` di `handler.js`; folder membuka subfolder, tombol kembali naik satu tingkat, dan pilihan file mengirim dokumen ke chat asal. Fitur owner-only.
- **Batas keamanan:** root dibatasi ke `ALVARETH_DOWNLOAD_DIR` (default `./downloads`); path traversal dan symlink ditolak, dotfiles disembunyikan, hanya file/folder biasa ditampilkan, daftar dipaginasi, dan ukuran file divalidasi sebelum upload. Tidak ada endpoint web atau akses ke root filesystem.
- **Integrasi `.clip`:** hasil final dipindahkan ke `downloads/clip` (atau subfolder `clip` di `ALVARETH_DOWNLOAD_DIR`) dan file kerja kandidat tetap dibersihkan. File clip yang sudah terkirim kini bisa dikirim ulang dengan `.download`.
- **Tes:** `tests/download-browser.test.js` mencakup encoding path Unicode, urutan folder/file, dotfile/symlink, traversal, dan ukuran; `npm test` menjalankan tes ini melalui `npm run test:download`. GitHub Actions syntax check tetap menjadi pemeriksaan terpisah; tes Node dan interaksi live WhatsApp belum dijalankan di server pengguna.
- **Koreksi analisis screenshot `.clip`:** screenshot susulan memperlihatkan command `2:03:15 2:09:54`, yang merupakan rentang valid (2 jam 3 menit 15 detik sampai 2 jam 9 menit 54 detik). Interpretasi sebelumnya atas screenshot terpotong sebagai `2:09.34` keliru; jangan menganggap command pengguna salah atau memakai diagnosis timestamp itu untuk menjelaskan kegagalan run tersebut. Perbaikan validasi dan pengamanan socket tetap berguna, tetapi penyebab kegagalan run sebelumnya harus ditentukan dari log proses lengkap.
- **Belum diverifikasi:** payload list interaktif pada fork Baileys yang terpasang, pengiriman file besar, serta perilaku file manager setelah restart TokoPanel.
## 2026-11-03 — Perbaikan validasi timestamp .clip dan pelaporan saat socket WhatsApp tertutup

- **Gejala pada screenshot:** perintah `.clip` diikuti stack Baileys `auth-utils.js` dengan HTTP 428 `Precondition Required` / `Connection Closed`. Stack menunjukkan kegagalan ketika Baileys mencoba mengirim pesan (`sendMessage` → `getSyncDevices`) pada koneksi yang sudah tertutup; percobaan laporan error fallback juga gagal pada socket yang sama.
- **Temuan input:** teks command yang tampak pada screenshot berakhir dengan `2:03:15 2:09.34`. Parser menerima `2:09.34` sebagai 2 menit 9,34 detik, bukan 2 jam 9 menit 34 detik. Karena `2:03:15` lebih besar dari `2:09.34`, rentang ditolak sebelum downloader berjalan. Jika maksudnya dua jam lebih, format yang benar adalah `2:03:15 2:09:34`. Screenshot tidak memperlihatkan log kegagalan downloader yang mendahului pesan ini, jadi tidak ada bukti bahwa yt-dlp/FFmpeg menjadi sumber error awal.
- **Akar masalah yang dapat dipastikan:** jalur validasi/penanganan error `.clip` tetap memanggil `conn.sendMessage` tanpa menangani kondisi socket tertutup; `handler.js` lalu mencoba mengirim laporan dan fallback lagi, sehingga 428 menutupi pesan validasi atau error fitur yang sebenarnya.
- **Perbaikan:** `plugins/downloader/clip.js` memakai pengiriman balasan yang aman, memeriksa `conn.ws.readyState`, menangkap kegagalan notifikasi agar tidak menimpa error proses, serta menampilkan timestamp awal/akhir yang diparse dan contoh format `HH:MM:SS` ketika rentang tidak valid. `handler.js` melewati laporan WhatsApp jika socket sudah tertutup dan tidak mengulang fallback untuk 428/Connection Closed.
- **Tes regresi:** `tests/clip-policy.test.js` memeriksa petunjuk timestamp dan memastikan plugin/global error reporter tidak mengulang pengiriman pada socket tertutup. Tes `npm run test:clip` dan workflow CI harus tetap dijalankan.
- **Batasan:** patch ini memperbaiki validasi dan penanganan notifikasi pada socket mati; tidak menghidupkan ulang koneksi WhatsApp dan tidak membuktikan ekstraksi YouTube berhasil. Setelah socket reconnect, ulangi command dengan timestamp yang benar. Jika masih gagal, ambil log terminal dari `[CLIP:<job>]` sejak tahap pertama hingga error downloader.
- **Pelajaran untuk fitur lain:** HTTP 428 `Connection Closed` dari Baileys sering merupakan error sekunder saat bot membalas, bukan akar masalah fitur. Pisahkan error operasi utama dari error notifikasi; jangan retry pengiriman pesan melalui socket yang sudah tertutup.
## 2026-11-03 — Fix .update gagal membaca commit terbaru GitHub HTTP 403

- Gejala: .update di WhatsApp membatalkan update pada 'Membaca commit terbaru gagal: HTTP 403'. Limit GitHub REST API tanpa autentikasi atau penolakan server dapat menyebabkannya; screenshot tidak menunjukkan header pembeda.
- Perbaikan: token GitHub opsional dari ALVARETH_GITHUB_TOKEN/GITHUB_TOKEN; API membaca header retry-after dan x-ratelimit-reset. Apabila REST 403/429/5xx, fallback read-only Git ls-remote/ Git fetch/ Git diff di bare repository terisolasi untuk menemukan SHA terbaru dan daftar perubahan.
- Keamanan: tetap wajib memvalidasi ancestry SHA, baseline file, hash lokal, filter file protected. Tidak memakai git reset --hard, tidak mengubah checkout lokal, tidak menaruh token pada log, dan membersihkan temp.
- Bootstrap satu kali: karena updater lama sudah terblokir, pengguna perlu memasang versi terbaru plugins/owner/update.js lewat TokoPanel Files, restart, lalu .update lagi. State baseline update-state-v1.json wajib tetap ada.
- Pengujian: 4/4 tests/update-transport.test.js lulus pada workflow 41558270979 menggunakan Git repo dummy lokal, termasuk operasi rename/add/delete/modify; syntax juga lulus. Uji langsung TokoPanel masih diperlukan.

## 2026-11-03 — Fix YouTube anti-bot verification and Qbyte 502 on .clip

- **Evidence from live TokoPanel:** video `iKLqlb_oX60` repeatedly returned `Sign in to confirm you're not a bot` from yt-dlp for default and `web_safari` player clients. API Qbyte returned HTTP 502. These are access/provider failures, not MP4 encoding or available resolution. No amount of picking 1080p will succeed unless at least one provider can supply the actual stream.
- **Authentication:** added optional `YTDLP_COOKIES_FILE` absolute path or automatic detection of `/home/container/.alvareth-bot-data/youtube-cookies.txt` (working directory must be /home/container). Both metadata and video/audio yt-dlp processes receive `--cookies` pointing to a private file. Cookie files must be Netscape/Mozilla format and readable. Code never logs contents or exports cookies to WhatsApp/GitHub.
- **Security:** added `.alvareth-bot-data/`, `youtube-cookies.txt`, and `*.cookies.txt` to gitignore; instruct the owner to apply restricted permissions and keep session exports private. The owner must supply a legitimate session; the code cannot fabricate authentication or guarantee that YouTube will accept a server IP.
- **No redundant login requests:** classify verification errors and skip the remaining yt-dlp methods once access is denied, while still trying Qbyte. Metadata format inventory is cached for the current clip job and shared among the four yt-dlp strategies rather than downloaded four times.
- **Provider resilience:** Qbyte HTTP 502/503/504 receives one extra attempt after a brief delay. Permanent HTTP errors still fail without extra calls. The WhatsApp error for auth failures now tells the owner exactly which private server setting to check without exposing secrets.
- **Testing:** added real Node tests using a dummy Netscape cookie file, invalid/missing cookie paths, login error classification, rate-limit retry behavior, and inventory reuse. GitHub Actions regression and JavaScript syntax check are the source-level verification; live YouTube and WhatsApp download still require a configured, accepted session.

## 2026-11-03 — Hotfix 1080p terdeteksi tetapi file hasil tidak memiliki track video

- **Bukti pengguna:** TokoPanel mengiklankan 1920x1080/24 FPS melalui yt-dlp (format 616+140), namun saat memasuki tahap FFmpeg muncul `stream map 0:v:0 matches no streams`. Alhasil metode yang tampak berhasil berikutnya hanya menghasilkan 360p. Ini membuktikan metadata 1080p belum menjamin bahwa file 1080p benar-benar berhasil diunduh.
- **Perbaikan:** setiap strategi sekarang mencoba beberapa format/codec video HD secara berurutan. Setelah yt-dlp selesai, FFprobe wajib menemukan dimensi video yang setidaknya 90% dari resolusi format yang dijanjikan. File audio-only, klip yang turun resolusinya, dan hasil yang hampir seluruhnya hitam ditolak agar alternatif HD berikutnya dicoba.
- **Metode tambahan:** `yt-dlp-isolated-tracks` mengunduh ID video sendiri, memverifikasi track gambar lebih dahulu, lalu mengunduh/mengecek ID audio terpisah sebelum mux. Ini menghindari ketergantungan pada intermediate gabungan yang sebelumnya bisa tidak memuat video.
- **Kompatibilitas kontainer:** metode yt-dlp lain sekarang menggunakan MKV sebagai intermediate (untuk VP9/AV1 + audio lintas codec) sebelum encoding H.264 CRF18/AAC MP4. FFmpeg menggunakan pemetaan video/audio eksplisit.
- **Seleksi final:** lima kandidat metode dinilai berdasarkan resolusi, FPS, dan bitrate nyata. Hasil inferior segera dibersihkan dari disk untuk menjaga ruang sementara. Qbyte juga mencoba berbagai ID video dengan validasi sumber. Caption memberi peringatan jika sumber mengiklankan HD tetapi server hanya bisa memperoleh SD.
- **Risiko yang belum terselesaikan:** akses YouTube dapat membatasi stream 1080p berdasarkan profil/client/IP/PO Token. Tanpa akses ke sumber yang benar-benar dapat diunduh, bot tidak dapat memaksa 1080p. Semua retry tetap tanpa batas waktu aplikasi atas permintaan sebelumnya; sumber yang macet dapat menunggu tanpa akhir.
- **Pengujian:** unit/mocks menguji transisi metadata 1080p → audio-only → pilihan 1080p valid, metadata 1080p tetapi video nyata 360p, validasi penolakan audio-only, dan pemeriksaan format multi-metode. GitHub Actions sekarang memasang FFmpeg untuk menjalankan tes fixture media nyata. Uji live YouTube dan WhatsApp pada server pengguna belum dilakukan.

## 2026-11-03 — Periksa semua metode dan kirim kandidat .clip dengan kualitas tertinggi

- **Gejala/permintaan:** output .clip berhenti di 360p; pengguna meminta setiap metode memeriksa kualitas tertinggi yang tersedia dan memilih metode terbaik.
- **Akar kelemahan alur lama:** tiga strategi yt-dlp memakai selector generik dan pipeline berhenti pada metode pertama yang berhasil. Qbyte hanya dicoba jika seluruh strategi yt-dlp gagal, sehingga format lebih tinggi dari provider lain tidak pernah dibandingkan.
- **Inventaris per metode:** setiap strategi yt-dlp menjalankan --dump-single-json, membaca semua format video/audio, dan memilih format ID video berdasarkan jumlah piksel, tinggi/lebar, FPS, bitrate, lalu ukuran. Audio terbaik dipilih terpisah jika video tidak membawa audio. Perintah download menggunakan format ID yang dipilih dan mencatat format aktual sebelum download. Qbyte mengurutkan inventarisnya sendiri dengan metrik yang sama.
- **Profil YouTube:** probe memeriksa profil default dan web_safari HLS. Jika YTDLP_POT_PROVIDER_URL tersedia, probe juga mencoba mweb melalui plugin bgutil PO Token Provider. Profil terbaik dipakai kembali pada perintah download. --remote-components ejs:github diaktifkan agar solver JavaScript eksternal tersedia; bila komponen GitHub gagal, probe/download mencoba fallback tanpa komponen remote.
- **Pemilihan metode:** semua empat metode dijalankan berurutan (3 strategi yt-dlp + Qbyte), setiap output lolos pemeriksaan FFprobe dan blackdetect, lalu kandidat dibandingkan berdasarkan luas piksel aktual, tinggi, lebar, FPS, bitrate, dan ukuran. Hanya kandidat terbaik dipertahankan untuk dikirim; direktori kandidat lain dibersihkan. Dampak: proses lebih lambat dan memakai bandwidth/ruang sementara lebih besar, tetapi tidak lagi berhenti pada hasil 360p pertama yang berhasil.
- **Batas penting:** bot tidak meng-upscale resolusi sumber. Jika seluruh inventaris dari profil/provider hanya menunjukkan 360p, YouTube mungkin memang hanya menyajikan 360p ke server atau membutuhkan PO Token. YTDLP_POT_PROVIDER_URL hanya bekerja jika plugin bgutil dan server provider telah dipasang/berjalan; server provider harus tetap di localhost/jaringan privat.
- **Tes:** regresi .clip dan pemeriksaan sintaks diperbarui untuk memeriksa format inventory, profil alternatif, pemilihan kandidat, dan fallback EJS. Uji jaringan YouTube serta upload WhatsApp langsung di TokoPanel belum dilakukan.

## 2026-11-02 — Perbaiki .clip yang terkirim sebagai layar hitam dengan audio saja

- **Gejala:** file MP4 yang dikirim terlihat seperti video, tetapi gambar hitam dan hanya musik/audio terdengar. Pemeriksaan lama hanya memeriksa signature/container MIME video; file tanpa stream video yang valid masih berpotensi lolos.
- **Akar masalah yang ditutup:** pemilih format Qbyte menerima format tanpa dimensi video selama codec video tidak bertuliskan none; pengunduh menerima file bertipe audio maupun video untuk label stream mana pun; pemeriksaan hasil klip tidak menolak ffprobe yang tidak menemukan video stream. Akibatnya stream audio/MP4 audio-only berpotensi lolos ke proses dan WhatsApp.
- **Validasi sumber:** pilihan video Qbyte sekarang wajib mempunyai tinggi/resolusi positif dan codec video bukan none; pilihan audio wajib mempunyai codec audio yang valid. Setelah file sumber diunduh, ffprobe memastikan label video benar-benar memiliki track video dan label audio benar-benar memiliki track audio.
- **Validasi hasil:** setiap klip wajib memiliki track video dengan dimensi yang valid. FFmpeg blackdetect memeriksa seluruh hasil dan menolak stream yang hampir seluruh durasi klipnya hitam (ambang 90%, dengan toleransi untuk intro/outro gelap). Jika satu metode menghasilkan audio-only atau gambar hampir seluruhnya hitam, metode tersebut gagal dan pipeline mencoba metode berikutnya; hasil tersebut tidak dikirim ke WhatsApp.
- **Kualitas:** tiga strategi yt-dlp memilih bestvideo+bestaudio/best dan memaksa urutan kualitas res,fps,br agar resolusi, FPS, dan bitrate diprioritaskan. Dokumentasi yt-dlp menjelaskan bahwa sort field disusun menurun dan --format-sort-force mengesampingkan prioritas hasvid/ie_pref saat memakai urutan custom. Jalur Qbyte memilih resolusi tertinggi, FPS tertinggi, bitrate tertinggi, lalu preferensi MP4. Jalur MP4 menggunakan H.264 CRF 18 dan AAC 192 kbps; caption menampilkan resolusi dan FPS hasil sebenarnya.
- **Pengiriman:** video MP4 akhir memiliki pemetaan track eksplisit 0:v:0 dan track audio opsional 0:a:0?, dengan yuv420p dan +faststart untuk kompatibilitas pemutar. Metode pertama kini juga melakukan finalisasi FFmpeg eksplisit alih-alih mengandalkan recode default yt-dlp.
- **Tes:** tests/clip-policy.test.js menambahkan pemeriksaan format video/audio, penolakan output tanpa video, deteksi klip hampir seluruhnya hitam, pemilihan kualitas tertinggi, dan pemetaan track. GitHub Actions regresi .clip lulus 14/14 (run 41491185274). Pemeriksaan sintaks JavaScript dijalankan pada run 41491185253. Filter blackdetect juga dicoba lokal dengan fixture sintetis video hitam+audio dan video berwarna; video hitam terdeteksi, video berwarna tidak ditandai.
- **Belum diverifikasi:** URL YouTube yang memicu masalah dan pengiriman WhatsApp live belum diuji dari TokoPanel. Setelah deploy/restart, uji ulang klip yang sama; jika gagal validasi, terminal akan menunjukkan metode dan alasan penolakannya, bukan mengirim layar hitam.

## 2026-11-02 — Hapus batas internal ukuran, durasi, dan timeout pada .clip

- **Permintaan/gejala:** log TokoPanel menunjukkan API Qbyte berhenti pada batas sumber 256 MB dan fallback yt-dlp berhenti setelah tidak ada output 90 detik. Pengguna meminta batas ukuran dan batas waktu internal dihapus.
- **Perubahan ukuran/durasi:** hapus batas sumber 256 MB video dan 96 MB audio dengan melewatkan `Infinity` ke stream Qbyte; hapus batas hasil akhir 45 MB dan opsi transcode paksa yang hanya bertujuan memenuhi batas tersebut; hapus batas durasi 15 menit dari plugin dan `downloadYoutubeClip`. Parser timestamp tetap menerima format `HH:MM:SS` untuk klip panjang.
- **Perubahan timeout khusus .clip:** tiga pemanggilan yt-dlp kini memakai `timeoutMs=0` dan tanpa `idleTimeoutMs`; helper hanya membuat hard timer bila nilai timeout positif. FFmpeg clip menerima timeout 0 dan tidak membuat timer. Metadata Qbyte dan unduhan video/audio mengatur Axios `timeout: 0`. Pemeriksaan Python yt-dlp dan unduhan skrip/binary setup tidak memasang timer/AbortSignal saat dipanggil oleh .clip. Flag `--socket-timeout 45` di tiga strategi clip dihapus; pemanggilan downloader YouTube lain tetap memakai nilai default lama.
- **Pengiriman file:** video dialirkan dari path lokal agar file besar tidak dimuat utuh ke RAM. Bila WhatsApp menolak pengiriman sebagai video, bot mencoba mengirim path yang sama sebagai dokumen. Batas/penolakan WhatsApp, YouTube, API pihak ketiga, dan kapasitas disk/hosting tidak dapat dihapus oleh kode bot.
- **Konsekuensi penting:** tanpa idle/hard timeout, proses/provider yang benar-benar macet dapat menunggu selamanya dan tidak otomatis melanjutkan ke fallback berikutnya. File besar/potongan panjang juga dapat memenuhi disk atau ditolak platform. Folder sementara tetap dibersihkan setelah handler selesai.
- **Tes:** ditambahkan `tests/clip-policy.test.js` untuk durasi panjang, penghapusan cap ukuran, dan tidak adanya deadline aplikasi; package script `test:clip` menjalankan 10 tes total. GitHub Actions YouTube Clip regression **success** (10/10 tes; run [41487205018](https://github.com/lightevil96-svg/Alvareth-Bot/actions/runs/41487205018)); JavaScript syntax checks **success** (run [41487205155](https://github.com/lightevil96-svg/Alvareth-Bot/actions/runs/41487205155)). Percobaan CI awal gagal karena tes baru mengimpor plugin yang memuat Axios sementara workflow tidak menginstal dependency; tes diperbaiki agar mengekstrak fungsi parser dari source dan memeriksa kebijakan tanpa mengimpor runtime, kemudian seluruh tes lulus.
- **Belum diverifikasi:** unduhan YouTube jaringan, upload file besar ke WhatsApp, dan perilaku live TokoPanel belum diuji. Perubahan baru aktif setelah source terbaru di server diterapkan dan bot direstart.

## 2026-11-02 — Hotfix .clip tidak berubah selama 6 menit setelah pesan progres

- **Bukti baru:** dua screenshot TokoPanel menampilkan command .clip dari URL YouTube /live/ dengan status WhatsApp masih Persiapan/validasi, metode 1/4 dan waktu 0m 0d. Penggunaan CPU terpantau sekitar 764% pada screenshot kedua; penyebab CPU belum dapat dipastikan dari screenshot. Pesan awal dan edit pertama terbukti terkirim, tetapi tidak ada pembaruan selanjutnya.
- **Akar masalah source:** format waktu hanya dihitung ketika pesan status dikirim; progres chat dipicu sepenuhnya oleh callback downloader. Bila yt-dlp diam saat menyiapkan metadata, tidak ada timer heartbeat dan pesan menjadi stale. Selain itu, tiga strategi yt-dlp memiliki timeout 30 menit sehingga fallback baru terjadi sangat lambat jika proses tidak menghasilkan progres.
- **Perbaikan:** plugins/downloader/clip-progress.js mengaktifkan heartbeat 15 detik saat start, menghitung elapsed aktual, dan menampilkan 30+ detik tanpa data tanpa membuat angka persen. Timer dibersihkan saat selesai/gagal. lib/scrape/youtube.js menambah opsi runYtDlp runOptions untuk idle timeout dan killTree yang dipakai hanya pada tiga metode clip. Silence 90 detik mematikan process group yt-dlp/FFmpeg di Linux dan memberi error yang diteruskan ke fallback; hard timeout setiap yt-dlp clip kini 6 menit. FFmpeg lokal runClipFfmpeg dibatasi 2 thread agar lebih sesuai untuk panel hosting bersama. Tidak ada perubahan perilaku default runYtDlp untuk downloader lain.
- **Pengujian nyata sesi ini:** uji parser/eksekusi fungsi yang diambil dari source GitHub dengan stub subprocess membuktikan timeout idle 90 detik menolak Promise, memanggil kill (-pid), membersihkan timer, dan stdout/stderr persen tetap bekerja. Uji helper heartbeat dengan timer/clock buatan berhasil mengedit pesan setelah 45 detik tanpa data dan mematikan timer saat akhir. Ditambah dua tes permanen di tests/clip-progress.test.js (total 8 tes). Node npm run test:clip, GitHub Actions, unduhan YouTube jaringan, dan WhatsApp/TokoPanel live **belum** dijalankan/terkonfirmasi.
- **Deploy:** perlu sumber GitHub terbaru pada server dan restart proses. Stop/Start setelah memastikan update akan membatalkan job lama yang memakai kode sebelumnya; jangan menganggap perubahan GitHub langsung memperbaiki job yang sedang berjalan. Pantau log [CLIP:<job>] dan status heartbeat chat.

## 2026-11-02 — Perbaikan menyeluruh jalur cache dan konversi fitur .s
- **Temuan cache:** pesan media yang disimpan dengan `JSON.parse(JSON.stringify(message))` mengubah Buffer/Uint8Array (mediaKey, fileEncSha256, fileSha256, thumbnail) menjadi objek JSON biasa. Ini dapat membuat `conn.loadMessage()` mengembalikan kunci media yang tidak dapat dipakai Baileys saat reply self-chat.
- **Perbaikan cache:** tambahkan `cloneMessageForMediaCache()` yang menyalin Buffer, typed arrays, ArrayBuffer, array, dan object secara rekursif dengan referensi siklik aman. Hanya pesan media yang memakai clone binary-safe; cache non-media tetap memakai serialisasi lama. Downloader memprioritaskan upload asli dari cache sebelum quoted thumbnail dan memilih source dengan binary mediaKey.
- **Perbaikan konversi:** `plugins/sticker/sticker-engine.js` memproses foto/video lokal tanpa upload publik/API stiker eksternal. Foto dikompres bertahap hingga batas statis 100 KB; video/GIF dibuat WebP animasi hingga batas 500 KB, target kompresi diberi ruang untuk metadata EXIF. Deteksi animasi membaca chunk RIFF WebP (ANIM/ANMF), bukan pencarian string bebas. Video dibatasi 10 detik, input 25 MB, proses FFmpeg dibatasi waktu dan output.
- **Tes yang ditambahkan/diperkuat:** pengujian clone binary, prioritas media asli, ukuran stiker foto/animasi, EXIF, dan output animasi. `npm test` memasukkan test media serta engine. Pemeriksaan parsing V8 untuk file terkait lolos; pipeline Sharp lokal menghasilkan WebP statis 850 byte dan pipeline FFmpeg 10 detik menghasilkan WebP animasi 477.334 byte (80 frame, di bawah target 480 KB). Tes integrasi penuh Node/WhatsApp dan deployment TokoPanel belum diverifikasi.
- **Diagnostik:** plugin `.s` menulis `[STICKER] Media terdeteksi`, `[STICKER] GAGAL` dengan tahap, dan detail error. Jika server masih menampilkan pesan generik lama, source stiker di runtime belum diperbarui ke commit terbaru.
- **Batasan:** hasil bergantung pada FFmpeg/Sharp dan ketersediaan media WhatsApp; konten yang tidak ada di cache/payload harus dikirim ulang.

## 2026-11-02 — Perbaikan .clip tidak merespons WhatsApp + progres persen nyata

- **Gejala:** .clip terus mencatat operasi di console TokoPanel, tetapi chat WhatsApp tetap diam hingga pekerjaan selesai/gagal; user meminta indikator progres di chat.
- **Akar masalah:** plugin clip sebelumnya hanya memakai createTerminalProgressReporter dan menunggu downloadYoutubeClip selesai sebelum mencoba mengirim hasil. Metode runYtDlp juga hanya mem-parse progres dari stderr, padahal persentase yt-dlp sering dicetak ke stdout.
- **Perubahan terisolasi:** plugins/downloader/clip-progress.js menangani pesan status awal, update satu pesan dengan payload Baileys {text,edit:key}, pembatasan pembaruan 4 detik, fallback teks berkala maksimum 8 kali bila edit ditolak, pesan selesai/gagal, sanitasi URL. plugins/downloader/clip.js sekarang memanggil progress.start() sebelum download, meneruskan callback onProgress ke terminal dan chat, memberi tahap sebelum upload, mengirim video dari path file lokal (fallback Buffer) untuk mengurangi RAM, menampilkan error secara langsung tanpa metadata GitHub, serta cleanup dalam finally. lib/scrape/youtube.js memproses persentase dari stdout dan stderr dengan buffer per stream termasuk baris akhir.
- **Kejujuran progres:** angka dalam chat adalah persentase fase yang dilaporkan yt-dlp/FFmpeg/kompresi, bukan angka keseluruhan. Persentase upload WhatsApp tidak tersedia di fork ini: chat menunjukkan tahap upload tanpa angka sampai pengiriman berhasil. Status akhir menjadi 100% setelah sendMessage selesai.
- **Pengujian:** 12 pemeriksaan mock alur .clip lolos (balasan awal, persen, edit, fallback teks, fallback Buffer, pesan error, cleanup, tanpa preview) di JavaScript isolate. Parser asli runYtDlp diujikan terhadap stdout/stderr terfragmentasi dan mengembalikan 80, 37.2, 100. Tes permanen: tests/clip-progress.test.js (6 kasus), npm run test:clip, workflow .github/workflows/clip-regression.yml. Keberhasilan tes Node CI dan pengiriman live TokoPanel belum dikonfirmasi.
- **Tidak diubah:** sistem downloader lainnya, mode perintah, target kualitas sumber, metode fallback, batas 45 MB dan 15 menit, database/sesi WhatsApp.

## 2026-11-02 — Perbaikan stiker .s tidak mengenali media reply dan balasan membawa kartu GitHub
- **Gejala:** WhatsApp self-chat memperlihatkan user membalas gambar dengan .s, tetapi bot mengirim “Balas gambar atau video dengan command .s” disertai kartu GitHub.
- **Akar masalah:** plugin stiker hanya memeriksa m.quoted/q.mimetype dan mengunduh melalui q.download(), walaupun contextInfo.quotedMessage dapat menyimpan media atau hanya ringkasan gambar. lib/simple.js juga sebelumnya tidak menyimpan pesan media milik sendiri (fromMe) dalam cache, sehingga original media tidak bisa ditemukan saat user mereply gambar yang dikirim dari akun terhubung.
- **Perbaikan:** plugin stiker menggunakan resolveQuotedMediaInfo() dan downloadQuotedMedia() dengan fallback untuk media yang dikirim langsung. lib/simple.js menambahkan pencarian contextInfo.stanzaId, membaca media asli dari conn.loadMessage, dan menyimpan foto/video yang diterima dari akun sendiri dalam cache yang dibatasi jumlah pesan per chat. Gagal mendeteksi media dan gagal mengunduh media memberi pesan berbeda; balasan .s memakai teks biasa, tanpa metadata tautan GitHub. Durasi video 10 detik dan pembuat stiker lama tetap dipertahankan.
- **Tes:** parser V8 lolos setelah hanya melepas deklarasi import/export pada file yang diperiksa. Enam kasus pembacaan konteks dan pemulihan media dari cache dijalankan pada potongan fungsi helper yang diambil dari GitHub dan lulus. Ditambahkan enam pengujian Node tests/quoted-media.test.js ke npm test, namun Node test dan uji WhatsApp live belum dapat dijalankan dari lingkungan ini karena checkout GitHub tidak tersedia. Periksa log [STICKER] Deteksi media setelah update server.
- **Batasan:** data media yang tidak ada di payload WhatsApp maupun cache lokal tetap tidak dapat dipulihkan; kirim ulang foto/video setelah bot menggunakan kode terbaru bila perlu.

## 2026-11-02 — AutoDL belum merespons link Facebook yang dikirim owner dari TokoPanel
- **Gejala:** log TokoPanel menerima `Type Msg: Conversation` dan link `https://www.facebook.com/share/r/...` dari nomor WhatsApp yang sama dengan nomor bot, tetapi tidak ada respons unduhan.
- **Akar masalah terverifikasi di source:** `handler.js` memakai syarat `!m.fromMe`; semua pesan yang dikirim dari akun WhatsApp milik bot, termasuk pesan manual owner, memiliki `fromMe === true`. `plugins/anu/_autodl.js` juga memblokir URL dari `fromMe` selain TikTok. Link Facebook `/share/r/` sudah dikenali oleh parser URL baru, sehingga blokir `fromMe` adalah salah satu penyebab kuat. Ada kemungkinan kedua: source GitHub terbaru belum terpasang di runtime TokoPanel.
- **Perbaikan:** `lib/auto-download.js` mengenali pesan teks mandiri dari owner (`conversation` / `extendedTextMessage` tanpa quoted), menjaga cache maksimal 2.000 ID pesan bot 10 menit; `lib/simple.js` membungkus `sendMessage` secara transparan untuk menandai ID pesan keluaran, tidak memodifikasi payload/kartu tautan. `handler.js` menerima link mandiri dari akun sendiri kecuali ID berasal dari bot, lalu mengirim ke plugin asli sesuai prefix dan izin. Router lama tetap menghindari duplikasi lewat `m.autoDownload`.
- **Diagnostik:** banner saat modul dimuat `[AUTODL] Router 2026-11-02/self-link-fix aktif`. Saat link dideteksi menampilkan platform/plugin dan indikator pesan akun sendiri; saat link mandiri dilewatkan, menampilkan alasan tanpa URL privat/token.
- **Tes:** menambah kasus `https://www.facebook.com/share/r/18wxGC4Qm/`, pesan owner `Conversation`/`ExtendedText`, penolakan quote/media caption, dan pengecualian bot-sent ID termasuk variasi JID/LID dalam `tests/auto-download.test.js`. Belum bisa menjalankan Node `npm test`, GitHub CI, API eksternal, atau uji WhatsApp live dari sesi ini. Kesesuaian sumber di GitHub diverifikasi setelah commit; keberhasilan unduh tetap harus diuji di TokoPanel.
- **Deployment:** commit GitHub tidak otomatis mengubah server jika bukan Git checkout atau startup bukan `npm start`; lakukan update source di TokoPanel dan restart. Uptime panel belum membuktikan versi bot yang sedang aktif. Jangan menjalankan `git pull` di kolom Console Pterodactyl biasa karena bukan terminal shell.

## 2026-11-02 — AutoDL otomatis mengenali URL dan memanggil downloader yang sesuai
- **Permintaan:** setiap pengguna cukup mengirim link, bot langsung memilih dan menjalankan downloader untuk layanan tersebut, tanpa command, tanpa menghapus atau mengganti fitur downloader yang sudah tersedia.
- **Akar masalah:** sakelar `chat.autodl` sudah ada dan `plugins/anu/_autodl.js` sebenarnya telah merutekan sejumlah link dengan menulis ulang `m.text`, tetapi chat privat tidak otomatis aktif secara default untuk semua layanan, sebagian jenis link/format belum divalidasi ketat, dan penggabungan router baru dengan router legacy berpotensi menggandakan unduhan. Router baru menggunakan routing terpusat yang tidak mengubah `m.text`.
- **Perubahan:** menambahkan `lib/auto-download.js` (parser satu URL, allowlist host+path per platform, tidak menerima URL sembarang), memanggil plugin aslinya melalui jalur izin, registrasi, limit, dan error handler di `handler.js`. `m.text` tetap teks asli agar `plugin.all`/`plugin.before` tidak berubah; hanya parser command pada plugin target memakai teks sintetik. Chat pribadi default aktif, grup harus mengaktifkan `.enable autodl`. Pesan bot sendiri, multi-URL, pesan ber-command, dan tautan tidak didukung diabaikan.
- **Layanan:** TikTok, Instagram, Facebook, X/Twitter, YouTube video/Shorts, YouTube Music audio, Pinterest, Spotify track, SoundCloud track, CapCut, MediaFire, Sfile.co, dan root repository GitHub (kecuali repo bot sendiri). Perintah .clip tetap mensyaratkan waktu mulai/akhir; .ytmp3 untuk YouTube video biasa tetap tersedia manual.
- **Beban dan duplikasi:** cache ID pesan router utama 5 menit maksimal 500, dua unduhan otomatis paralel dan antrean maksimal delapan dengan timeout tiga menit. Pada `plugins/anu/_autodl.js`, ditambahkan guard `m.autoDownload` supaya tidak memulai router kedua, menolak pesan berisi banyak URL, dan menggunakan `findAutoDownloadPrefix()` untuk memproses prefix regex tanpa mengambil karakter tak terlihat yang salah. Routing khusus lama (termasuk TikTok polos dari akun bot) dipertahankan untuk pesan yang tidak diambil router utama. TikTok downloader baru memprioritaskan URL terdeteksi ketimbang quoted text.
- **File:** `lib/auto-download.js`, `handler.js`, `plugins/anu/_autodl.js`, `plugins/downloader/tiktok.js`, `tests/auto-download.test.js`, `package.json`, README.md, AI_CONTEXT.md, docs/AI_CHANGELOG.md. Tidak mengganti penyedia download, API, atau tautan konten pengguna.
- **Tes:** 33 pemeriksaan routing dan prefix berbasis JavaScript isolate internal lulus sebelum helper dibuat, tetapi memakai shim URL untuk lingkungan tersebut. `npm test` kini menjalankan `node --test tests/auto-download.test.js`; tes Node (termasuk regresi router legacy), CI, downloader eksternal, serta pengiriman WhatsApp live belum diverifikasi dari sesi ini. Perlu diuji dari VPS/Pterodactyl setelah pull dan restart.
- **Batasan:** short-link/provider dan unduhan media tetap mengikuti kemampuan plugin asli; login, geo-block, rate-limit, layanan mati, atau konten privat tetap dapat gagal. Hindari menambahkan fallback API yang belum diuji atau melakukan auto-download semua URL.

## 2026-11-02 — Hilangkan tautan GitHub dari balasan dan menu
- **Permintaan:** hapus hanya tautan GitHub Alvareth Bot yang muncul saat bot membalas, karena dilaporkan membuat pengiriman pesan berat atau error. Jangan menghapus link YouTube, hasil downloader, atau fitur lain.
- **Temuan:** `config.js` masih memberi `global.adReply` metadata `externalAdReply` dengan `sourceUrl` GitHub; `plugins/main/menu.js` menyisipkan URL GitHub pada offer dan tombol Channel, serta menjadikan pesan menu gaya 2/detail sebagai link preview dengan thumbnail beresolusi tinggi. Helper `conn.reply` di `lib/simple.js` sudah tidak memaksakan preview global.
- **Perbaikan:** biarkan identitas bot dan URL repositori untuk permintaan eksplisit tetap ada; netralkan `global.adReply` menjadi `{ contextInfo: {} }`, atur `global.linkch` dari `WHATSAPP_CHANNEL_URL` agar fitur kanal tidak salah mengarah ke GitHub; hilangkan offer/tombol GitHub dari menu, dan kirim gambar menu dengan caption normal tanpa metadata link preview maupun proses upscaling thumbnail. Tautan lain tidak diubah; opsi menu dan audio tetap ada.
- **Tes:** pemeriksaan tekstual pada hasil perubahan: tidak ada referensi GitHub maupun `linkPreview` dalam menu, payload reply dan label fitur utama tetap ada. Belum menjalankan `npm test`, CI, atau uji pengiriman WhatsApp langsung pada VPS; semuanya perlu diverifikasi setelah pembaruan.
- **Regresi yang dihindari:** jangan mengaktifkan lagi `externalAdReply` global atau menyisipkan tautan GitHub pada setiap balasan. Link eksternal hanya ditampilkan bila relevan dengan perintah eksplisit.

## 2026-11-02 — Perbaikan deteksi media reply lintas plugin dan regresi .sw
- **Gejala:** pengguna me-reply media lalu mengirim .sw, tetapi bot menampilkan panduan umum seolah tidak ada foto/video yang direply.
- **Akar masalah:** plugins/owner/sw.js hanya mengklasifikasikan media melalui m.quoted.mimetype. Field MIME dapat tidak tersedia/terbawa pada hasil serialisasi untuk bentuk quoted tertentu, padahal payload Baileys masih menyimpan tipe pesan seperti imageMessage atau videoMessage. Jalur ini juga bergantung sepenuhnya pada m.quoted.download(), sehingga rentan ketika serializer tidak membangun objek quote secara utuh. Reply yang dibungkus ephemeralMessage/view-once perlu dibaca setelah wrapper dibuka.
- **Perbaikan bersama:** lib/simple.js menambahkan getQuotedMediaInfo(messageInfo) untuk mencari contextInfo.quotedMessage pada payload mentah/serialized, membuka wrapper pesan, lalu mengklasifikasikan media dari key tipe pesan dan mengambil MIME/caption bila tersedia. downloadQuotedMedia(messageInfo, conn) mencoba method serializer, kemudian conn.downloadM dengan node media asli sebagai fallback. Ini menjadi jalur bersama untuk fitur/plugin lain, bukan solusi khusus .sw.
- **Perbaikan plugin:** plugins/owner/sw.js menggunakan helper bersama; foto/video dikenali berdasarkan tipe pesan maupun MIME. Jika MIME hilang, video tetap masuk ke jalur video. Caption foto yang berisi sw URL mulai akhir juga dapat diparse sehingga pengguna tidak perlu mengirim ulang rentang yang sudah ada pada caption. Log diagnostik hanya mencatat tipe/MIME dan keberadaan payload, bukan isi media.
- **Dokumentasi pencegahan:** AGENTS.md dan bagian gotcha di AI_CONTEXT.md sekarang mewajibkan plugin memakai getQuotedMediaInfo()/downloadQuotedMedia(), bukan pemeriksaan m.quoted.mimetype saja. Tambahkan kasus baru ke helper bersama bila ada format wrapper lain; jangan membuat parser reply media lokal di tiap plugin.
- **Tes:** package.json memasukkan lib/simple.js serta plugins/owner/sw.js ke npm test; workflow CI memeriksa sintaks seluruh file JavaScript. Pada saat catatan dibuat, workflow untuk commit akhir sedang menunggu/berjalan. Belum dilakukan uji reply foto/video live di WhatsApp atau unduhan media pada server.
- **Batasan:** helper membaca struktur yang tersedia pada payload Baileys; jika WhatsApp tidak menyertakan contextInfo.quotedMessage sama sekali, plugin tidak dapat memulihkan media reply. Periksa log [SW] Reply media terdeteksi untuk membedakan payload quote hilang, tipe pesan tidak dikenal, dan kegagalan download.
- **Pelajaran regresi:** untuk fitur berbasis reply, cek dahulu m.rawMessage.message, m.quoted, m.quoted.mtype, m.quoted.mediaType, dan contextInfo.quotedMessage; klasifikasi berdasarkan tipe media, bukan MIME saja. Uji setidaknya foto/video biasa, media bercaption, view-once, ephemeral, dan pesan self-chat sebelum menyimpulkan bahwa Baileys tidak menerima reply.
## 2026-11-02 — Fitur `.sw` untuk unggah WhatsApp Status
- **Permintaan:** reply video dengan `.sw` untuk langsung mengunggahnya ke Status; reply foto dengan `.sw`, lalu gunakan `.sw URL_YOUTUBE waktu_mulai waktu_akhir` untuk menambahkan potongan musik.
- **Implementasi:** menambahkan `plugins/owner/sw.js` (owner-only). Video reply dikirim ke `status@broadcast`. Foto disimpan sementara per chat + pengirim (TTL 10 menit), lalu audio YouTube dicoba melalui yt-dlp dan fallback provider yang sudah ada; FFmpeg menggabungkan foto menjadi MP4 dengan bagian audio yang diminta. Status dikirim menggunakan `statusJidList` dari kontak pribadi yang tersedia di `conn.chats`, tanpa mengikutkan grup atau JID akun sendiri.
- **Validasi/pembersihan:** menerima URL YouTube, memvalidasi timestamp dan urutannya, membatasi durasi musik/video Status hingga 90 detik, membatasi ukuran media, memeriksa durasi video bila ffprobe tersedia, dan membersihkan direktori sementara setelah pengiriman atau kegagalan. Tidak menambah dependency.
- **Tes:** `package.json` diperbarui agar `npm test` menyertakan syntax check plugin baru. Pemeriksaan sintaks lokal, CI, pengunduhan YouTube, FFmpeg, serta upload Status WhatsApp live belum dijalankan pada saat commit ini.
- **Batasan:** daftar penerima mengikuti kontak pribadi yang telah dimuat di cache `conn.chats`; cakupannya bergantung pada sinkronisasi/cache Baileys. Foto dengan musik diposting sebagai video MP4 statis, bukan fitur musik-native pada editor Status WhatsApp. Fitur perlu diuji di sesi WhatsApp/TokoPanel aktif.
- **Pelajaran:** untuk status broadcast, `statusJidList` harus diisi dengan JID audiens; jangan mengirim seluruh entri cache karena dapat mencakup grup/channel. Simpan foto pending dengan key pengirim + chat agar tidak tertukar antar pengguna.

## 2026-11-02 — Progres YouTube Clip khusus terminal
- **Permintaan:** indikator proses `.clip` harus terlihat real-time di terminal server saja, bukan sebagai pesan progres di chat WhatsApp.
- **Akar penyebab:** reporter terminal sudah tersedia, tetapi plugin masih mengirim pesan status berjalan ke WhatsApp. Reporter juga mempertahankan persentase lintas fase sehingga progres transfer/encoder berikutnya dapat terlihat tidak bergerak ketika persentasenya kembali ke angka kecil.
- **Perubahan:** `plugins/downloader/clip.js` menghapus pesan status sementara di WhatsApp; chat tetap menerima hasil akhir atau pesan kegagalan. Reporter terminal per-ID job kini mereset progress bar saat sumber transfer/encoder berubah, persentase kembali turun (misalnya unduhan video lalu audio), atau metode fallback/percobaan kompresi baru dimulai. Log tetap memuat tahap, persentase nyata, kecepatan/ETA bila tersedia, fallback, validasi, pengiriman, dan cleanup. Lama pengiriman WhatsApp dicatat, tetapi persentase upload tidak dibuat-buat karena `sendMessage` pada jalur ini tidak menyediakan callback progres. Matcher transfer mencari tag `[download]`/`[ffmpeg]` di mana pun dalam baris, sehingga awalan `[qbyte]` pada log fallback tetap masuk ke progress bar yang benar.
- **Tes:** parsing V8 terhadap `lib/scrape/youtube.js` dan `plugins/downloader/clip.js` (import/export ESM dilepas untuk pemeriksaan) lulus; GitHub Actions job `syntax` lulus pada commit `072200442c0556ce27c365e228dc0e87751682f2` (run `41437723061`). `npm test` tidak dapat dijalankan dari checkout lokal karena container gagal mengakses GitHub saat clone. Belum dilakukan unduhan YouTube atau pengiriman WhatsApp live dari Pterodactyl.
- **Belum diverifikasi:** tampilan log aktual pada terminal hosting serta durasi upload media pada jaringan server.
- **Pelajaran regresi:** setiap fase transfer yang dimulai ulang harus mendapatkan progress bar baru; jangan mengirim pembaruan progres berulang ke chat bila pengguna meminta pemantauan terminal saja.

## 2026-11-02 — Indikator progres YouTube Clip khusus terminal
- **Permintaan:** tampilkan apa yang sedang dilakukan .clip dan progres sebenarnya secara real-time, tetapi indikator hanya terlihat di terminal/log Pterodactyl, bukan sebagai pesan progres di chat WhatsApp.
- **Akar penyebab:** plugin sebelumnya hanya mencatat callback progres pada batas 0%/100%; runYtDlp() juga memakai pola pemisah baris dan regex [download] yang terlalu ter-escape sehingga baris progres yt-dlp tidak terurai dengan benar. Runner FFmpeg belum meneruskan informasi out_time/speed, dan fallback Qbyte belum melaporkan kemajuan transfer stream.
- **Perubahan:** setiap permintaan memperoleh ID job unik agar log beberapa pengguna dapat dibedakan. Plugin .clip sekarang menampilkan tahap validasi, nama metode/fallback, bar progres transfer, kualitas dan ukuran hasil, proses kirim, durasi total, serta cleanup hanya lewat console.log/console.error. Parser yt-dlp diperbaiki untuk memisahkan CR/LF dan membaca persentase [download]. Runner FFmpeg menggunakan -progress pipe:1 -nostats ketika callback tersedia, lalu menghitung persentase berdasarkan out_time dan menampilkan speed. Unduhan stream Qbyte mencatat bytes diterima, persentase jika Content-Length tersedia, kecepatan rata-rata, dan ETA. Output progres di-throttle agar tidak membanjiri terminal. Pesan awal, hasil akhir, dan pengiriman video WhatsApp tetap dipertahankan; tidak ada pembaruan progres real-time yang dikirim ke chat.
- **Batasan:** conn.sendMessage() pada jalur pengiriman media tidak menyediakan callback persentase upload yang digunakan fitur ini, sehingga terminal hanya menampilkan bahwa pengiriman dimulai dan mencatat sukses/gagal setelah hasilnya kembali. Untuk transfer provider tanpa Content-Length, terminal menampilkan bytes diterima dan kecepatan tanpa mengarang persentase/ETA.
- **Tes:** pemeriksaan sintaks JavaScript pada lib/scrape/youtube.js dan plugins/downloader/clip.js melalui parser V8 berhasil setelah import/export ESM dilepas untuk keperluan parsing. npm test tidak dapat dijalankan dari checkout lokal karena koneksi container ke GitHub gagal; workflow GitHub Actions perlu dipantau. Unduhan YouTube, encoding FFmpeg, dan pengiriman media belum diuji langsung di Pterodactyl.
- **Commit kode berturut-turut:** 34f5913bd502b65435c41314032a52e1feeb00a2, bede572cb262702e4239dd233d675fbdfcfbe84a, 774e3d324d56eb44a2d26304884289a53f9dcba3, 28facd573818bc02be8a0281b52d7e2473930380, 31854be34e071f653d3b7b2cf75b815db315bb2d, 91dd8d5e86ac4cc8b6206d35989238e6dd800777.
## 2026-11-02 — Prioritas kualitas tertinggi dan optimasi batas WhatsApp untuk YouTube Clip
- **Permintaan:** pastikan `.clip` memilih kualitas setinggi mungkin, dengan keberhasilan pengunduhan/pengiriman tetap diprioritaskan; jangan membatasi semua metode ke 720p atau fallback API ke 480p.
- **Akar penyebab:** metode pertama dan kedua sebelumnya membatasi stream sampai 720p, metode API terakhir memilih tepat/dekat 480p, dan hasil yang melampaui 45 MB langsung membuat metode gagal walaupun masih dapat dikompresi agar bisa dikirim.
- **Perubahan:** jalur yt-dlp utama sekarang meminta kombinasi video+audio terbaik dan mengurutkan resolusi/FPS. Jalur YouTube Clipper juga memilih stream video/audio terbaik tanpa filter MP4 yang berpotensi menurunkan resolusi, lalu mengodekan output H.264/AAC. Jalur Clippy memilih MP4 terbaik yang tersedia tanpa batas 720p. API Qbyte memakai `pickBestVideo()` (resolusi, FPS, kontainer, bitrate), bukan target 480p. Setelah setiap metode berhasil menghasilkan video valid, helper `fitClipForWhatsApp()` mempertahankan file asli bila ukurannya ≤45 MB; bila lebih besar, helper menghitung anggaran bitrate dari durasi, memilih batas resolusi yang sesuai, lalu mencoba empat tingkat bitrate H.264/AAC sebelum metode dinyatakan gagal.
- **Urutan akhir:** (1) yt-dlp section + keyframe, (2) YouTube Clipper dengan source stream terbaik + FFmpeg, (3) YouTube Clippy/FFmpeg untuk stream MP4 terbaik, (4) Qbyte API dengan format video/audio terbaik + FFmpeg. Metode Qbyte tetap menjadi sumber ekstraksi berbeda, best-effort.
- **Batas kualitas:** bila sumber terbaik sudah ≤45 MB, file asli tidak di-encode ulang. Bila melebihi batas, kompresi dapat menurunkan bitrate/resolusi untuk menjaga ukuran dan kompatibilitas WhatsApp. Klip 15 menit yang harus muat ≤45 MB tidak mungkin selalu mempertahankan kualitas asli; tidak ada cara menjamin kualitas tertinggi sekaligus ukuran tetap tersebut.
- **Tes:** kedua file JavaScript akan diperiksa sintaksnya; workflow GitHub Actions `JavaScript syntax checks` harus dipantau. Belum ada uji unduhan YouTube live atau uji FFmpeg/WhatsApp di Pterodactyl.
- **Commit kode:** `lib/scrape/youtube.js` — `555d079ce4370a1a96bab826577248ef9078e814` (kualitas tertinggi + transcode adaptif), `b325759318574dd367adcfe0bebd5673cd0972db` (urutan fallback kualitas).
## 2026-11-02 — Fallback bertingkat YouTube Clip
- **Permintaan:** gunakan pendekatan dari seluruh proyek clipper yang ditinjau; jika sebuah metode gagal, lanjut otomatis ke metode berikutnya, dan kirim pesan error hanya setelah semuanya gagal.
- **Evaluasi sumber:** `yt-dlp` tetap mesin utama. `youtube-clippy` memberi varian pemotongan melalui FFmpeg external downloader. `GatewayCortex/youtube-clipper` memberi pola encode H.264/AAC terpisah setelah segment download. `YoutubeToMp4Console` memakai `yt-dlp --download-sections` dan FFmpeg yang sama dengan jalur utama, serta memerlukan runtime .NET bila dijalankan sebagai aplikasi; karena itu tidak dijalankan sebagai proses terpisah. Tiga proyek wrapper tersebut bukan tiga penyedia ekstraksi independen.
- **Perubahan:** `lib/scrape/youtube.js` kini mencoba berurutan (1) yt-dlp section + keyframe, (2) FFmpeg external downloader, (3) section download lalu transcode FFmpeg terpisah, dan (4) API Qbyte sebagai sumber alternatif diikuti FFmpeg trim. Hasil setiap metode divalidasi sebagai video, ukuran hasil maksimal diperiksa sebelum menerima metode, file sementara metode gagal dibersihkan, dan setiap kegagalan dicatat secara ringkas. Jalur Qbyte membatasi sumber video 256 MB dan audio 96 MB.
- **Command:** format `.clip URL waktu_mulai waktu_akhir` tetap sama; batas durasi 15 menit dan batas kirim WhatsApp 45 MB tetap dipertahankan. Pesan status menjelaskan fallback terakhir dapat mengunduh sumber sementara sebelum memotong. Jika semua strategi gagal, `.clip` mengirim ringkasan semua penyebab kegagalan; kegagalan kirim WhatsApp tidak salah dilaporkan sebagai kegagalan downloader.
- **Commit implementasi:** `lib/scrape/youtube.js` — `3d67f79b44e41c9cde0031c0f0453b7ccd393295`; `plugins/downloader/clip.js` — `d48c97e2f6236f3c6ed2b1ea623f843e7dd69710`.
- **Tes:** parser JavaScript V8 berhasil mem-parsing kedua file setelah deklarasi import/export ESM dilepas untuk pemeriksaan sintaks. Workflow GitHub Actions pemeriksaan sintaks masih berstatus queued saat verifikasi terakhir; `npm test` belum dijalankan. Belum ada unduhan YouTube live, tes endpoint Qbyte, FFmpeg pada Pterodactyl, atau pengiriman WhatsApp yang diverifikasi.
- **Batasan:** tiga metode pertama tetap bergantung pada yt-dlp/FFmpeg sehingga tidak mengatasi semua kegagalan ekstraksi YouTube. API Qbyte merupakan layanan eksternal best-effort; metode terakhir dapat mengunduh seluruh sumber sementara, dibatasi ukuran per stream, dan dapat gagal karena kuota/timeout/provider. Gunakan hanya video yang dimiliki atau diizinkan untuk diunduh dan dipotong.
## 2026-10-31 — YouTube Clip command
- **Permintaan:** command `.clip` untuk mengambil rentang waktu tertentu dari video YouTube panjang.
- **Akar pendekatan:** downloader sebelumnya hanya menyediakan unduhan video penuh; fitur potong langsung lebih efisien memakai `yt-dlp --download-sections` yang membutuhkan FFmpeg. Opsi `--force-keyframes-at-cuts` dipakai untuk hasil potong lebih presisi.
- **Perubahan:** menambahkan `downloadYoutubeClip()` ke `lib/scrape/youtube.js`, memakai runner yt-dlp resmi yang sudah tersedia, memilih video maksimal 720p, menggabungkan/recode MP4, validasi file hasil, batas durasi 15 menit, dan folder output unik. Menambahkan `plugins/downloader/clip.js` untuk format `.clip URL MM:SS HH:MM:SS`, pengiriman video WhatsApp, batas 45 MB, dan cleanup file sementara. Menambahkan syntax check helper dan plugin ke `npm test`.
- **Contoh:** `.clip https://youtu.be/VIDEO_ID 25:00 27:00`.
- **Tes:** belum menjalankan `npm test`, unduhan YouTube live, FFmpeg, atau pengiriman WhatsApp pada server bot. Kode sudah dikomit langsung ke `main`.
- **Batasan:** runtime harus memiliki FFmpeg/ffprobe yang bisa dijalankan. YouTube dapat membatasi atau mengubah akses; video privat/berbayar/terbatas usia atau region mungkin gagal. Maksimal durasi clip 15 menit dan file 45 MB. Pengguna bertanggung jawab memastikan hak untuk mengunduh dan membagikan video.

## 2026-10-31 — Fitur AI Video Generator gratis
- **Permintaan:** menambahkan fitur generate video pada Alvareth Bot dengan sumber yang dapat digunakan gratis.
- **Pilihan sumber:** FreeTheAI Gateway; dokumentasinya menyediakan endpoint video task POST /v1/videos, polling GET /v1/videos/{id}, dan download MP4. Dokumentasi menyebut model gratis memakai ID fta/<provider>/<model>.
- **Perubahan:** menambahkan plugins/ai/aivideo.js dengan command .aivideo, .text2video, .img2video, dan .aivideomodels untuk menampilkan kandidat ID model video gratis; mendukung prompt teks dan foto yang direply, polling task sampai selesai, timeout 15 menit, validasi MIME/ukuran output, pesan error untuk kuota/akses, serta hanya mengizinkan model berawalan fta/ agar konfigurasi tidak tanpa sengaja memilih rute berbayar. Menambahkan FREETHEAI_API_KEY dan FREETHEAI_VIDEO_MODEL ke .env.example, serta syntax check ke npm test.
- **Tes:** belum menjalankan npm test atau uji API/WhatsApp langsung dari runtime bot. Perubahan kode sudah dikomit ke main.
- **Batasan:** harus mengisi API key dan ID model gratis yang benar-benar mendukung video. FreeTheAI mensyaratkan email terverifikasi dan daily check-in untuk model gratis; kuota, antrean, dukungan durasi/ukuran, dan ketersediaan model mengikuti provider. Tidak ada klaim unlimited atau jaminan output berhasil sebelum uji live.

## 2026-10-30 — Laporan error kompatibel dengan WhatsApp lama
- **Gejala:** setelah `.toreal` gagal, WhatsApp menampilkan pesan bertipe Buttons yang menyatakan versi klien tidak mendukungnya; detail penyebab API tidak sampai ke pengguna.
- **Akar penyebab:** `sendErrorReport()` mengirim native-flow `cta_copy` tanpa fallback bila pengiriman diterima server tetapi klien WhatsApp tidak mampu merendernya.
- **Perubahan:** `handler.js` kini selalu mengirim laporan teks biasa berisi plugin, command, jenis/pesan error, dan cuplikan stack yang sudah disamarkan. Jika pengiriman dengan quoted message gagal, dicoba sekali lagi tanpa quote.
- **Tes:** perubahan ditulis ke branch `main`; belum menjalankan `npm test` atau uji WhatsApp/TokoPanel.
- **Belum diverifikasi:** penyebab utama kegagalan API `.toreal` belum terlihat karena laporan error sebelumnya tidak kompatibel; perlu satu kali tes setelah restart dan kirim teks log yang diterima.
- **Pelajaran regresi:** diagnostik kritis harus memakai teks biasa sebagai format dasar; tombol interaktif hanya boleh menjadi peningkatan opsional, bukan satu-satunya jalur laporan.

## 2026-10-30 — Memperbaiki request API AI Image Converter yang menggantung
- **Gejala:** log mencapai tahap API setelah upload, tetapi tidak ada API_RESPONSE, hasil gambar, atau error yang terlihat.
- **Akar masalah yang diperbaiki:** plugin memakai opsi timeout pada node-fetch v3, padahal timeout harus dikendalikan melalui AbortSignal; request dapat menunggu tanpa batas dan tidak menghasilkan pesan kegagalan yang jelas.
- **Perubahan:** menambahkan fetchWithTimeout berbasis AbortController dengan timer yang dibersihkan; menerapkannya pada request konversi dan download URL hasil; mencatat durasi request, HTTP status, dan content-type; mendukung respons gambar biner, JSON berisi URL, serta URL teks; menampilkan cuplikan error bila format respons tidak dikenal.
- **Tes:** perubahan tersimpan di main. Pemeriksaan npm test dan uji API/WhatsApp langsung belum dijalankan dari TokoPanel.
- **Verifikasi berikutnya:** restart, coba .toreal, lalu baca log API_RESPONSE atau pesan timeout/error baru untuk membedakan API lambat, API gagal, dan format respons yang berbeda.
- **Referensi:** commit 125ce0067cd3332541b47637e1d64aee14a61fa1.

## 2026-10-30 — Perbaikan deteksi foto yang direply pada AI Image Converter
- **Gejala:** setelah plugin berhasil dimuat, command seperti .toreal tetap mengirim panduan penggunaan seolah-olah pengguna belum membalas foto.
- **Akar masalah:** deteksi media hanya mengandalkan properti hasil serialisasi m.quoted; pada sebagian payload/fork Baileys, metadata media kutipan tidak terbaca melalui jalur tersebut.
- **Perubahan:** ambil contextInfo.quotedMessage langsung dari m.rawMessage.message (dengan traversal wrapper WhatsApp), ekstrak imageMessage, validasi MIME, lalu unduh melalui conn.downloadM(imageMessage, 'image') sebagai fallback bila q.download() gagal/tidak menghasilkan buffer. Semua command dalam plugin image bersama memperoleh perbaikan yang sama.
- **Tes:** perubahan sudah dikomit ke main; pengujian syntax/runtime dan konversi live belum dijalankan dari TokoPanel.
- **Langkah verifikasi:** restart bot, reply foto dengan .toreal; log yang diharapkan berurutan [IMAGE:.toreal] START, DOWNLOAD, VALIDATE, UPLOAD, API, SEND, SUCCESS.
- **Referensi:** commit 39c4cd3d3fb9931afbaa966166ddd670c97558ec.

## 2026-10-30 — Memperbaiki plugin image gagal dimuat karena regex URL
- **Permintaan/gejala:** bot tersambung ke WhatsApp, tetapi command image seperti `.toreal` tidak merespons; log TokoPanel menunjukkan `Gagal memuat plugin 'image/tohitam.js': SyntaxError: Invalid regular expression flags`.
- **Akar penyebab:** dua regex literal validasi URL pada `plugins/image/tohitam.js` memiliki escape slash berlebih sehingga parser JavaScript membaca bagian setelah regex sebagai flag yang tidak valid. Karena seluruh command image didaftarkan melalui plugin bersama ini, satu SyntaxError menonaktifkan semua command dalam daftar tersebut.
- **Perubahan:** mengganti kedua regex URL dengan helper `isHttpUrl()` berbasis `URL` API; memperbaiki escape newline pada pesan bantuan; menambahkan pemeriksaan sintaks `plugins/image/tohitam.js` ke `npm test`.
- **Tes:** perubahan kode dan konfigurasi test tersimpan di `main`; pemeriksaan runtime WhatsApp/TokoPanel dan hasil `npm test` belum dijalankan dari lingkungan ini.
- **Belum diverifikasi:** apakah plugin berhasil dimuat setelah restart, apakah media reply dapat diunduh, serta apakah layanan upload Uguu dan API konversi FAA dapat diakses dari hosting.
- **Pelajaran regresi:** hindari escape slash berlapis pada regex literal yang ditulis melalui generator; gunakan `URL` API untuk validasi URL dan pastikan plugin bersama memiliki syntax check eksplisit.
- **Referensi:** commit kode `bb186ed103af44fd491f442a0bb84b2f2aa3a5d8`.

# AI Change Log — Alvareth Bot

## 2026-10-30 — Diagnostik command image yang tidak masuk ke plugin
- Screenshot runtime menunjukkan bot tersambung dan menerima teks `.toreal`, tetapi tidak ada log `[IMAGE]`; berarti proses belum terbukti mencapai handler plugin image.
- Menambahkan trace terbatas untuk command image konversi (`.toreal`, `.tohitam`, `.tochibi`, `.toghibli`) yang mencatat teks masuk, chat/sender, status fromMe/owner, prefix aktif, jumlah plugin, serta plugin kandidat yang command-nya cocok beserta status disabled/tipe fungsi.
- Tujuan trace: membedakan kegagalan parsing pesan, prefix matcher, plugin belum terdaftar/disabled, dan kegagalan setelah plugin dimulai. Tidak mencatat isi gambar atau kredensial.
- **Belum diuji live:** perlu satu percobaan setelah restart untuk mendapatkan baris `[COMMAND TRACE]`; jangan menyimpulkan perbaikan berhasil sebelum log `[IMAGE] ▶ Mulai` muncul.

## 2026-10-30 — Perbaikan router prefix command (termasuk kategori image)
- **Gejala:** setelah pengguna mengirim `.toreal` sebagai balasan foto di chat pribadi, bot tidak merespons dan log lifecycle `[IMAGE]` tidak muncul.
- **Akar penyebab yang ditemukan:** router command memanggil `RegExp.exec()` pada objek prefix yang dipakai bersama semua plugin, lalu memilih kandidat pertama hanya karena objek regex-nya ada—bukan karena prefix benar-benar cocok. Regex dengan flag global/sticky dapat mempertahankan `lastIndex` dan menyebabkan pencocokan command tidak konsisten; kondisi pemilihan kandidat juga tidak memverifikasi hasil match.
- **Perubahan:** `handler.js` sekarang mengkloning regex prefix untuk setiap pemeriksaan, menghapus flag stateful `g/y`, dan memilih hanya hasil yang benar-benar cocok. Ini memperbaiki routing command lintas kategori, bukan hanya `.toreal`.
- **Tes:** perubahan dikomit ke `main`; syntax check dan pengujian live WhatsApp/TokoPanel belum dijalankan dari lingkungan ini.
- **Belum diverifikasi:** apakah setelah command berhasil masuk ke plugin, unduhan gambar reply dan API konversi berhasil pada runtime TokoPanel; apakah kartu tautan GitHub yang pernah terlihat berasal dari payload menu atau konteks pesan lain.
- **Pelajaran regresi:** pengujian router harus mencakup banyak plugin yang berbagi regex prefix, regex berflag `g/y`, command dari chat pribadi/self-chat, dan command yang membalas media.

## 2026-10-30 — Indikator terminal kategori image
- **Perubahan:** `handler.js` sekarang mendeteksi plugin bertag `image` dan mencatat awal proses, handler yang sedang berjalan, status selesai/gagal, command/plugin, identitas pengirim yang disamarkan ke nomor lokal, dan durasi.
- **Tahap detail:** `plugins/image/tohitam.js` mencatat download gambar, validasi, upload, pemanggilan API AI, status HTTP, download hasil, pengiriman WhatsApp, dan total waktu proses.
- **Tujuan:** membedakan bot yang sedang bekerja dari proses yang berhenti/gagal, serta menunjukkan tahap terakhir sebelum error.
- **Batasan:** plugin image lain saat ini mendapat indikator lifecycle umum dari handler; rincian tahap internal tambahan baru dipasang di AI Image Converter. Log terminal tidak dapat membuktikan proses API eksternal masih aktif jika request sedang menunggu respons; timeout/error tetap menjadi indikator akhir.
- **Tes:** kode sudah disimpan ke `main`; pemeriksaan sintaks dan pengujian live TokoPanel/WhatsApp belum terkonfirmasi.
- **Tautan GitHub:** audit kode menemukan kebijakan preview terpusat di `lib/simple.js` saat ini membiarkan `conn.sendMessage` native dan tidak menyisipkan preview global. Karena itu jangan mengubahnya secara global; perlu uji ulang pada chat untuk memastikan sumber kartu GitHub di screenshot, lalu matikan hanya pada jalur pesan kategori image jika masih muncul.

## 2026-10-30 — AI Image Converter gagal mengenali gambar reply
- **Gejala dari screenshot:** perintah `.toreal` menerima pesan reply dan mengirim status proses, tetapi tidak menghasilkan gambar; bot justru menampilkan daftar command AI Image Converter.
- **Akar penyebab paling mungkin dari kode:** `plugins/image/tohitam.js` hanya memeriksa `q.mimetype` dan `q.msg.mimetype`. Pada beberapa struktur pesan/quoted wrapper Baileys, MIME gambar berada di nested `imageMessage`, sehingga foto yang sebenarnya valid salah dianggap bukan gambar dan handler mengirim menu bantuan. Catch lama juga membuang error asli sehingga penyebab API/upload tidak terlihat.
- **Perubahan:** deteksi gambar sekarang menelusuri wrapper ephemeral/view-once/quoted dan payload nested; signature file divalidasi dengan `file-type`; upload, API HTTP/JSON, dan hasil gambar diperiksa; timeout serta batas ukuran diterapkan. Error tidak lagi ditelan, tetapi dilempar ke handler utama agar laporan tombol Salin Log Error dapat dikirim.
- **Tes:** perubahan kode dan dokumentasi tersimpan di `main`; pemeriksaan sintaks GitHub Actions serta uji WhatsApp/TokoPanel belum terkonfirmasi pada saat pencatatan.
- **Belum diverifikasi:** struktur pesan aktual dari screenshot, ketersediaan API `api-faa.my.id`, layanan upload Uguu, dan keberhasilan tombol salin log pada klien WhatsApp.
- **Pelajaran regresi:** jangan menentukan jenis media reply hanya dari satu properti serializer; cek nested payload dan signature file, serta jangan menelan exception pada plugin.

## 2026-10-30 — Tombol salin log untuk error lintas fitur
- **Permintaan/gejala:** pengguna ingin setiap fitur yang mengalami error menampilkan pesan dengan tombol untuk menyalin log agar mudah dikirim untuk diagnosis.
- **Akar penyebab:** penanganan error sebelumnya hanya mengirim teks `format(e)` pada catch command; error dari `plugin.all`, `plugin.before`, dan lapisan handler tidak memiliki format laporan yang konsisten.
- **Perubahan:** `handler.js` memiliki `sendErrorReport()` bersama. Catch `plugin.all`, `plugin.before`, command plugin, dan outer handler memanggilnya. Pesan menggunakan tombol native WhatsApp `cta_copy` dengan isi stack/log, disertai fallback teks bila tombol gagal dikirim. Log dibatasi 12 KB, URL query disamarkan, dan pesan memberi peringatan agar log diperiksa sebelum dibagikan.
- **Tes:** belum menjalankan bot pada WhatsApp/TokoPanel; pemeriksaan sintaks dan pengujian interaksi tombol masih harus diverifikasi. Tombol salin memerlukan dukungan klien WhatsApp terhadap native-flow `cta_copy`.
- **Belum diverifikasi:** kompatibilitas tepat `nativeFlowInfo` pada fork Baileys `@itsliaaa/baileys@0.3.18-final`, perilaku di Android/iOS/Desktop, dan log untuk error sebelum objek pesan/chat terbentuk.
- **Pelajaran regresi:** error global tidak boleh membocorkan token, URL bertanda tangan, atau kredensial; setiap jalur catch harus tetap mencatat stack di server meskipun pesan WhatsApp gagal terkirim.

## 2026-10-30 — TikTok: fallback resolver tambahan
- Permintaan: tambah sumber unduhan alternatif dan menjaga hasil HD.
- Perubahan: menambahkan resolver SaveAPI opsional pada `plugins/downloader/tiktok.js`. Resolver hanya aktif bila `SAVEAPI_KEY` diatur dan baru dipanggil setelah kandidat TikWM gagal. Hasil diperiksa dengan ffprobe dan validasi frame; resolusi di bawah 720 piksel pada sisi terpanjang ditolak. Fallback yt-dlp juga kini melewati validasi resolusi dan frame.
- Tes: belum ada uji live dari TokoPanel atau panggilan API. Pemeriksaan sintaks lokal belum dijalankan; skrip `npm test` kini mencakup file downloader TikTok.
- Belum diverifikasi: API key/kredit, akses jaringan TokoPanel, dan ketersediaan varian HD pada setiap video.
- Referensi: commit `f46bdb947dac1b718bb7f7892b3a76eda94ce0c5`.


## 2026-10-30 — Diagnostik error TikTok lebih lengkap
- **Permintaan:** saat downloader gagal, tampilkan detail yang cukup lengkap agar AI/pengembang mudah menentukan sumber masalah.
- **Perubahan:** `plugins/downloader/tiktok.js` sekarang mempertahankan pesan error asli dan menambahkan status/statusText HTTP, endpoint provider tanpa query string (menghindari kebocoran token/URL bertanda tangan), cuplikan body respons, `code`, `errno`, `syscall`, `path`, dan `cause` bila tersedia. Ringkasan akhir menampilkan semua tahap yang gagal dalam baris terpisah; pesan WhatsApp juga menjelaskan bahwa stack/log lengkap tersedia di server.
- **Tujuan diagnostik:** membedakan provider menolak request (misalnya HTTP 503), URL/media tidak valid, file terpotong/rusak, kegagalan FFmpeg, masalah yt-dlp, dan masalah filesystem.
- **Tes:** commit dilakukan; syntax check, uji provider live, dan verifikasi tampilan WhatsApp/TokoPanel belum dilakukan.
- **Privasi:** query string endpoint tidak ditampilkan karena bisa memuat token atau URL CDN bertanda tangan.


## 2026-10-30 — Memperbaiki fallback multi-sumber untuk short link TikTok
- **Permintaan/gejala:** tautan `https://vt.tiktok.com/ZSgnCJAud/` gagal pada varian TikWM, embed tidak dapat menemukan ID dari URL yang belum ter-resolve, dan yt-dlp menghasilkan metadata/durasi tidak valid.
- **Akar penyebab dari kode:** `getTikTokFallbackSourceUrl()` mempertahankan URL vt/vm secara langsung sebelum mempertimbangkan `res.videoId`; akibatnya fallback resmi embed dan yt-dlp tetap menerima short link ketika redirect TokoPanel gagal. Fungsi embed juga hanya mengekstrak ID dari URL.
- **Perubahan:** `plugins/downloader/tiktok.js` sekarang membangun permalink kanonis `/@username/video/{id}` dari ID aweme/video provider untuk short link, dan meneruskan ID provider langsung ke extractor embed sebagai fallback tambahan. Jalur sumber tetap berlapis: kandidat TikWM HD/standard, TikTok embed/CDN resmi, lalu yt-dlp; watermark hanya pilihan terakhir dan tetap harus HD.
- **Tes:** perubahan kode dicatat di main; pemeriksaan sintaks dan uji unduhan live TokoPanel belum diverifikasi pada saat commit.
- **Belum diverifikasi:** apakah provider TikWM mengembalikan ID valid untuk tautan ini, apakah TikTok mengizinkan embed/CDN dari IP TokoPanel, dan resolusi maksimum video sumber.
- **Pelajaran:** jangan mengandalkan redirect vt/vm saja; bila metadata provider punya aweme ID, bentuk URL kanonis untuk extractor lain. Beberapa jalur extractor bukan jaminan semua video tersedia HD.


## 2026-10-30 — Perbaikan SyntaxError downloader TikTok
- **Gejala:** TokoPanel gagal memuat `plugins/downloader/tiktok.js` dengan `SyntaxError: Unexpected token 'throw'`, sehingga handler TikTok tidak aktif walaupun proses bot dan plugin lain tetap berjalan.
- **Akar penyebab:** pada jalur akhir `prepareBestTikTokVideo`, pernyataan `throw new Error(...)` untuk kondisi semua varian gagal tertulis dua kali berurutan pada baris yang sama. Parser menemukan token `throw` kedua di luar struktur pernyataan yang valid.
- **Perubahan:** menghapus duplikasi pernyataan `throw` dan mempertahankan satu error yang merangkum kegagalan semua varian. Tidak mengubah strategi kualitas maupun fallback.
- **Tes:** perbaikan langsung dilakukan pada `main`; pemeriksaan sintaks GitHub Actions perlu dipastikan selesai setelah commit ini.
- **Belum diverifikasi:** pemuatan plugin dan unduhan TikTok live di TokoPanel setelah restart.
- **Pelajaran regresi:** sebelum commit perubahan downloader, jalankan parser/syntax check untuk file plugin yang diubah; jangan hanya memeriksa diff visual.


## 2026-10-30 — Prioritaskan sumber TikTok HD sebelum watermark fallback
- **Permintaan/gejala:** unduhan TikTok berakhir pada 576×576 walaupun log menunjukkan varian HD dan Standard gagal.
- **Akar penyebab:** `prepareBestTikTokVideo()` menerima `wmplay` sebagai kandidat biasa. File watermark 576×576 lolos validasi kontainer/frame dan langsung dikirim, sehingga jalur embed TikTok dan yt-dlp yang berada setelah loop tidak pernah dijalankan.
- **Perubahan:** `plugins/downloader/tiktok.js` sekarang menunda kandidat watermark hingga jalur embed dan yt-dlp selesai; sumber embed, kandidat provider, dan watermark fallback harus memiliki sisi terpanjang minimal 720 piksel. Watermark fallback hanya diterima jika benar-benar memenuhi ambang tersebut. Tidak ada upscaling palsu.
- **Tes:** perubahan langsung di `main`; pemeriksaan sintaks/unduhan live TokoPanel belum dijalankan setelah commit.
- **Belum diverifikasi:** apakah embed dan yt-dlp bisa mengambil stream HD dari tautan pengguna pada IP/lingkungan TokoPanel. Sebagian video memang hanya tersedia dalam resolusi di bawah 720p.
- **Pelajaran:** jangan menyamakan file MP4 valid dengan file HD; periksa dimensi aktual dan jangan membiarkan fallback berkualitas rendah memutus jalur ekstraksi yang lebih baik.


## 2026-10-30 — Kebijakan perubahan langsung ke main
- **Permintaan:** pengguna meminta setiap perbaikan langsung diterapkan pada branch `main`, dan panduan AI harus mengikuti aturan tersebut.
- **Perubahan:** `AGENTS.md` dan `AI_CONTEXT.md` menetapkan direct-to-main sebagai alur baku; branch fitur/PR hanya dibuat jika diminta eksplisit. Perubahan harus tetap diperiksa dan dites sebelum commit. Jika branch protection/izin menolak push langsung, berhenti dan laporkan hambatan—jangan otomatis beralih ke PR.
- **Tes:** pemeriksaan isi dokumentasi; tidak ada perubahan kode runtime.
- **Pelajaran:** direct-to-main tidak berarti melewati pemeriksaan, tes, pencatatan changelog, atau perlindungan data.


Catatan ini adalah riwayat teknis untuk AI/developer berikutnya. **Tambahkan entri baru di bagian paling atas setiap kali ada perubahan bermakna**, dalam PR/commit yang sama dengan perubahan kode. Jangan mengubah hasil tes masa lalu agar terlihat sukses. Catat juga pendekatan gagal dan pelajaran regresinya.

Format entri baru:

```md
## YYYY-MM-DD — Judul singkat
- **Permintaan/gejala:** apa yang dilaporkan.
- **Akar penyebab:** hasil pemeriksaan, atau tulis “belum dipastikan”.
- **Perubahan:** file/fungsi dan perilaku yang diubah.
- **Tes:** perintah/workflow yang benar-benar dijalankan dan hasilnya.
- **Belum diverifikasi:** perilaku live, API pihak ketiga, atau risiko yang tersisa.
- **Referensi:** commit/PR/issue.
- **Pelajaran regresi:** hal yang harus diperiksa sebelum mengulang perubahan serupa.
```

---

## 2026-10-30 — Perintah .clean untuk file sementara
- **Permintaan/gejala:** pengguna tidak mengetahui kuota disk TokoPanel dan meminta cara membersihkan file yang tidak penting melalui command .clean.
- **Akar penyebab:** belum ada perintah cleanup terarah; menghapus semua file server secara umum berisiko menghilangkan sesi WhatsApp, database, backup, konfigurasi, atau unduhan yang masih diperlukan.
- **Perubahan:** menambahkan plugins/owner/clean.js. Command owner-only menghapus hanya direktori bernama alvareth-tiktok-* pada os.tmpdir() dan ALVARETH_TIKTOK_TMPDIR yang lebih tua dari 2 jam, menghitung perkiraan ruang yang dibebaskan, dan mencoba melaporkan ruang filesystem yang tersedia. Folder yang lebih baru dilewati agar job aktif tidak terganggu.
- **Tes:** belum dijalankan pada runtime TokoPanel; workflow sintaks perlu memverifikasi plugin baru.
- **Belum diverifikasi:** kecocokan direktori sementara aktual di panel, ketersediaan statfs, dan jumlah ruang yang bisa dibebaskan pada server.
- **Pelajaran regresi:** cleanup otomatis harus berbasis allowlist nama/path yang dikelola bot dan umur file; jangan menghapus seluruh tmp, downloads, sesi, database, backup, atau file pengguna.
- **Referensi:** branch feat/owner-clean-command-main.
## 2026-10-30 — TikTok ENOSPC dan direktori sementara tidak konsisten
- **Gejala:** unduhan TikTok gagal dengan `ENOSPC`; pesan menghentikan fallback agar disk tidak makin penuh.
- **Akar penyebab yang ditemukan di kode:** `ALVARETH_TIKTOK_TMPDIR` hanya dipakai jalur video utama. Render postingan foto dan fallback yt-dlp masih menulis ke `os.tmpdir()` atau `./downloads`, sehingga konfigurasi direktori sementara tidak konsisten. ENOSPC sendiri tetap berarti volume/kuota/inode yang dipakai proses benar-benar kehabisan resource; kode tidak dapat menambah kapasitas hosting.
- **Perubahan:** `plugins/downloader/tiktok.js` memakai satu helper direktori sementara untuk unduhan video dan render foto, membersihkan direktori TikTok usang saat membuat job baru, serta memeriksa ruang kosong minimum 64 MB sebelum memulai. `lib/scrape/youtube.js` menerima opsi `outputRoot` agar fallback yt-dlp TikTok menulis ke direktori yang sama dan dibersihkan bersama job.
- **Tes:** pemeriksaan sintaks file JavaScript dan workflow GitHub perlu dijalankan pada PR; tes unduhan live membutuhkan hosting TokoPanel dan ruang disk aktual.
- **Belum diverifikasi:** ruang disk, inode, dan kuota filesystem TokoPanel; keberhasilan tautan TikTok yang dilaporkan pengguna.
- **Pelajaran regresi:** setiap jalur fallback/render harus menggunakan direktori sementara yang sama, dan error ENOSPC harus menghentikan retry. Memindahkan tmpdir hanya membantu bila direktori target berada pada volume/kuota berbeda yang memang memiliki ruang kosong.
- **Referensi:** PR perbaikan ENOSPC TikTok.
  
## 2026-10-30 — Fondasi pembacaan media dari pesan yang direply
- **Gejala:** perintah berbasis media reply (contoh pada tangkapan layar: `.toreal`) dapat menerima pesan balasan tetapi gagal membaca media sumber; plugin memakai variasi `m.quoted`, `q.msg`, `q.mediaMessage`, dan `q.download()`.
- **Akar masalah yang ditangani:** serialisasi protobuf Baileys pada handler dapat menormalisasi atau membuang struktur nested di `message`, termasuk `contextInfo.quotedMessage` dan wrapper media WhatsApp.
- **Perubahan:** setelah `smsg()` dijalankan, `handler.js` memulihkan payload `message` asli dari event Baileys sebelum plugin dieksekusi dan menyimpan referensi `rawMessage` non-enumerable. Dengan demikian semua plugin yang menggunakan serializer/helper bersama menerima payload asli yang sama tanpa patch perintah satu per satu.
- **Tes:** belum menjalankan bot di TokoPanel/WhatsApp; perlu menjalankan `npm test` atau pemeriksaan sintaks setara lalu uji media nyata.
- **Belum diverifikasi:** unduhan live untuk image, video, audio, dokumen, stiker, ephemeral/view-once, serta variasi pesan grup dan chat pribadi.
- **Pelajaran regresi:** jangan mengandalkan hasil `proto.WebMessageInfo.fromObject()` sebagai satu-satunya sumber nested media untuk plugin; pertahankan event payload asli dan uji fitur yang mengonsumsi media reply.

## 2026-10-29 — Standarisasi panduan AI
- **Permintaan:** membuat panduan yang ringkas untuk AI baru, memuat batasan yang jelas dan mewajibkan dokumentasi perubahan.
- **Perubahan:** menambahkan `AGENTS.md`, merapikan `AI_CONTEXT.md`, dan membuat changelog ini.
- **Tes:** memeriksa file panduan serta tautan/rujukan yang akan ditambahkan ke README; tidak ada tes runtime aplikasi untuk perubahan dokumentasi.
- **Pelajaran regresi:** panduan AI harus menjadi bagian dari PR yang sama dengan kode; jangan mengandalkan ingatan percakapan atau status yang tidak diverifikasi.

## 2026-10-29 — Pencarian TikTok ketika TikWM mengembalikan HTTP 403
- **Gejala:** `.ttsearch anime edit 4k` gagal; TikWM GET dan POST sama-sama mengembalikan HTTP 403.
- **Akar penyebab:** jalur pencarian bergantung pada penyedia API yang ditolak; mengulang metode atau variasi kueri ke penyedia yang sama tidak menghilangkan pemblokiran.
- **Perubahan:** PR #13 menambahkan fallback hasil pencarian Bing dan Google, menormalisasi tautan video TikTok, menghentikan pengulangan TikWM setelah 403, dan menambah modul scraper ke pemeriksaan sintaks.
- **Tes:** GitHub Actions “JavaScript syntax checks” untuk commit PR #13 selesai dengan status `success`.
- **Belum diverifikasi:** hasil pencarian live dari jaringan TokoPanel dan keberhasilan pengiriman video di WhatsApp.
- **Referensi:** https://github.com/lightevil96-svg/Alvareth-Bot/pull/13
- **Pelajaran regresi:** HTTP 403 adalah kegagalan penyedia, bukan “hasil kosong”. Mesin pencari mungkin tidak mengindeks hasil yang dicari dan fallback eksternal tetap best-effort.

## 2026-10-29 — Updater: diagnosis dan retry jaringan
- **Gejala:** perintah `.update` berhenti dengan `fetch failed`.
- **Akar penyebab:** pesan tersebut menunjukkan kegagalan request jaringan; penyebab spesifik harus dibaca dari rantai error, bukan ditebak.
- **Perubahan:** PR #11 menambahkan retry terbatas untuk kegagalan jaringan/status server sementara dan detail penyebab error pada laporan.
- **Tes:** perubahan terintegrasi ke `main`; konektivitas dari TokoPanel tidak dapat diuji lewat pemeriksaan kode saja.
- **Belum diverifikasi:** pembaruan sukses di hosting pengguna.
- **Referensi:** https://github.com/lightevil96-svg/Alvareth-Bot/commit/d6476b268dcc1c7fe6ad3418cd901c3903469560
- **Pelajaran regresi:** jangan mengulang tanpa batas; pertahankan pemeriksaan perubahan lokal dan jalur aman updater.

## 2026-10-29 — Resolusi unduhan YouTube
- **Gejala:** pengguna memilih kualitas tertinggi, tetapi video yang diterima hanya 360p.
- **Perubahan:** PR #10 mengutamakan yt-dlp untuk target kualitas terbaik, memperhitungkan FPS saat pemilihan format, dan melaporkan resolusi/FPS berkas hasil.
- **Tes:** perubahan terintegrasi ke `main`; kualitas unduhan harus diverifikasi dari hasil berkas langsung karena ketersediaan format berbeda antarvideo.
- **Referensi:** https://github.com/lightevil96-svg/Alvareth-Bot/commit/3c15ec6a53029d7f5353be96114408c00edffa85
- **Pelajaran regresi:** jangan menampilkan kualitas yang diminta sebagai kualitas yang benar-benar didapat; inspeksi media hasil.

## 2026-10-22 — Fallback helper pesan lintas plugin
- **Gejala:** sebagian plugin gagal dengan `m.reply is not a function` atau `m.react is not a function`.
- **Perubahan:** fallback metode reply/react ditempatkan pada layer normalisasi pesan bersama di `handler.js`, bukan hanya ditambahkan ke satu plugin.
- **Tes:** kode pernah dicatat sebagai belum diverifikasi di sesi WhatsApp live; uji `.play`, `.tt` dan plugin lain yang memakai helper bila menyentuh layer ini.
- **Referensi:** commit `7d66ebf` (lihat riwayat Git untuk SHA lengkap).
- **Pelajaran regresi:** saat helper serializer hilang, cek `handler.js` dan `lib/simple.js` sebelum membuat perbaikan berulang di banyak plugin.

## 2026-10-22 — Perintah menu dan normalisasi pesan
- **Gejala:** `.menu` tidak selalu terdeteksi setelah serialisasi pesan.
- **Perubahan:** normalisasi routing, teks pesan dan fallback properti pesan ditambahkan pada handler.
- **Verifikasi yang tercatat:** pengguna mengonfirmasi `.menu` bekerja setelah perbaikan.
- **Pelajaran regresi:** jangan menghapus fallback normalisasi tanpa tes regresi untuk pesan teks, self-chat, dan respons tombol/list.


## 2026-11-04 — Video Studio API key bootstrap and Pterodactyl port
- **Gejala:** Pterodactyl Startup page tidak menyediakan `PORT` atau `CUSTOM_ENVIRONMENT_VARIABLES`, sehingga setup awal Video Studio tidak dapat mengikuti instruksi environment manual.
- **Perubahan:** HTTP server mendukung `SERVER_PORT` bawaan Pterodactyl. API Video Studio membuat API key acak 256-bit dan menyimpannya di direktori data persisten dengan izin file 0600 bila environment key tidak diatur.
- **Keamanan:** key tidak ditanam di source/repository; pengguna mengambil key dari file runtime privat dan memasukkannya ke session browser. CORS tetap membatasi origin LightJurnal.
- **Belum diverifikasi:** instalasi dependency Remotion, reverse proxy/HTTPS publik, autentikasi live, dan render MP4 di server Pterodactyl.
