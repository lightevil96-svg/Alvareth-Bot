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

- **Koneksi WhatsApp tertutup saat fitur mengirim balasan:** sebelum `conn.sendMessage`, periksa `conn.ws.readyState` bila tersedia. Status `3` berarti socket sudah tertutup; jangan retry pengiriman laporan error pada socket yang sama. Pertahankan error utama downloader/proses di terminal dan jadwalkan reconnect melalui lifecycle socket, bukan dengan mengirim pesan tambahan.
- **File manager `.download`:** browser hanya boleh membaca root `ALVARETH_DOWNLOAD_DIR` (default `./downloads`), tidak menampilkan dotfiles atau symlink, memverifikasi setiap komponen path, dan mengirim file sebagai dokumen setelah validasi ukuran. Row ID list WhatsApp diproses sebagai command oleh normalisasi `listResponseMessage.singleSelectReply.selectedRowId` di `handler.js`; jangan menghapus jalur routing ini. Hasil akhir `.clip` disimpan di subfolder `clip` agar dapat diambil kembali lewat `.download`.

- **Pesan WhatsApp dan serializer/media reply:** periksa `handler.js` dan `lib/simple.js` terlebih dahulu. `handler.js` mempertahankan payload `rawMessage.message` sebelum plugin dijalankan agar `contextInfo.quotedMessage` dan wrapper media tidak hilang saat protobuf `fromObject()` menormalisasi pesan. Untuk plugin yang membaca media reply, gunakan `getQuotedMediaInfo(m)` dan `downloadQuotedMedia(m, conn)` dari `lib/simple.js`; jangan mengandalkan `m.quoted.mimetype` saja karena MIME bisa tidak terbawa, sedangkan tipe `imageMessage`/`videoMessage` masih tersedia. Helper bersama mencari `contextInfo.quotedMessage` di payload mentah dan menembus wrapper media. Jangan membuat deteksi media terpisah di setiap plugin. Uji foto, video, audio, dokumen, stiker, ephemeral, view-once, pesan grup, chat pribadi, dan pesan dengan caption.
- **AutoDL:** `lib/auto-download.js` memetakan satu URL dari host yang didukung ke plugin downloader yang ada. `handler.js` memproses pesan biasa sebagai synthetic command hanya saat cocok, tanpa mengubah `m.text` atau melewati cek izin/limit. Chat pribadi aktif secara default (termasuk satu URL teks dari akun WhatsApp yang sama meski `fromMe === true`), grup harus `.enable autodl`; link dari bot sendiri diabaikan. `runAutoDownloadJob` membatasi dua unduhan paralel dengan antrean maksimal delapan. **Router lama** `plugins/anu/_autodl.js` masih menangani layanan tambahan dan kasus TikTok link polos dari akun sendiri, tetapi harus mengabaikan `m.autoDownload` untuk mencegah duplikasi; pemilihan prefix pada router lama memakai `findAutoDownloadPrefix()` dari helper yang sama agar prefix regex/default konsisten. Jangan mengaktifkan dua router pada pesan yang sama atau menambah unduhan di `plugin.all`. `plugins/downloader/tiktok.js` menggunakan teks masuk bila `m.autoDownload` agar quoted media tidak mengganti link yang dideteksi.
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
