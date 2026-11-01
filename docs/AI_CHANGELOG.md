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
