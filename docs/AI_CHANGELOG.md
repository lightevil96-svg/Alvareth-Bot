# AI Change Log — Alvareth Bot

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
