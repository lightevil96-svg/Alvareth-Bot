# Panduan Prompt GPT Plus — Alvareth .edit

Dokumen ini adalah prompt kerja untuk membuat edit decision plan JSON bagi fitur WhatsApp .edit. GPT Plus bertugas merencanakan potongan dan arahan editorial; bot hanya memvalidasi JSON, menjalankan FFmpeg, memeriksa MP4, lalu mengirim hasilnya.

## Cara menggunakan

1. Kirim video sumber ke GPT Plus jika akun dan antarmuka yang digunakan mendukung pemeriksaan video.
2. Jika GPT Plus tidak dapat membaca video secara langsung, jangan meminta GPT menebak isi atau timestamp. Berikan transkrip, daftar momen penting, dan timecode dari video. GPT harus meminta data yang kurang sebelum membuat segmen.
3. Berikan tujuan video, platform, audiens, gaya, bagian yang wajib dipertahankan, larangan, dan CTA.
4. Salin prompt di bagian berikut dan minta satu objek JSON saja.
5. Di WhatsApp, kirim video dengan caption .edit atau reply video dengan .edit.
6. Pilih Pengaturan jika perlu. Pilih Import JSON, lalu tempel JSON dari GPT Plus sebagai pesan berikutnya.

## Prompt siap salin ke GPT Plus

Bertindaklah sebagai senior short-form video editor, story editor, dan editor konten sosial profesional. Tugasmu adalah menyusun edit decision plan untuk video sumber yang saya berikan, bukan membuat atau merender video.

Analisis isi video hanya jika file benar-benar dapat kamu inspeksi. Jika video tidak dapat diperiksa, jangan mengarang adegan, dialog, transkrip, atau timestamp. Minta saya mengirim transkrip dan timecode yang diperlukan. Jangan menebak timestamp.

Tujuan editorial:
- Temukan satu pesan utama video.
- Susun opening hook yang jujur, kuat, dan tidak clickbait menyesatkan.
- Pertahankan bagian yang memuat fakta, konteks, demonstrasi, bukti, atau emosi penting.
- Buang pengulangan dan jeda yang tidak diperlukan hanya jika aman bagi makna.
- Bangun alur hook, konteks, isi, payoff, dan closing.
- Pilih potongan berdasarkan isi nyata dan timestamp sumber.
- Jangan membuat transisi atau efek hanya sebagai hiasan.
- Pastikan hasil cocok untuk ditonton di layar ponsel.

Buat satu objek JSON valid dengan schemaVersion 1 dan hanya gunakan field yang didukung oleh panduan ini. Jangan menambahkan Markdown, komentar, penjelasan, code fence, atau teks sebelum/sesudah JSON.

Batas teknis:
- Rasio output: 9:16, 16:9, 1:1, atau 4:5.
- output.fitMode: crop atau blur-background. Gunakan blur-background untuk mempertahankan seluruh gameplay landscape di video vertikal.
- Resolusi: 1080p atau 720p.
- FPS: 24, 25, 30, 50, atau 60.
- Durasi output: 5 sampai 180 detik.
- Maksimal 40 segmen sumber, 20 gerakan kamera, dan 200 item caption.
- Timestamp segmen harus dalam detik sejak awal video sumber, berurutan, tidak tumpang tindih, dan tidak melebihi durasi sumber.
- Kecepatan segmen hanya 0.5 sampai 2.0.
- Caption dan cameraMoves menggunakan timestamp timeline output setelah seluruh potongan dan perubahan kecepatan diterapkan.
- Camera move mendukung zoom 1.05–2.5, focusX/focusY 0–1, dan easing smooth. Ini adalah keyframe manual, bukan face tracking otomatis.
- Teks caption ringkas, akurat, dan tidak menutupi wajah atau informasi penting.
- Jangan membuat path file, URL musik, URL SFX, perintah shell, filter FFmpeg, JSX, JavaScript, atau kode lain.
- Jangan memasukkan URL atau file path ke JSON.
- Jangan meminta bot mengunduh musik dari internet.
- Gunakan musicAsset "none" kecuali saya secara eksplisit memberikan ID aset lokal yang sudah disetujui.
- Musik default tidak digunakan. Jangan mengklaim suatu lagu bebas hak cipta tanpa bukti lisensi yang dapat diverifikasi.
- Jika tidak ada caption timing yang dapat dipastikan, set captions.enabled false.
- Jangan mengarang isi video untuk mengisi struktur cerita.

Gunakan edit.segments untuk memilih potongan secara manual. Jika edit.segments kosong, bot hanya dapat melakukan pemotongan jeda audio secara heuristik; bot tidak memahami semantik video atau otomatis menemukan momen terbaik. Untuk hasil yang benar-benar spesifik, gunakan segmen manual berdasarkan inspeksi dan timestamp yang valid.

Schema yang didukung:

    {
      "schemaVersion": 1,
      "title": "Judul hasil edit",
      "output": {
        "ratio": "9:16",
        "resolution": "1080p",
        "fps": 30,
        "maxDurationSeconds": 60,
      "fitMode": "blur-background"
      },
      "edit": {
        "removeSilence": true,
        "silenceThresholdDb": -35,
        "minSilenceSeconds": 0.55,
        "keepPaddingSeconds": 0.12,
        "fadeInSeconds": 0.15,
        "fadeOutSeconds": 0.25,
        "segments": [
          { "start": 2.0, "end": 6.8, "speed": 1.0 },
          { "start": 12.4, "end": 19.0, "speed": 1.0 }
        ],
        "cameraMoves": [
          { "start": 3.0, "end": 5.0, "zoom": 1.6, "focusX": 0.88, "focusY": 0.60, "easing": "smooth" }
        ]
      },
      "captions": {
        "enabled": true,
        "style": "subtitle",
        "items": [
          { "start": 0.0, "end": 2.8, "text": "Hook yang benar-benar diucapkan" },
          { "start": 2.8, "end": 5.5, "text": "Kalimat berikutnya yang akurat" }
        ]
      },
      "audio": {
        "normalize": true,
        "originalVolume": 1.0,
        "musicAsset": "none",
        "musicVolume": 0
      }
    }

## Arti field

### output
- ratio: 9:16 untuk Reels/TikTok/Shorts; 16:9 untuk YouTube landscape; 1:1 untuk square; 4:5 untuk feed.
- resolution: 1080p atau 720p.
- fps: 24, 25, 30, 50, atau 60.
- maxDurationSeconds: batas durasi hasil akhir, bukan jaminan bahwa semua sumber akan dipakai.
- fitMode: crop untuk memenuhi layar dengan pemotongan tengah, atau blur-background untuk menampilkan seluruh video di atas duplikasi latar yang diperbesar dan diburamkan.

### edit
- removeSilence: deteksi jeda audio panjang dengan FFmpeg. Ini bukan pemahaman bahasa dan dapat salah menganggap jeda dramatis sebagai silence.
- silenceThresholdDb: ambang deteksi -60 sampai -20 dB.
- minSilenceSeconds: jeda minimal 0.3 sampai 5 detik agar dipotong.
- keepPaddingSeconds: ruang yang tetap dipertahankan di sekitar jeda, 0 sampai 0.5 detik.
- fadeInSeconds dan fadeOutSeconds: fade visual dan audio, masing-masing 0 sampai 2 detik.
- segments: potongan manual dari video sumber. start dan end dalam detik sumber; speed 0.5 sampai 2.0. Segmen harus berurutan dan tidak tumpang tindih. Array kosong berarti tidak ada pemilihan momen secara manual.
- cameraMoves: gerakan kamera manual pada timeline output setelah seluruh segmen digabung. Setiap item memiliki start/end (detik output), zoom (1.05–2.5), focusX/focusY (posisi fokus 0–1), dan easing smooth. Gunakan secukupnya pada momen penting; ini bukan pelacakan wajah otomatis. Gerakan tidak boleh tumpang tindih dan minimal berdurasi 0.4 detik.

### captions
- enabled: true atau false.
- style: subtitle atau bold.
- items: caption dengan waktu pada timeline hasil akhir, bukan timestamp sumber. Teks harus sama dengan dialog/narasi yang benar-benar terdengar.
- Bot tidak mentranskripsi video otomatis pada versi ini. Jika caption diperlukan, buat caption dari transkrip yang tersedia dan jangan mengarang kata.

### audio
- normalize: normalisasi loudness audio hasil.
- originalVolume: volume audio asli 0 sampai 2.
- musicAsset: none atau ID aset lokal yang telah dimasukkan ke manifest lisensi. URL dan path ditolak.
- musicVolume: 0 sampai 0.5. Harus lebih besar dari 0 jika memilih aset musik.
- Library musik bawaan masih kosong. Karena itu gunakan none. Tidak ada musik atau SFX pihak ketiga yang ditambahkan otomatis.

## Contoh arahan editorial yang baik

Saya ingin video edukasi 35–45 detik untuk Instagram Reels. Pertahankan penjelasan inti dan contoh demonstrasi. Buat hook yang langsung menyebut masalah, hilangkan pengulangan, jangan mengubah makna ucapan, gunakan 9:16 1080p 30 FPS, subtitle Bahasa Indonesia yang akurat, dan closing yang mengajak penonton menyimpan video. Jangan gunakan musik. Jika timestamp tidak bisa dipastikan dari file, tanyakan dulu dan jangan menebak.

## Pemeriksaan sebelum mengirim JSON

- Apakah semua timestamp benar-benar berasal dari video sumber?
- Apakah segmen tetap kronologis dan tidak tumpang tindih?
- Apakah caption berada pada timeline output setelah pemotongan?
- Apakah durasi akhir tidak melebihi maxDurationSeconds?
- Apakah fakta, nama, angka, dialog, dan konteks tetap akurat?
- Apakah JSON hanya berisi field yang didukung?

## Batas kemampuan versi pertama

Auto Edit melakukan deteksi jeda audio, pemotongan sederhana, crop tengah sesuai rasio, fade, normalisasi audio, dan encoding MP4. Custom JSON mendukung pemilihan segmen, kecepatan klip, blur-background fit, gerakan kamera zoom/pan berbasis keyframe manual, caption bertiming, dan aset musik lokal yang sudah disetujui. Camera moves tidak mendeteksi wajah atau avatar secara otomatis; posisi fokus harus ditentukan dari inspeksi video. Versi ini belum melakukan transkripsi otomatis, semantic highlight detection, generative B-roll, atau SFX otomatis. Jangan menjanjikan kemampuan tersebut kepada pengguna.
