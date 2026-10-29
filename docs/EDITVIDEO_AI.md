# AI Video Editing di Alvareth-Bot

Plugin: `plugins/tools/editvideo.js` (perintah `.editvideo` atau `.vedit`).

## Kebutuhan dasar

- FFmpeg dan ffprobe tersedia di `PATH`.
- Perintah `.editvideo` dan `.vedit` hanya dapat digunakan owner bot.
- API key Groq disimpan melalui `.ragebait apikey gsk_...`.
- Plugin tidak menerapkan batas tetap untuk ukuran video, durasi, atau ukuran hasil. Kapasitas disk/RAM/CPU TokoPanel, koneksi, timeout pengaman, dan batas kirim WhatsApp tetap berlaku.

## Fitur

- Instruksi bahasa biasa untuk trim, crop 9:16/1:1/16:9, teks, subtitle manual, perbaikan warna, musik, serta fade awal/akhir.
- Smart clip memilih jendela berdasarkan aktivitas audio dan kepadatan pergantian adegan yang dideteksi FFmpeg. Ini heuristik sinyal, bukan pengenalan semantik atas isi video.
- Zoom dinamis dengan gerakan halus di area tengah. Ini bukan pelacakan wajah/objek.
- Efek whoosh sintetis opsional di beberapa pergantian adegan yang terdeteksi.
- Subtitle otomatis opsional melalui whisper.cpp yang dijalankan lokal.
- Untuk YouTube, plugin menormalisasi tautan `watch`, `live`, `shorts`, `embed`, dan `youtu.be`. Jika API downloader pihak ketiga gagal (misalnya HTTP 530), otomatis dicoba fallback ke binary resmi yt-dlp, dengan Node.js sebagai runtime challenge YouTube.

## Mengaktifkan subtitle otomatis (opsional)

Pasang/build `whisper.cpp` di server dan unduh model GGML yang sesuai. Pastikan executable `whisper-cli` bisa dijalankan oleh user bot. Atur environment variable pada panel:

- `WHISPER_CPP_BIN=/path/to/whisper-cli` (opsional; default `whisper-cli`)
- `WHISPER_MODEL_PATH=/path/to/ggml-small.bin` (wajib untuk subtitle otomatis)

Model Whisper memakai disk dan RAM tambahan. Mulai dengan model kecil bila resource panel terbatas. Jika executable/model belum tersedia, fitur edit lain tetap dapat digunakan; permintaan subtitle otomatis akan memberikan pesan error konfigurasi yang jelas.

## Contoh

```text
.editvideo https://www.youtube.com/live/VIDEO_ID | ambil bagian paling menarik 30 detik, crop vertikal 9:16, zoom dinamis, transisi fade dan efek suara
```

Balas video WhatsApp dengan instruksi yang sama untuk mengedit video yang dikirim di chat.

## Proyek open-source yang menjadi referensi

- Auto-Editor: https://github.com/WyattBlue/auto-editor (pemotongan otomatis berdasarkan aktivitas audio; Unlicense).
- PySceneDetect: https://github.com/Breakthrough/PySceneDetect (deteksi potongan adegan; BSD-3-Clause).
- whisper.cpp: https://github.com/ggml-org/whisper.cpp (transkripsi lokal; MIT).

Implementasi bot saat ini memakai FFmpeg untuk scene/silence sampling supaya tidak memaksa instalasi Python/OpenCV di setiap server. whisper.cpp adalah opsi tambahan hanya untuk auto-subtitle.
