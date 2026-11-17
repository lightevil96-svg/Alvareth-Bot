# Fitur .lirik

Perintah ini membuat transkrip lirik dari audio/video menggunakan model lokal:

- **faster-whisper** untuk mengenali vokal/audio dan memberi timestamp.
- **RapidOCR** untuk membaca teks yang tampil di dalam video.
- **FFmpeg/FFprobe** untuk ekstraksi audio dan pemeriksaan durasi.
- Tidak menggunakan Gemini API key dan tidak mengirim media ke layanan transkripsi pihak ketiga.

## Persiapan server

**Instalasi otomatis melalui perintah .update:**

- Saat .update menerapkan versi baru, updater membuat virtual environment .venv-lirik dan memasang faster-whisper, RapidOCR, serta OpenCV.
- Jika tidak ada pembaruan kode, .update tetap memeriksa dan memperbaiki instalasi Python.
- Saat npm install dijalankan, postinstall juga mencoba menyiapkan dependensi .lirik.
- Bot otomatis memilih Python dari .venv-lirik; ALVARETH_LIRIK_PYTHON tetap dapat digunakan untuk override manual.

Server harus menyediakan Python 3.10+ dengan modul venv serta FFmpeg/FFprobe. Pada Debian/Ubuntu, paket sistem yang diperlukan adalah python3-venv, python3-pip, dan ffmpeg. Jika venv tidak tersedia pada hosting, minta penyedia hosting mengaktifkannya.

Untuk instalasi manual atau pemulihan, jalankan dari folder utama bot:

    node scripts/install-lirik-deps.js --strict

Model Whisper akan diunduh otomatis pada penggunaan pertama saat transkripsi dijalankan. Instalasi paket Python pertama kali dapat memerlukan beberapa menit dan ruang disk tambahan.

## YouTube meminta verifikasi akun

Jika YouTube menampilkan pesan "Sign in to confirm you're not a bot", bot akan mencoba provider unduhan cadangan yang sudah tersedia. Jika provider itu juga tidak dapat mengambil video, gunakan cookies YouTube milik sendiri:

1. Di komputer pribadi, buat profil browser khusus yang hanya digunakan untuk YouTube dan login ke akun YouTube milikmu.
2. Dengan yt-dlp terpasang di komputer tersebut, ekspor cookies ke format Netscape:

       yt-dlp --cookies-from-browser chrome --cookies youtube-cookies.txt --skip-download "https://www.youtube.com/watch?v=VIDEO_ID"

   Ganti chrome sesuai browser yang dipakai. Jangan gunakan profil browser utama yang berisi sesi email, perbankan, atau layanan sensitif.
3. Unggah file youtube-cookies.txt melalui File Manager TokoPanel ke folder utama bot, di dalam folder .alvareth-bot-data, sehingga path akhirnya:
   
       .alvareth-bot-data/youtube-cookies.txt

4. Pastikan file hanya dapat dibaca akun server (izin 600 jika tersedia), lalu restart bot.

Secara default, downloader mencari path tersebut tanpa perlu variabel tambahan. Jika ingin menyimpan file di lokasi lain, isi YTDLP_COOKIES_FILE dengan path absolut, misalnya /home/container/private/youtube-cookies.txt.

Cookies adalah kredensial sesi akun. Jangan kirim file ini ke WhatsApp, jangan commit ke GitHub, jangan tempelkan isinya di chat, dan hapus/rotasi cookies jika pernah terekspos. Cookies dapat kedaluwarsa; ekspor ulang jika YouTube kembali meminta login.

## Variabel lingkungan opsional

| Variabel | Default | Fungsi |
|---|---:|---|
| ALVARETH_LIRIK_PYTHON | python3 | Perintah Python |
| ALVARETH_LIRIK_WHISPER_MODEL | small | Model faster-whisper, misalnya small atau large-v3-turbo |
| ALVARETH_LIRIK_WHISPER_DEVICE | auto | Perangkat inferensi |
| ALVARETH_LIRIK_COMPUTE_TYPE | int8 | Tipe komputasi |
| ALVARETH_LIRIK_LANGUAGE | otomatis | Kode bahasa Whisper, misalnya id atau en |
| ALVARETH_LIRIK_OCR_FPS | 1.0 | Sampel frame OCR per detik |
| ALVARETH_LIRIK_MAX_BYTES | 209715200 | Batas ukuran input (200 MiB) |
| ALVARETH_LIRIK_MAX_DURATION_SECONDS | 1800 | Batas durasi (30 menit) |

## Cara menggunakan di WhatsApp

- Reply/kutip video atau audio, lalu ketik .lirik.
- Atau kirim .lirik https://youtu.be/VIDEO_ID.
- Ketik .lirik status untuk melihat status proses yang sedang berjalan.

Bot mengirim dua berkas: TXT bertimestamp dan subtitle SRT. Segmen audio dan teks layar diberi label berbeda agar hasil OCR tidak tercampur seolah-olah diucapkan.

## Catatan akurasi

Whisper dapat keliru mengenali vokal yang dinyanyikan, musik yang keras, aksen, atau bagian instrumental. OCR hanya membaca tulisan yang terlihat pada frame sampel; teks yang muncul singkat di antara sampel dapat terlewat. Periksa hasil dengan media asli sebelum dipublikasikan.

Untuk YouTube yang meminta autentikasi, downloader memakai mekanisme YTDLP_COOKIES_FILE privat yang sama dengan fitur clip. Jangan mengirim file cookies melalui WhatsApp atau menyimpannya di Git.
