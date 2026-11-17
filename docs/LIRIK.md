# Fitur .lirik

Perintah ini membuat transkrip lirik dari audio/video menggunakan model lokal:

- **faster-whisper** untuk mengenali vokal/audio dan memberi timestamp.
- **RapidOCR** untuk membaca teks yang tampil di dalam video.
- **FFmpeg/FFprobe** untuk ekstraksi audio dan pemeriksaan durasi.
- Tidak menggunakan Gemini API key dan tidak mengirim media ke layanan transkripsi pihak ketiga.

## Persiapan server

Pastikan Python 3.10+ dan FFmpeg/FFprobe tersedia, lalu jalankan perintah berikut di folder utama bot:

    python3 -m pip install -r requirements-lirik.txt

Model Whisper akan diunduh otomatis pada penggunaan pertama. Sediakan ruang disk dan koneksi internet saat pertama kali menjalankan fitur.

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
