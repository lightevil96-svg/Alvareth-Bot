# AI Context — Alvareth Bot

> **Tujuan:** orientasi singkat untuk AI/developer yang melanjutkan proyek.
> **Repository:** https://github.com/lightevil96-svg/Alvareth-Bot
> **Branch produksi:** `main`
> **Ditinjau:** 2026-11-05
>
> Baca `AGENTS.md` terlebih dahulu, lalu file ini dan `docs/AI_CHANGELOG.md`. Catatan membantu orientasi, tetapi kode saat ini tetap menjadi sumber kebenaran.

## Pembaruan terbaru

- 2026-11-06: Remotion readiness now treats Ollama/VoxCPM2 defaults as configured, auto-starts local services only when their installed binaries, virtualenv and model weights exist, and reports exact setup actions when prerequisites are missing. No automatic package/model downloads; VPS provisioning and live MP4 verification remain separate.

- 2026-11-06: Branch feat/remotion-whatsapp-linux migrates media to loopback Ollama + VoxCPM2, fixes audio serialization/timing, adds event SFX and authorization regression tests. See docs/REMOTION_AUDIT_2026-11-06.md for actual verification; earlier hosted-provider entries below are historical and superseded.

- 2026-11-05: Branch `feat/remotion-whatsapp-linux` menambahkan fitur owner-only `.remotion` pada WhatsApp. Plugin `plugins/owner/remotion.js` memakai Video Studio planner/compiler/queue/renderer yang sudah ada, menu native-flow dengan fallback teks, prompt session, status/progres, riwayat, resend, provider readiness, dan uploader MP4 disk-streaming. Prompt session di-route sebelum plugin normal hanya untuk owner yang memulai sesi.

- 2026-11-05: Generator lama FreeTheAI `plugins/ai/aivideo.js` dihapus dan variabel FREETHEAI dibuang dari `.env.example`. Remotion tetap memakai Node.js, Chromium/Remotion, FFmpeg/FFprobe, dan Linux native; Android/Termux tutorial steps tidak dipakai.


- 2026-11-05: Skill `alvareth-ai-video-production` dan dokumen `docs/REMOTION_WHATSAPP_LINUX.md` ditambahkan. Tes command helper dan continuity bible dibuat; jalankan npm test, install dependency, serta live WhatsApp/ComfyUI/ElevenLabs/render checks sebelum merge/deploy.

- 2026-11-04: Updater `.update` tidak lagi menganggap batas 300 file dari GitHub REST sebagai daftar lengkap; otomatis memakai Git diff read-only pada repository bare sementara untuk diff penuh, dengan batas pengaman 20.000 file dan output 20 MiB.

- 2026-11-04: Video Studio memakai named Cloudflare Tunnel khusus `video.lightjurnal.my.id`; bot auto-detect/auto-install cloudflared (SHA-256), membaca token privat dari environment/file, dan reconnect dengan backoff. DNS dan remote ingress sudah diprovisikan; konektor live menunggu token di environment Pterodactyl.

- 2026-11-04: Automatic self-update kini dijalankan setelah plugin dimuat (90 detik awal, lalu interval AUTO_UPDATE_INTERVAL_MINUTES); memakai ulang plugins/owner/update.js, menjaga .env/sesi/database/file konflik, memasang dependency berubah, lalu meminta supervisor index.js restart worker. Tidak memerlukan .update atau PM2.

- 2026-11-04: LightJurnal Video Studio tetap prompt-only. Alvareth kini memiliki pipeline opsional ElevenLabs TTS dengan alignment karakter untuk subtitle per kata, Pexels stock-footage retrieval dan atribusi, music ducking, media validation, serta status tahap persiapan media. Fitur TTS memerlukan VIDEO_STUDIO_ELEVENLABS_API_KEY + VIDEO_STUDIO_ELEVENLABS_VOICE_ID; footage memerlukan VIDEO_STUDIO_PEXELS_API_KEY. CI/JSX compile/regression harus lulus; render MP4 live pada VPS dan validasi akun provider belum dilakukan.

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

- **Updater dan batas GitHub Compare API:** endpoint REST `/compare` hanya mengembalikan maksimal 300 file. Jika respons mencapai 300, `plugins/owner/update.js` harus mengambil daftar lengkap lewat `git diff --name-status -z` pada repository bare sementara yang read-only; jangan memotong daftar, menaikkan baseline, atau menulis file dari daftar yang berpotensi terpotong. Parser menerima hingga 20.000 entri dan output Git dibatasi 20 MiB; bila batas pengaman terlampaui, batalkan sebelum menulis file. Pertahankan pemeriksaan ancestor, baseline hash, path allow/deny, dan konflik file lokal.
- **Koneksi WhatsApp tertutup saat fitur mengirim balasan:** sebelum `conn.sendMessage`, periksa `conn.ws.readyState` bila tersedia. Status `3` berarti socket sudah tertutup; jangan retry pengiriman laporan error pada socket yang sama. Pertahankan error utama downloader/proses di terminal dan jadwalkan reconnect melalui lifecycle socket, bukan dengan mengirim pesan tambahan.
- **WhatsApp video delivery policy:** the shared `lib/whatsapp-file-sender.js` classifies every detected video MIME/known video extension as `mediaType: 'video'` regardless of file size or container. This applies equally to `.clip` and `.download`. Non-video files remain documents. Never reintroduce a size threshold or automatic video-to-document fallback; if WhatsApp rejects a video payload, preserve the source and report failure. The service may reject unsupported containers or very large uploads.
- **Baileys temporary media storage on Pterodactyl:** `lib/whatsapp-temp-bootstrap.js` must be imported after `dotenv/config` but before Baileys in `main.js`. It sets `TMPDIR` to `ALVARETH_WA_TMPDIR` or `<ALVARETH_DATA_DIR or ~/.alvareth-bot-data>/tmp`, a writable directory on the server's disk. Pterodactyl Wings defaults `/tmp` tmpfs to 100 MiB; do not merely raise `ALVARETH_DOWNLOAD_MAX_BYTES` or disable the temp-space preflight. Confirm the server disk quota/free space is sufficient. If the override is invalid, the bootstrap falls back to the managed data directory and logs a warning.
- **File manager `.download`:** browser hanya boleh membaca root `ALVARETH_DOWNLOAD_DIR` (default `./downloads`), tidak menampilkan dotfiles atau symlink, memverifikasi setiap komponen path, mengirim semua file terdeteksi-video berdasarkan MIME/ekstensi sebagai pesan video tanpa batas ukuran, dan mengirim jenis file nonvideo sebagai dokumen setelah validasi ukuran. Row ID list WhatsApp diproses sebagai command oleh normalisasi `listResponseMessage.singleSelectReply.selectedRowId` di `handler.js`; jangan menghapus jalur routing ini. Hasil akhir `.clip` disimpan di subfolder `clip` agar dapat diambil kembali lewat `.download`. List message Baileys hanya bekerja di chat pribadi; plugin menolak penggunaan dari grup dan menampilkan instruksi untuk membuka chat pribadi.

- **Pesan WhatsApp dan serializer/media reply:** periksa `handler.js` dan `lib/simple.js` terlebih dahulu. `handler.js` mempertahankan payload `rawMessage.message` sebelum plugin dijalankan agar `contextInfo.quotedMessage` dan wrapper media tidak hilang saat protobuf `fromObject()` menormalisasi pesan. Untuk plugin yang membaca media reply, gunakan `getQuotedMediaInfo(m)` dan `downloadQuotedMedia(m, conn)` dari `lib/simple.js`; jangan mengandalkan `m.quoted.mimetype` saja karena MIME bisa tidak terbawa, sedangkan tipe `imageMessage`/`videoMessage` masih tersedia. Helper bersama mencari `contextInfo.quotedMessage` di payload mentah dan menembus wrapper media. Jangan membuat deteksi media terpisah di setiap plugin. Uji foto, video, audio, dokumen, stiker, ephemeral, view-once, pesan grup, chat pribadi, dan pesan dengan caption.
- **AutoDL:** `lib/auto-download.js` memetakan satu URL dari host yang didukung ke plugin downloader yang ada. `handler.js` memproses pesan biasa sebagai synthetic command hanya saat cocok, tanpa mengubah `m.text` atau melewati cek izin/limit. Chat pribadi aktif secara default (termasuk satu URL teks dari akun WhatsApp yang sama meski `fromMe === true`), grup harus `.enable autodl`; link dari bot sendiri diabaikan. `runAutoDownloadJob` membatasi dua unduhan paralel dengan antrean maksimal delapan. **Router lama** `plugins/anu/_autodl.js` masih menangani layanan tambahan dan kasus TikTok link polos dari akun sendiri, tetapi harus mengabaikan `m.autoDownload` untuk mencegah duplikasi; pemilihan prefix pada router lama memakai `findAutoDownloadPrefix()` dari helper yang sama agar prefix regex/default konsisten. Jangan mengaktifkan dua router pada pesan yang sama atau menambah unduhan di `plugin.all`. `plugins/downloader/tiktok.js` menggunakan teks masuk bila `m.autoDownload` agar quoted media tidak mengganti link yang dideteksi.
- **Plugin:** plugin dimuat secara rekursif dari `plugins/`. Ikuti konvensi handler yang dipakai file sejenis; periksa izin `handler.group`, `handler.admin`, `handler.botAdmin`, limit, dan format command sebelum mengubahnya.
- **TikTok search/downloader:** `plugins/search/tiktok.js` memakai helper di `lib/scrape/tikwm.js`. API eksternal bisa membatasi IP/host. Jangan memperlakukan HTTP 403 sebagai kueri kosong; gunakan fallback berbeda dan tetap jelaskan jika semua penyedia gagal. Semua direktori kerja TikTok (video, render foto, dan fallback yt-dlp) harus memakai `ALVARETH_TIKTOK_TMPDIR` bila diatur; jangan membuat jalur sementara tambahan langsung di `os.tmpdir()`.
- **Video Studio remote renderer:** `server.js` mounts `video-studio/api.js` and starts `video-studio/tunnel.js` after the HTTP server listens. LightJurnal calls `/api/video-studio/*` with a Bearer `VIDEO_STUDIO_API_KEY`; the API validates plans and stores queue/output under `<ALVARETH_DATA_DIR or ~/.alvareth-bot-data>/video-studio`. The dedicated remotely-managed Cloudflare Tunnel `lightjurnal-video-studio` publishes `video.lightjurnal.my.id` to the local HTTP server. The bot reads `VIDEO_STUDIO_TUNNEL_TOKEN` or the private token file `<ALVARETH_DATA_DIR or ~/.alvareth-bot-data>/video-studio/tunnel-token`, auto-detects or downloads the official cloudflared binary (SHA-256 verified), and reconnects with bounded exponential backoff. The token must never enter Git, browser code, or logs. Cloudflare DNS/ingress can be configured while the tunnel remains inactive until the server has its token. Keep the render queue single-worker by default so CPU/memory spikes do not starve Baileys.
- **Updater saat startup:** `npm start` menjalankan `scripts/start-with-update.js`, yang mengambil update Git secara fast-forward dan memulai versi lokal bila pembaruan gagal. Ini bukan update/deploy VPS jarak jauh. Perubahan updater harus mempertahankan data dan perubahan tracked lokal.
- **Data persisten:** database default berada di `~/.alvareth-bot-data/database.json`; sesi di `~/.alvareth-bot-data/sessions/`. Lokasi dapat berbeda lewat `ALVARETH_DATA_DIR` dan `WA_SESSION_DIR`. Jangan menghapus salinan lama sebelum migrasi berhasil diverifikasi.
- **Deploy:** saat ini jangan menganggap tersedia auto-deploy ke VPS hanya karena ada workflow GitHub. Periksa file workflow yang benar-benar ada.

## 5. Tes dan cara melaporkan

Perintah dasar:
- `npm test` — pemeriksaan sintaks file utama dan beberapa modul.
- GitHub Actions `JavaScript syntax checks` — pemeriksaan sintaks semua file JavaScript dalam cakupan workflow.
- Jalankan tes/skrip unit atau tes manual tambahan bila tersedia.

Pada laporan akhir, sebutkan file/fungsi yang berubah, akar masalah, hasil tes nyata, commit/PR, serta batasan yang belum diuji. Tes sintaks bukan bukti API pihak ketiga atau pengiriman WhatsApp berhasil.

## Video Studio — prompt-first creative director

- LightJurnal now submits one natural-language prompt. The AI planner in video-studio/prompt/planner.js creates a structured creative brief and storyboard; video-studio/prompt/compile.js safely compiles it to the validated Remotion schema.
- Authenticated POST /api/video-studio/plan returns the plan. POST /api/video-studio/jobs accepts the validated plan (legacy manual payloads remain supported for compatibility).
- Creative decisions are inferred: scene count and timing, aspect ratio, FPS, palette, layout, motion, transitions, music mood, and sound cues. Current render limits are 60 scenes, 20 seconds per scene, and 300 seconds total.
- video-studio/remotion/Composition.jsx supports varied hero/editorial/split/stat/quote/steps/outro layouts, animated geometric motifs, motion presets, a scene progress indicator, music fades, and allowlisted sound cues.
- Do not reintroduce manual creative settings in the LightJurnal UI. Keep only the single prompt field; API connection credentials are infrastructure settings, not creative controls.


## 6. Pembaruan terbaru

- 2026-11-04 — Video Studio prompt-first pipeline implemented: structured AI planning, safe plan compiler, dynamic scene durations, richer motion-graphics layouts, and read-only storyboard output. Focused regression workflow added; initial helper-export test failure fixed. 13 official Remotion skills plus the custom remotion-professional-editor skill are installed under .agents/skills. The focused Video Studio tests and Remotion JSX entrypoint compilation pass in GitHub Actions; live MP4 rendering, TTS, stock footage, and AI-generated scene footage remain unverified or future capabilities.

- 2026-11-04 — Added LightJurnal remote Video Studio API to the existing optional Alvareth HTTP server. API key auth, strict origin allowlist, JSON project validation, a disk-persisted single-worker queue with bounded history/partial-output cleanup, and Remotion text-motion rendering are implemented. The first LightJurnal UI supports Simple/Professional project modes, professional scene duration/background controls, job status, preview and download; media upload/audio/timeline editing and WhatsApp send are not yet implemented. GitHub Actions JavaScript syntax checks passed on commit d558398; local project validation tests passed 4/4. VPS deployment, dependency installation, HTTPS reverse proxy and live render remain unverified.

- 2026-11-03 — `.clip` and `.download` send every detected video as a WhatsApp video payload regardless of file size or common video container; non-video files remain documents and no automatic document fallback is allowed. Removed the obsolete 64 MiB inline-video threshold and per-feature `forceVideo` flag. `.clip` now scans all advertised YouTube resolutions through metadata first, selects the highest resolution, downloads only that selected stream (with at most one same-resolution alternate if the selected transport is invalid), and invokes Qbyte only once as a bounded fallback after yt-dlp fails. Qbyte fallback downloads only its best metadata-selected video/audio pair and is capped at 256 MiB per stream by default. GitHub Actions npm run test:clip passed 32/32 (run 41636334551), including the regression test for the highest-quality FFmpeg finalizer receiving the selected candidate. Repository-wide JavaScript syntax checks passed (run 41636334438). Live YouTube extraction and WhatsApp delivery on TokoPanel still need verification.
- 2026-11-03 — `.clip`/`.download` now redirect Node/Baileys `TMPDIR` away from Pterodactyl's default 100 MiB `/tmp` tmpfs to writable server storage (`ALVARETH_WA_TMPDIR` override; default `~/.alvareth-bot-data/tmp`). A pre-import bootstrap, write-access probe, diagnostics, and regression tests cover default, override, fallback, and import order. GitHub Actions `npm run test:media` 16/16 and repository-wide JavaScript syntax checks pass; download-browser and clip-progress regressions also pass. The unrelated sticker workflow could not install native `canvas` because `pixman-1` was missing; its tests did not run. Live Pterodactyl/WhatsApp upload still needs verification.
- 2026-11-03 — `.clip` + `.download` now use `lib/whatsapp-file-sender.js`: local-path disk streaming (no whole-file RAM buffer), temp-space/readability preflight, configurable Baileys `mediaUploadTimeoutMs`, one-at-a-time per-socket queue, 64 MiB default inline-video threshold (only MP4/M4V inline; larger/other containers as documents), 2 GiB−10 MiB bot-side file guard, actionable ENOSPC/ENOENT/EACCES/413/428/timeout/ECONNRESET diagnostics, and no automatic retry after ambiguous send. `.clip` keeps the final archive in `downloads/clip` on upload failure; `handler.js` unwraps nested WhatsApp interactive replies for `.download` selections. `npm run test:media` 12/12, `npm run test:clip` 30/30, download-browser regression and repository-wide syntax checks pass. No live TokoPanel/WhatsApp upload has been performed; deployment/restart and real large-file send remain required.
- 2026-11-03 — `.clip` mengenali ENOSPC saat upload, tidak mengulang upload dokumen pada disk penuh, mencatat ruang direktori temp, dan mempertahankan hasil di `downloads/clip` agar dapat dikirim ulang setelah storage server dibersihkan.
- 2026-11-03 — `.clip`: validasi rentang waktu menampilkan nilai yang dibaca bot; balasan dan pelaporan error global tidak mengulang `sendMessage` pada socket Baileys tertutup/428. Hasil clip kini dipertahankan di `downloads/clip` agar dapat diambil ulang lewat `.download`.
- 2026-11-03 — `.download`: file manager interaktif WhatsApp untuk menelusuri folder dan mengirim file terpilih; akses dibatasi ke `ALVARETH_DOWNLOAD_DIR` (default `./downloads`), dotfiles/symlink disembunyikan atau ditolak, dan daftar dipaginasi. Tes helper filesystem ditambahkan; uji langsung list response dan pengiriman dokumen di WhatsApp/TokoPanel belum dilakukan.

- 2026-11-03 — `.update` GitHub 403 hotfix: endpoint REST commit/latest dan compare kini membaca header rate-limit dan mendukung token opsional `ALVARETH_GITHUB_TOKEN` (atau `GITHUB_TOKEN`) dari environment privat. Jika REST 403/429/5xx, fallback menjalankan `git ls-remote` dan `git diff --name-status -z` di bare repository sementara; memverifikasi SHA, ancestry, dan daftar file sebelum melakukan pemeriksaan baseline/hashes lokal. Proteksi sesi/.env/database tetap. Fallback memerlukan Git di server. Tes `tests/update-transport.test.js` memakai repo lokal dummy (4/4 lulus GitHub Actions 41558270979); workflow `update-regression.yml`. Karena updater lama gagal sebelum memperoleh patch, perlu bootstrap satu kali dengan mengganti hanya `plugins/owner/update.js` melalui TokoPanel Files, restart, lalu `.update`. Jangan hapus baseline state. Uji live TokoPanel belum dilakukan.

- 2026-11-03 — **Hotfix autentikasi YouTube pada `.clip` setelah log 07:42**: semua profil yt-dlp gagal dengan `Sign in to confirm you're not a bot`, sedangkan Qbyte API mengembalikan HTTP 502. Ini penolakan akses server oleh YouTube, bukan error resolusi atau FFmpeg; tidak mungkin memastikan 1080p tanpa sumber yang dapat diunduh. Bot kini mendukung file Netscape YouTube cookies privat di `.alvareth-bot-data/youtube-cookies.txt` atau variabel `YTDLP_COOKIES_FILE` (path absolut) dan meneruskan `--cookies` untuk probe, video, serta audio; isi cookie tidak dimasukkan ke log/GitHub/WhatsApp. File privat dikecualikan dari Git; format file dan akses baca divalidasi. Saat YouTube memerlukan verifikasi, profil tidak diulang tanpa EJS, empat metode yt-dlp lain dilewati, lalu Qbyte dicoba; HTTP 502/503/504 dicoba ulang sekali. Satu inventaris kualitas yt-dlp dipakai ulang antar-metode agar permintaan ke YouTube berkurang. WhatsApp menampilkan error autentikasi yang bisa ditindaklanjuti. Pemilik harus mengunggah sendiri cookies sesi miliknya ke TokoPanel dan mengamankannya; tidak boleh mengirim cookies lewat percakapan. Uji live YouTube dan WhatsApp belum dilakukan.

- 2026-11-03 — Perbaikan `.clip` setelah bukti terminal memperlihatkan **1080p tersedia pada metadata (mis. format 616+140), tetapi metode pertama gagal dengan `0:v:0 matches no streams` dan bot akhirnya mengirim 360p**. Akar masalahnya: kualitas berdasarkan metadata belum diverifikasi pada file unduhan; pemilihan metode pertama dapat menerima stream audio-only atau video palsu. Kini lima metode (baru: track video/audio terpisah, yt-dlp sections, FFmpeg segment, FFmpeg seek, Qbyte) memeriksa format source, mencoba ID HD alternatif jika ada file tanpa stream video, resolusi nyata terlalu rendah, atau output hitam. Metode track-terpisah memvalidasi video **sebelum** mengunduh/menggabungkan audio. FFprobe membuktikan dimensi aktual dan FFmpeg blackdetect menguji frame. Output hasil semua metode dibandingkan menurut dimensi/FPS/bitrate; hanya hasil terbaik dipertahankan di disk selama proses. Jika metadata mengiklankan HD tetapi hanya SD yang dapat diproses, caption WhatsApp memberi peringatan yang faktual. Tanpa batas ukuran/durasi/timeout aplikasi sesuai preferensi pengguna, tetapi keterbatasan YouTube/PO Token/provider/hosting masih berlaku. Tests mencakup mock fallback audio-only dan fixture media FFmpeg aktual. Uji langsung di TokoPanel belum dilakukan dan harus diverifikasi setelah restart.

- 2026-11-02 — Implementasi `.clip` yang aktif pada source saat ini menulis progres/tahap ke terminal melalui `clip-progress.js`; chat WhatsApp menerima hasil atau pesan gagal setelah proses. Video dialirkan dari path file lokal; bila kirim sebagai video ditolak, plugin mencoba kembali sebagai dokumen, bukan membaca seluruh file ke Buffer.

- 2026-11-02 — Fitur `.s` diperkuat: cache pesan media menggunakan `cloneMessageForMediaCache()` agar Buffer/Uint8Array mediaKey dan hash tidak rusak oleh JSON serialization; unduhan memprioritaskan media asli dari cache sebelum preview. Engine lokal Sharp/FFmpeg memvalidasi WebP RIFF, menambahkan EXIF, membatasi foto 100 KB dan animasi 500 KB dengan margin metadata; video maksimal 10 detik. Tes buffer-preservation, original-upload priority, static/animated WebP, dan batas ukuran dimasukkan ke `npm test`. FFmpeg pipeline diuji dengan fixture lokal; `npm test` penuh dan WhatsApp/TokoPanel live masih perlu dijalankan.

- 2026-11-02 — `.s` (stiker) kini memakai `resolveQuotedMediaInfo()` + `downloadQuotedMedia()` untuk menemukan gambar/video pada pesan reply asli atau media yang tersimpan berdasarkan stanzaId, termasuk media dikirim melalui self-chat. Balasan kesalahan tanpa externalAdReply. Cache `pushMessage` kini mempertahankan foto/video dari akun sendiri. Enam kasus logika helper media dan parsing V8 lolos, tetapi `npm test` dan uji live WhatsApp belum dijalankan.

- 2026-11-02 — Perbaikan AutoDL pesan milik owner `fromMe`: URL tunggal berbentuk pesan teks `conversation` atau `extendedTextMessage` tanpa quote diproses melalui router terpusat, sementara ID pesan yang dikirim `conn.sendMessage` ditandai dan diabaikan agar tidak terjadi loop. Ada log build router dan alasan skip link. Link Facebook `/share/r/...` tercakup oleh tes regresi; restart TokoPanel dan uji unduhan live belum terverifikasi.

- 2026-11-02 — AutoDL link langsung: router utama mengenali 13 layanan, mempertahankan router legacy untuk layanan tambahan seperti Apple Music, Videy, Douyin dan AIO, serta melewati legacy jika pesan sudah diklaim agar tidak double-download. Grup opt-in, pribadi default aktif, izin/registrasi/limit tetap berlaku. Tes unit dan regresi dibuat; live Node/WA/API belum diverifikasi.

- 2026-11-02 — Menghapus tautan GitHub Alvareth Bot dari kartu preview balasan dan menu: `global.adReply` dinetralkan, `global.linkch` tidak lagi diarahkan ke GitHub (menggunakan tautan kanal WhatsApp jika dikonfigurasi), menu gaya 1 tidak lagi menawarkan URL GitHub, menu gaya 2 dan detail tetap bergambar tanpa mengunggah thumbnail link preview. Tautan lain dan fungsi bot tidak diubah. Uji live WhatsApp belum dilakukan.

- 2026-11-02 — Perbaikan deteksi media reply lintas plugin: `getQuotedMediaInfo()` dan `downloadQuotedMedia()` membaca `contextInfo.quotedMessage` dari payload Baileys mentah, mengenali tipe media meski MIME tidak ada, dan menangani wrapper pesan; `.sw` kini memakai helper bersama serta dapat membaca URL/rentang dari caption media.

- 2026-11-02 — `.sw` (owner-only): reply video untuk upload Status; reply foto disimpan sementara per chat/pengirim, lalu `.sw URL mulai akhir` mengunduh audio YouTube dan membuat MP4 foto+musik dengan FFmpeg. Audiens Status diambil dari kontak pribadi yang tersimpan di `conn.chats`; potongan musik dibatasi 90 detik dan file sementara dibersihkan.

- 2026-11-02 — Riwayat eksperimen progres WhatsApp tidak cocok dengan implementasi aktif saat ini; source aktif `plugins/downloader/clip-progress.js` adalah terminal-only. Jangan mendokumentasikan heartbeat/edit pesan WhatsApp sebagai fitur aktif kecuali source benar-benar diubah dan diuji.
- 2026-11-02 — `.clip` mengutamakan format video dan FPS tertinggi yang tersedia pada jalur yt-dlp dan Qbyte; urutan fallback disusun berdasarkan kualitas sumber lalu kompatibilitas MP4. Tidak ada lagi target 45 MB atau transcode paksa untuk memenuhi batas internal; jika media video ditolak WhatsApp, plugin mencoba kirim sebagai dokumen.
- 2026-10-31 — Menambahkan `.clip URL mulai akhir` untuk memotong rentang YouTube langsung dengan yt-dlp `--download-sections` + FFmpeg/keyframe cuts; validasi domain/timestamp, folder sementara per job, dan cleanup setelah pengiriman. Batas durasi 15 menit dan batas file 45 MB yang pernah ditambahkan kemudian dihapus pada 2026-11-02.

- 2026-10-31 — Menambahkan .aivideo/.text2video/.img2video untuk text-to-video dan image-to-video melalui model gratis FreeTheAI (fta/), dengan task polling, timeout, validasi output, batas ukuran, dan konfigurasi API key/model via .env. Layanan gratis tetap membutuhkan akun, verifikasi email, daily check-in, serta tunduk pada kuota/antrean.

- 2026-10-30 — Laporan error WhatsApp dibuat kompatibel: `sendErrorReport()` mengirim teks biasa berisi ringkasan dan cuplikan log tersamarkan, bukan native-flow Buttons yang tidak didukung sebagian klien.

- 2026-10-30 — AI Image Converter: mengganti opsi `timeout` yang tidak efektif pada `node-fetch` v3 dengan `AbortController`/timer yang benar-benar membatalkan request; menambahkan diagnostik durasi, HTTP status/content-type, parsing respons image/JSON/URL teks, dan timeout unduhan hasil. Uji live API/WhatsApp tetap diperlukan.

- 2026-10-30 — Perbaikan fatal loader AI Image Converter: validasi URL pada `plugins/image/tohitam.js` memakai `URL` API sehingga regex literal yang sebelumnya menyebabkan `Invalid regular expression flags` tidak lagi menggagalkan pemuatan seluruh command image; `npm test` kini memeriksa sintaks plugin tersebut.
- 2026-10-30 — Diagnostik kategori image: `handler.js` mencatat awal, handler berjalan, selesai/gagal, nama plugin/perintah, dan durasi semua plugin bertag `image`. `plugins/image/tohitam.js` juga mencatat tahap download, validasi, upload, permintaan API, respons API, download hasil, pengiriman WhatsApp, serta total durasi. Log tidak mencetak URL privat atau API key.
- 2026-10-30 — AI Image Converter (`plugins/image/tohitam.js`): perbaikan deteksi gambar yang direply melalui wrapper pesan Baileys, validasi MIME berdasarkan signature file, validasi upload/API/hasil gambar, timeout, dan error dilempar kembali ke handler global agar tombol Salin Log Error ikut muncul. Pengujian live TokoPanel/API masih diperlukan.
- 2026-10-30 — Diagnostik error lintas plugin: `handler.js` mengirim laporan error dengan tombol WhatsApp `cta_copy` untuk menyalin stack/log; mencakup `plugin.all`, `plugin.before`, command handler, dan error lapisan handler. Jika tombol interaktif gagal dikirim, bot mengirim fallback teks. Log dibatasi 12 KB dan URL query disamarkan; tombol salin bergantung dukungan klien WhatsApp/Baileys.

- 2026-10-30 — Perbaikan fondasi media reply: `handler.js` memulihkan payload pesan asli setelah serialisasi Baileys dan menyimpan referensi non-enumerable `rawMessage`, supaya pembacaan `m.quoted`/`q.download()` di semua plugin menerima struktur media dan contextInfo yang tidak terpotong. Pemeriksaan sintaks perlu dijalankan; pengujian media live di WhatsApp/TokoPanel masih diperlukan.

- 2026-10-30 — TikTok: fallback opsional SaveAPI melalui `SAVEAPI_KEY`, hanya dipanggil setelah kandidat TikWM gagal agar pemakaian kredit tidak terjadi pada unduhan normal. Hasil langsung diverifikasi dengan ffprobe, frame awal, dan ambang resolusi HD 720p; yt-dlp juga kini melewati validasi resolusi/frame yang sama.

- 2026-10-30 — Diagnostik TikTok diperinci: setiap kegagalan provider menyertakan pesan asli, status HTTP, endpoint tanpa query sensitif, cuplikan body respons, serta kode sistem/penyebab; pesan akhir merangkum tiap tahap dan mengarahkan ke log server.

- 2026-10-30 — Perbaikan fallback TikTok short-link: gunakan aweme/video ID dari metadata provider untuk membangun permalink kanonis sebelum mencoba embed resmi/yt-dlp; embed juga menerima ID provider secara langsung bila redirect vt/vm gagal.

- 2026-10-30 — Memperbaiki SyntaxError `Unexpected token 'throw'` pada downloader TikTok: satu pernyataan `throw` terduplikasi pada jalur semua-varian-gagal.

- 2026-10-30 — TikTok downloader: watermark fallback ditunda sampai setelah embed/yt-dlp dan sumber di bawah 720 piksel pada sisi terpanjang ditolak agar tidak dikirim sebagai HD.
- 2026-10-30 — Ditambahkan .clean khusus owner untuk menghapus direktori sementara TikTok alvareth-tiktok-* yang berusia lebih dari 2 jam; data persisten dan file unduhan lain tidak disentuh.
- 2026-10-30 — Perbaikan ENOSPC TikTok: semua proses sementara video/foto/fallback diarahkan ke root konfigurasi yang sama, dengan pembersihan direktori usang dan pemeriksaan ruang awal; cek kondisi disk/kuota hosting tetap diperlukan.
- 2026-10-29 — Panduan AI diseragamkan: root `AGENTS.md`, konteks ringkas di file ini, dan `docs/AI_CHANGELOG.md` untuk catatan perubahan/regresi; perubahan ini dokumentasi saja.
- 2026-10-29 — PR #13: fallback pencarian TikTok lewat Bing/Google jika API utama gagal; pemeriksaan sintaks GitHub lolos, akses live dari TokoPanel belum diverifikasi.
- 2026-10-29 — PR #11: updater menambah retry jaringan terbatas dan detail penyebab `fetch failed`; koneksi live dari TokoPanel tetap harus diuji.
- 2026-10-29 — PR #10: unduhan YouTube kualitas terbaik mencoba yt-dlp dan melaporkan resolusi/FPS hasil aktual; verifikasi runtime tetap diperlukan.
- 2026-10-22 — Normalisasi pesan dan fallback `m.reply()`/`m.react()` ditangani di layer bersama; pertahankan dan regression-test, jangan menghapus hanya karena satu plugin bisa berjalan.
- Perubahan historis lain dan format pencatatannya ada di `docs/AI_CHANGELOG.md`.

## Perbaikan router command
- Prefix matcher pada `handler.js` harus mengkloning setiap RegExp prefix dan menghapus flag `g/y` sebelum `exec()`; regex prefix global/sticky yang dibagi antar-plugin dapat mengubah `lastIndex` dan membuat command terlewat.
- Pilih kandidat prefix hanya jika hasil `exec()` benar-benar cocok, bukan hanya karena objek RegExp tersedia.
- Saat command image tidak menampilkan log `[IMAGE]`, periksa tahap routing prefix terlebih dahulu sebelum menyimpulkan API gambar bermasalah.

- 2026-10-30 — Perbaikan pembacaan foto reply AI Image Converter: plugin kini mengambil contextInfo.quotedMessage dari payload Baileys asli sebelum fallback serializer, mengekstrak imageMessage, dan memakai conn.downloadM(imageMessage, 'image') bila q.download() tidak menghasilkan buffer. Uji live WhatsApp tetap diperlukan.

## Diagnostik command image
- Untuk command `.toreal`/konversi image yang tidak merespons, periksa log `[COMMAND TRACE]` sebelum mengubah API gambar. Trace mencatat prefix aktif dan kandidat plugin yang cocok, tanpa isi media/kredensial.
- Jika ada kandidat image tetapi tidak ada `[IMAGE] ▶ Mulai`, telusuri tahap plugin loop, status disabled, dan tipe export plugin. Jika `[IMAGE] ▶ Mulai` muncul, lanjutkan ke tahap download/upload/API.


## LightJurnal Video Studio — deployment notes (2026-11-04)
- `main.js` starts the optional HTTP server when `PORT` or Pterodactyl's `SERVER_PORT` is present; `server.js` listens on `PORT` first, then `SERVER_PORT`.
- Video Studio API creates a 256-bit random API key on first startup when `VIDEO_STUDIO_API_KEY` is not set. It persists at `~/.alvareth-bot-data/video-studio/api-key` (or under `ALVARETH_DATA_DIR`) with mode 0600. Do not commit this file or disclose its contents in logs/chat.
- LightJurnal still requires a public HTTPS URL and the generated key in the browser session. A raw Pterodactyl TCP allocation is not automatically HTTPS; configure a reverse proxy or Cloudflare Tunnel before calling the deployment live.
- Do not claim deployment is complete until dependency installation, health check, authenticated limits request, and a real short MP4 render have succeeded on the user's Pterodactyl instance.

Current media invariant: local numerical loopback URLs, redirects rejected, no hosted AI fallback. VoxCPM2 Python source pinned; model must be local. Single bot worker only. SFX time uses Scene startFrame (including transition handle), not speechStartFrame. Validator must retain music/caption metadata and up to 60 voice tracks.
