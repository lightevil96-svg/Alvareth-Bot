# Panduan Prompt Remotion — Alvareth Bot

**Tujuan:** menjadi kontrak kerja bagi model AI eksternal saat menyusun storyboard untuk fitur WhatsApp `.remotion`. Output model AI eksternal akan ditempel langsung ke bot. Bot tidak lagi menjalankan Ollama atau LLM lokal untuk menyusun cerita; bot hanya mem-parsing, menormalisasi, memvalidasi, mengompilasi, dan merender JSON yang diberikan.

## 1. Cara menggunakan panduan ini

Saat pengguna meminta dibuatkan video untuk Alvareth Remotion:

1. Pahami brief pengguna dan pertahankan maksud, karakter, produk, bahasa, fakta, larangan, serta CTA yang disebutkan.
2. Susun konsep, alur cerita, visual bible, character bible bila dibutuhkan, pembagian scene, narasi, subtitle, motion, transisi, dan arahan audio.
3. Periksa semua batas teknis pada dokumen ini.
4. Keluarkan **satu objek JSON valid** sesuai schema di bawah. Jangan menambahkan penjelasan sebelum atau sesudah JSON. Jangan memakai komentar, trailing comma, `undefined`, `NaN`, atau JavaScript.
5. Pengguna menyalin seluruh JSON dan mengirimkannya melalui `.remotion generate` atau langsung setelah `.remotion`.

Jangan menyuruh bot menafsirkan brief teks bebas. Brief bebas harus diolah di model AI eksternal terlebih dahulu.

## 2. Pipeline dan batas kemampuan yang benar

Alur runtime saat ini:

`Brief pengguna → model AI eksternal (di luar bot) → storyboard JSON → parser/normalizer → compiler → validator → antrean → media lokal opsional → Remotion/FFmpeg → MP4 → WhatsApp`.

- **model AI eksternal:** menyusun storyboard. Bot tidak memanggil API model bahasa, Ollama, atau layanan inferensi lain.
- **Parser/normalizer/compiler:** menerima JSON, menerapkan default aman, membatasi enum, menghitung durasi, dan mengubah storyboard menjadi payload Remotion.
- **Voice-over:** provider default adalah Edge TTS online melalui paket `edge-tts`, menggunakan suara Neural Bahasa Indonesia dan word-boundary timing. Provider ini gratis digunakan tanpa API key atau model GPU, tetapi merupakan klien tidak resmi terhadap layanan Edge online sehingga ketersediaan dan kebijakannya dapat berubah. VoxCPM2 tetap tersedia sebagai opsi lokal yang lebih berat dan dapat lebih lambat pada CPU. Provider dan suara dipilih melalui `.remotion voice`.
- **Subtitle:** `captionStyle` menentukan gaya caption. Edge TTS mengirim metadata `WordBoundary` sehingga timing kata dapat diambil langsung dari hasil sintesis. Jika metadata tidak tersedia, runtime memperkirakan timing caption dari durasi audio terukur dan bobot kata/tanda baca; hasilnya perkiraan, bukan forced alignment. VoxCPM2 memakai alignment lokal hanya jika aligner opsional dikonfigurasi.
- **AI footage:** opsional melalui workflow ComfyUI lokal yang sudah ditinjau. Default pipeline hanya memilih maksimal **2 scene** untuk AI video (dapat diubah operator, maksimum 4). Setiap klip yang dihasilkan dibatasi 3–8 detik. Workflow yang tidak dikonfigurasi berarti footage AI tidak dibuat.
- **Character reference:** satu referensi karakter dapat dibuat jika image workflow ComfyUI aktif dan workflow video memakai placeholder `{{REFERENCE_IMAGE}}`. Ini membantu kontinuitas, tetapi tidak menjamin karakter identik di semua frame/klip.
- **Remotion:** merender komposisi berdasarkan data tervalidasi. Tanpa footage ComfyUI, visual tetap dapat dirender sebagai motion graphics, tetapi jangan menyebut hasilnya sebagai animasi 3D penuh atau footage sinematik nyata.
- **Audio tambahan:** SFX prosedural lokal tersedia. Musik tidak wajib dan default-nya tidak ada. Jangan mengarang bahwa musik AI atau efek audio spesifik tersedia jika workflow/provider tidak dikonfigurasi.

**Penting:** fitur 3D dalam brief harus diterjemahkan menjadi `aiVideoPrompt` yang konkret untuk scene terpilih. Jika ComfyUI video workflow tidak aktif, bot hanya dapat menggunakan komposisi/motion graphics yang tersedia. Jangan menjanjikan hasil visual yang tidak didukung runtime.

## 3. Aturan stabilitas storyboard

### Durasi dan scene

- `scenes` harus berisi 1–60 scene.
- Durasi awal setiap scene pada storyboard berada di rentang 2,4–20 detik; total video maksimal 300 detik (5 menit).
- Untuk video 15–30 detik, umumnya gunakan 4–7 scene. Untuk 30–60 detik, umumnya 5–9 scene. Pilih berdasarkan cerita, bukan angka kaku.
- Durasi scene tidak boleh dibuat seragam hanya demi merapikan angka. Tentukan berdasarkan panjang voice-over, kebutuhan baca teks, aksi visual, dan jeda emosional.
- Estimasi awal: narasi sekitar 2,55 kata/detik ditambah ruang napas; teks layar sekitar 3,1 kata/detik ditambah waktu baca. Layout `quote` dapat membutuhkan waktu visual lebih panjang.
- **Durasi final scene yang memiliki voice-over dihitung ulang oleh runtime berdasarkan durasi audio TTS yang benar-benar dihasilkan:** minimal 1,25 detik atau durasi audio ditambah 0,25 detik ruang visual, mana yang lebih panjang. Durasi awal dari AI tidak akan memaksa scene tetap panjang ketika audio lebih pendek.
- Scene tanpa voice-over tetap memakai durasi storyboard. Jika pengguna meminta jeda visual setelah narasi, buat scene lanjutan tanpa narration; jangan memperpanjang scene bernarasi secara arbitrer.
- **Jangan memadatkan narasi agar muat ke durasi yang tidak realistis.** Jika jumlah kata membutuhkan waktu lebih lama, ringkas narasi atau naikkan `targetDurationSeconds`. Normalizer menolak target storyboard yang lebih pendek daripada estimasi minimum.
- Usahakan durasi setiap scene tidak lebih dari 20 detik. Jika satu scene membutuhkan lebih dari itu, pecah menjadi dua scene.
- Isi `targetDurationSeconds` dengan angka jika durasi diminta. Gunakan `null` jika pengguna tidak menentukan durasi dan jangan mengarang durasi eksplisit. Durasi final dapat berubah mengikuti hasil TTS aktual.

### Narasi dan teks layar

- `narration` adalah kalimat yang benar-benar diucapkan voice-over. Tulis natural, enak didengar, sesuai bahasa yang diminta, dan hindari kalimat terlalu panjang.
- Bagi narasi per scene. Satu scene idealnya menyampaikan satu gagasan yang utuh. Jangan mengulang narasi scene sebelumnya atau menumpuk seluruh cerita di satu scene.
- `text` adalah headline singkat, bukan salinan narasi: idealnya 3–8 kata dan maksimal sekitar 55 karakter. Gunakan frasa yang kuat dan mudah dipindai dalam sekali lihat.
- `subtext` adalah keterangan pendukung: idealnya satu kalimat pendek, maksimal sekitar 100 karakter. Kosongkan jika tidak menambah informasi.
- `kicker` idealnya 1–3 kata dan maksimal sekitar 24 karakter; `highlight` idealnya 1–4 kata dan maksimal sekitar 28 karakter.
- `points` maksimal 4 butir; idealnya maksimal 45 karakter per butir. Satu butir hanya memuat satu informasi.
- Hindari paragraf panjang, huruf kapital penuh untuk kalimat panjang, pengulangan headline di subtext, serta menaruh seluruh voice-over sebagai teks layar.
- Runtime mengukur dan membungkus headline sesuai lebar layar, tetapi model tetap wajib membuat teks ringkas agar komposisi tidak padat.
- Untuk `data-chart`, `diagram`, `app-mockup`, dan `waveform`, visual ditempatkan di sisi kanan dan headline/subtext di sisi kiri. Jangan menaruh teks penting di area visual atau membuat label diagram terlalu panjang.
- `narration` maksimal 1.200 karakter per scene, tetapi untuk video pendek sebaiknya jauh lebih ringkas.
- Untuk subtitle biasa, pilih `captionStyle: "subtitle"`. Jangan memasukkan teks subtitle ke `text` sekaligus menyalin seluruh narasi.

### Konsistensi visual

- Tetapkan satu gaya visual melalui `visualBible`: art style, palet, pencahayaan, bahasa kamera, tekstur, dan aturan komposisi.
- Gunakan palet yang sama atau harmonis di seluruh scene. Warna `background` dan `accent` wajib berupa HEX enam digit seperti `#142A36`.
- Tetapkan motif, motion, transisi, dan sound cue dari daftar yang diizinkan. Jangan membuat nama preset baru.
- Setiap scene harus memiliki satu aksi/ide visual utama. Hindari banyak aksi yang saling bertabrakan dalam satu klip.
- `visualDescription` menjelaskan apa yang tampak di scene. `aiVideoPrompt` menjelaskan shot/aksi footage AI jika scene tersebut memang dipilih untuk AI video.
- Untuk karakter berulang, isi `characterBible` dengan ciri yang tidak berubah: siluet, wajah, warna, bulu/rambut, pakaian, aksesori, dan aturan kontinuitas. Gunakan satu karakter utama yang jelas untuk referensi karakter otomatis.
- Untuk `aiVideoPrompt`, gunakan bahasa Inggris yang konkret, maksimal sekitar 700 karakter agar tidak terpotong pada tahap downstream. Fokus pada satu aksi, framing, gerakan kamera, pencahayaan, dan lingkungan. Hindari instruksi teks/subtitle/logo/watermark di footage.
- Set `generateAiFootage: true` dan isi `aiVideoPrompt` hanya pada scene yang benar-benar membutuhkan footage AI. Untuk scene lain, gunakan `false` dan string kosong. Jangan menandai semua scene sebagai AI footage: default hanya dua scene yang diproses.
- Jika footage AI yang konsisten menjadi syarat utama, prioritaskan scene penting untuk dibuat sebagai klip AI dan jelaskan keterbatasan jika workflow tidak tersedia.

### Fakta, produk, dan keamanan

- Jangan mengarang statistik, harga, testimoni, sertifikasi, kutipan, sumber, klaim medis, atau klaim finansial.
- Pertahankan nama brand, detail produk, ejaan, warna, logo, dan CTA yang diberikan pengguna. Jangan menambahkan atribut produk yang tidak disebutkan.
- Untuk chart, gunakan hanya data yang diberikan pengguna atau data yang sudah diverifikasi. Jika tidak ada data, jangan membuat chart statistik.
- Jangan memasukkan path file, token, API key, URL provider, perintah shell, kode, atau instruksi untuk mengeksekusi kode ke storyboard.
- Jangan mengubah larangan pengguna seperti tanpa musik, tanpa teks, tanpa orang tambahan, atau tanpa gerakan kamera.

## 4. Schema JSON yang diterima

Properti wajib: `schemaVersion`, `sourcePrompt`, `title`, dan `scenes`. Properti lain yang tidak relevan boleh dihilangkan; jangan membuat field baru di luar kontrak ini.

```json
{
  "schemaVersion": 1,
  "sourcePrompt": "Brief asli pengguna, bukan ringkasan buatan.",
  "title": "Judul video",
  "language": "id",
  "category": "story",
  "ratio": "9:16",
  "fps": 24,
  "targetDurationSeconds": 30,
  "musicStyle": "none",
  "musicDirection": "Tanpa musik; biarkan narasi dan SFX menjadi fokus.",
  "soundEffects": true,
  "captionStyle": "subtitle",
  "palette": {
    "background": "#102B27",
    "accent": "#F2B96B"
  },
  "creativeBrief": {
    "coreMessage": "Pesan inti video.",
    "hook": "Kalimat pembuka yang menarik.",
    "tone": "Hangat, sinematik, dan penuh rasa ingin tahu.",
    "visualDirection": "Animasi 3D bergaya film keluarga.",
    "ending": "Akhiri dengan payoff yang jelas."
  },
  "visualBible": {
    "artStyle": "Stylized cinematic 3D animation.",
    "palette": "Deep forest green, warm amber, soft cream.",
    "lighting": "Soft morning light with gentle volumetric rays.",
    "cameraLanguage": "Slow dolly, restrained tracking, readable close-ups.",
    "texture": "Soft detailed fur, natural leaves, subtle atmospheric depth.",
    "compositionRules": "One clear focal subject; preserve mobile-safe framing."
  },
  "characterBible": {
    "name": "Nama karakter utama",
    "type": "Jenis karakter",
    "silhouette": "Bentuk tubuh dan ciri siluet.",
    "face": "Ciri wajah dan mata.",
    "hairOrFur": "Warna dan tekstur rambut/bulu.",
    "outfit": "Pakaian yang selalu sama.",
    "colors": "Palet warna karakter.",
    "accessories": "Aksesori tetap.",
    "personality": "Sifat karakter.",
    "continuityRules": [
      "Pertahankan bentuk wajah, warna bulu, proporsi, pakaian, dan aksesori di seluruh scene."
    ]
  },
  "scenes": [
    {
      "id": "scene-01",
      "purpose": "hook",
      "durationSeconds": 5,
      "layout": "hero",
      "motif": "rings",
      "motion": "fade-up",
      "transition": "fade",
      "kicker": "AWAL PETUALANGAN",
      "text": "Headline singkat",
      "highlight": "Kata penting",
      "subtext": "Keterangan singkat jika diperlukan.",
      "points": [],
      "narration": "Kalimat voice-over yang diucapkan pada scene ini.",
      "visualDescription": "Deskripsi visual yang jelas dan dapat diwujudkan oleh renderer.",
      "generateAiFootage": false,
      "aiVideoPrompt": "",
      "visualType": "cinematic",
      "backgroundEffect": "particles",
      "cameraMotion": "push-in",
      "colorGrade": "warm",
      "soundIntensity": 0.55,
      "soundCue": "whoosh",
      "background": "#102B27",
      "accent": "#F2B96B"
    }
  ]
}
```

### Nilai enum yang diizinkan

| Field | Nilai yang diizinkan |
| --- | --- |
| `category` | `educational`, `explainer`, `product`, `story`, `announcement`, `tutorial`, `documentary`, `finance`, `other` |
| `ratio` | `9:16`, `16:9`, `1:1` |
| `fps` | `24`, `25`, `30` |
| `musicStyle` | `cinematic`, `upbeat`, `calm`, `none` |
| `captionStyle` | `tiktok`, `karaoke`, `subtitle`, `pop`, `typewriter`, `highlight`, `wave` |
| `layout` | `hero`, `editorial`, `split`, `stat`, `quote`, `steps`, `outro` |
| `motif` | `rings`, `orbit`, `wave`, `grid`, `bars`, `ribbon`, `spark`, `none` |
| `motion` | `fade-up`, `scale-in`, `slide-left`, `slide-right`, `reveal`, `float`, `count-up` |
| `transition` | `cut`, `fade`, `crossfade`, `wipe`, `wipe-left`, `wipe-right`, `wipe-up`, `wipe-down`, `slide`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `zoom`, `glitch`, `dissolve`, `flash`, `dip-to-black` |
| `visualType` | `cinematic`, `kinetic`, `editorial`, `data-chart`, `diagram`, `app-mockup`, `waveform` |
| `backgroundEffect` | `none`, `orbs`, `particles`, `grid`, `waves`, `dots`, `vignette` |
| `cameraMotion` | `static`, `push-in`, `pull-out`, `pan-left`, `pan-right`, `tilt-up`, `tilt-down`, `drift` |
| `colorGrade` | `neutral`, `warm`, `cool`, `film`, `vivid`, `mono` |
| `soundCue` | `none`, `whoosh`, `pop`, `impact`, `swish`, `click`, `chime`, `thump`, `sparkle`, `riser` |

## 5. Field reference

### Root fields

- `schemaVersion`: harus angka `1`.
- `sourcePrompt`: brief asli, minimal 8 karakter, maksimal 6.000 karakter.
- `title`: maksimal 100 karakter.
- `language`: kode bahasa singkat, gunakan `id` untuk Bahasa Indonesia.
- `category`: pilih satu kategori dari enum.
- `ratio`: default `9:16` untuk Reels/TikTok/Shorts; `16:9` untuk YouTube landscape; `1:1` bila diminta.
- `fps`: hanya 24, 25, atau 30.
- `targetDurationSeconds`: angka 1–300 atau `null`.
- `palette`: opsional; `background` dan `accent` harus HEX `#RRGGBB`.
- `musicStyle`: gunakan `none` jika pengguna tidak meminta musik.
- `soundEffects`: boolean.
- `musicDirection`: catatan singkat, maksimal 240 karakter; ini bukan file musik.
- `creativeBrief`: `coreMessage` 300, `hook` 220, `tone` 120, `visualDirection` 300, `ending` 220 karakter.
- `visualBible`: masing-masing field maksimal 180 karakter, `compositionRules` maksimal 240.
- `characterBible`: boleh `null`; field teks dibatasi 80–180 karakter; `continuityRules` maksimal 8 aturan, masing-masing maksimal 160 karakter.

### Scene fields

- `id`: ID stabil seperti `scene-01`.
- `purpose`: fungsi scene seperti `hook`, `setup`, `discovery`, `conflict`, `payoff`, atau `outro`.
- `durationSeconds`: angka positif; normalizer menjaga batas 2,4–20 detik dan menyesuaikan target total tanpa memotong kebutuhan minimum narasi.
- `text` atau `onScreenText`: salah satu wajib; maksimal 180 karakter.
- `subtext`: maksimal 220 karakter.
- `narration`: maksimal 1.200 karakter; kosongkan jika tidak ada voice-over.
- `points`: maksimal 4 string.
- `visualDescription`: maksimal 400 karakter.
- `generateAiFootage`: boolean.
- `aiVideoPrompt`: maksimal 1.800 karakter pada schema, tetapi gunakan maksimal sekitar 700 karakter karena tahap ComfyUI mengambil bagian awal hingga 800 karakter setelah identitas karakter/style ditambahkan.
- `visualType`, `layout`, `motif`, `motion`, `transition`, `backgroundEffect`, `cameraMotion`, `colorGrade`, `soundCue`: wajib mengikuti enum.
- `chartTitle`, `chartUnit`, `chartSource`, `chartData`: gunakan hanya untuk visualisasi data yang benar-benar didukung sumber.
- `chartData`: maksimal 8 item `{ "label": "...", "value": 0 }`.
- `diagramNodes`: maksimal 7 item; setiap node memiliki `id`, `label`, dan koordinat opsional `x` 8–92, `y` 15–85.
- `diagramEdges`: maksimal 10 item; `from` dan `to` harus menunjuk ID node yang ada.
- `appMockup`: `title`, `rows` (maksimal 5), dan `cta`.
- `notifications`: maksimal 3 item; `delaySeconds` 0–18, `durationSeconds` 0,8–8.
- `callouts`: maksimal 3 item; posisi `top`, `center`, atau `bottom`; delay 0–18 dan durasi 0,8–8.
- `soundIntensity`: angka 0–1.
- `background`, `accent`: warna HEX `#RRGGBB`.

Jangan menambahkan `footageSrc`, `musicTrackSrc`, `voiceoverTracks`, `captions`, atau path file. Semua aset hasil produksi harus dibuat dan dikelola runtime.

## 6. Contoh lengkap — rubah menjelajahi hutan

Contoh ini menggambarkan target storyboard 30 detik dengan lima scene, narasi Bahasa Indonesia, subtitle, satu karakter utama, dan dua scene prioritas AI footage. Dua scene tersebut hanya benar-benar menjadi klip AI jika workflow ComfyUI yang sesuai sudah aktif.

```json
{
  "schemaVersion": 1,
  "sourcePrompt": "Buat video animasi 3D pendek tentang seekor rubah yang menjelajahi hutan. Gunakan narasi Bahasa Indonesia dan subtitle sinkron.",
  "title": "Rumi dan Cahaya Hutan",
  "language": "id",
  "category": "story",
  "ratio": "9:16",
  "fps": 24,
  "targetDurationSeconds": 30,
  "musicStyle": "none",
  "musicDirection": "Tanpa musik; utamakan narasi, ambience, dan SFX ringan.",
  "soundEffects": true,
  "captionStyle": "subtitle",
  "palette": {
    "background": "#102B27",
    "accent": "#F2B96B"
  },
  "creativeBrief": {
    "coreMessage": "Keberanian tumbuh ketika rasa ingin tahu mendorong kita mengambil langkah pertama.",
    "hook": "Pagi itu, Rumi menemukan sesuatu yang belum pernah ia lihat.",
    "tone": "Hangat, penuh rasa ingin tahu, sinematik, dan ramah keluarga.",
    "visualDirection": "Stylized cinematic 3D animation in an enchanted forest.",
    "ending": "Rumi pulang dengan pengalaman baru dan hati yang lebih berani."
  },
  "visualBible": {
    "artStyle": "Stylized cinematic 3D animated family-adventure film.",
    "palette": "Deep forest green, moss, warm amber, soft cream.",
    "lighting": "Soft morning rays through leaves, subtle volumetric light, warm rim light.",
    "cameraLanguage": "Gentle dolly-in, low tracking shots, restrained close-ups, no frantic camera shake.",
    "texture": "Soft detailed fur, natural leaves, moss, rich but clean environment.",
    "compositionRules": "Keep Rumi readable as the focal subject; use mobile-safe framing and uncluttered backgrounds."
  },
  "characterBible": {
    "name": "Rumi",
    "type": "Rubah merah kecil.",
    "silhouette": "Tubuh mungil, telinga sedikit besar, ekor tebal dengan ujung putih.",
    "face": "Mata amber ekspresif, moncong krem, hidung kecil gelap.",
    "hairOrFur": "Bulu merah karat lembut, dada krem, ujung ekor putih.",
    "outfit": "Syal biru tua sederhana yang selalu terpasang.",
    "colors": "Merah karat, krem, putih, dan biru tua.",
    "accessories": "Syal biru tua.",
    "personality": "Penasaran, lembut, sedikit pemalu, tetapi berani mencoba.",
    "continuityRules": [
      "Pertahankan bentuk wajah, ukuran telinga, warna bulu, dada krem, dan ujung ekor putih.",
      "Syal biru tua harus tetap sama pada setiap scene.",
      "Jangan mengubah proporsi tubuh, warna mata, atau desain karakter."
    ]
  },
  "scenes": [
    {
      "id": "scene-01",
      "purpose": "hook",
      "durationSeconds": 5,
      "layout": "hero",
      "motif": "orbit",
      "motion": "fade-up",
      "transition": "fade",
      "kicker": "PAGI DI HUTAN",
      "text": "Hutan mulai terbangun",
      "highlight": "terbangun",
      "subtext": "Satu petualangan kecil segera dimulai.",
      "narration": "Saat matahari menyentuh pucuk pepohonan, Rumi memulai petualangannya.",
      "visualDescription": "Wide establishing view of a lush forest at sunrise, soft mist between trees, warm rays entering the clearing.",
      "generateAiFootage": true,
      "aiVideoPrompt": "A gentle cinematic establishing shot of a lush enchanted forest at sunrise. Soft mist drifts between tall trees as warm golden rays pass through the canopy. Slow forward dolly, subtle leaves moving in a light breeze, peaceful magical atmosphere, polished stylized 3D family animation.",
      "visualType": "cinematic",
      "backgroundEffect": "vignette",
      "cameraMotion": "static",
      "colorGrade": "warm",
      "soundIntensity": 0.45,
      "soundCue": "whoosh",
      "background": "#102B27",
      "accent": "#F2B96B"
    },
    {
      "id": "scene-02",
      "purpose": "discovery",
      "durationSeconds": 6,
      "layout": "editorial",
      "motif": "wave",
      "motion": "slide-left",
      "transition": "crossfade",
      "kicker": "JEJAK MISTERIUS",
      "text": "Jejak kecil di tanah",
      "highlight": "jejak",
      "subtext": "Rumi menemukan sesuatu yang terasa asing.",
      "narration": "Di antara dedaunan basah, ia menemukan jejak yang belum pernah dilihatnya.",
      "visualDescription": "Close view of tiny paw prints on damp moss and leaves; Rumi cautiously inspects them.",
      "generateAiFootage": false,
      "aiVideoPrompt": "",
      "visualType": "cinematic",
      "backgroundEffect": "particles",
      "cameraMotion": "push-in",
      "colorGrade": "warm",
      "soundIntensity": 0.4,
      "soundCue": "none",
      "background": "#102B27",
      "accent": "#F2B96B"
    },
    {
      "id": "scene-03",
      "purpose": "wonder",
      "durationSeconds": 7,
      "layout": "split",
      "motif": "spark",
      "motion": "reveal",
      "transition": "dissolve",
      "kicker": "CAHAYA KECIL",
      "text": "Ada cahaya di balik semak",
      "highlight": "cahaya",
      "subtext": "Rasa ingin tahu membuat Rumi mendekat.",
      "narration": "Sebuah cahaya kecil berkelip, membuat Rumi penasaran dan mendekat perlahan.",
      "visualDescription": "Rumi notices a tiny golden glow between fern leaves; the firefly flickers softly in the shaded forest.",
      "generateAiFootage": true,
      "aiVideoPrompt": "A small curious fox slowly approaches a single glowing golden firefly between lush fern leaves. The firefly pulses gently and illuminates the fox's eyes. Slow low-angle tracking shot, delicate floating particles, intimate cinematic close-up, polished stylized 3D family animation.",
      "visualType": "cinematic",
      "backgroundEffect": "particles",
      "cameraMotion": "static",
      "colorGrade": "warm",
      "soundIntensity": 0.6,
      "soundCue": "sparkle",
      "background": "#102B27",
      "accent": "#F2B96B"
    },
    {
      "id": "scene-04",
      "purpose": "payoff",
      "durationSeconds": 6,
      "layout": "editorial",
      "motif": "rings",
      "motion": "float",
      "transition": "wipe",
      "kicker": "BERANI MENDEKAT",
      "text": "Keberanian tumbuh perlahan",
      "highlight": "keberanian",
      "subtext": "Rumi membantu kunang-kunang menemukan jalan.",
      "narration": "Meski sempat takut, Rumi melangkah mendekat dan menemukan kunang-kunang yang tersesat.",
      "visualDescription": "Rumi gently guides the firefly toward a brighter opening in the trees; warm light fills the clearing.",
      "generateAiFootage": false,
      "aiVideoPrompt": "",
      "visualType": "cinematic",
      "backgroundEffect": "orbs",
      "cameraMotion": "drift",
      "colorGrade": "warm",
      "soundIntensity": 0.5,
      "soundCue": "chime",
      "background": "#102B27",
      "accent": "#F2B96B"
    },
    {
      "id": "scene-05",
      "purpose": "outro",
      "durationSeconds": 6,
      "layout": "outro",
      "motif": "spark",
      "motion": "scale-in",
      "transition": "fade",
      "kicker": "LANGKAH PERTAMA",
      "text": "Petualangan baru dimulai",
      "highlight": "dimulai",
      "subtext": "Rasa ingin tahu dapat menuntun pada keberanian.",
      "narration": "Rumi pulang dengan hati hangat, belajar bahwa keberanian dimulai dari satu langkah kecil.",
      "visualDescription": "Rumi stands on a sunlit forest path, looking back with a gentle smile as the firefly glows in the distance.",
      "generateAiFootage": false,
      "aiVideoPrompt": "",
      "visualType": "cinematic",
      "backgroundEffect": "vignette",
      "cameraMotion": "static",
      "colorGrade": "warm",
      "soundIntensity": 0.35,
      "soundCue": "chime",
      "background": "#102B27",
      "accent": "#F2B96B"
    }
  ]
}
```

## 7. Pemeriksaan sebelum mengeluarkan JSON

Lakukan checklist internal berikut:

- [ ] JSON dapat diparse; tidak ada komentar, trailing comma, atau teks di luar objek.
- [ ] `schemaVersion` tepat angka `1`.
- [ ] `sourcePrompt` berisi brief asli.
- [ ] `scenes` berisi 1–60 scene dan setiap scene memiliki `text` atau `onScreenText`.
- [ ] Semua enum tepat dari allowlist.
- [ ] Semua warna HEX valid.
- [ ] Setiap scene 2,4–20 detik dan total tidak melebihi 300 detik.
- [ ] Target durasi tidak lebih pendek daripada estimasi total narasi dan teks.
- [ ] Narasi tersegmentasi, natural, dan tidak dipaksakan terlalu cepat.
- [ ] Teks layar ringkas dan tidak menduplikasi seluruh voice-over.
- [ ] Karakter, palet, pencahayaan, dan bahasa kamera konsisten.
- [ ] Hanya 1–2 scene prioritas yang meminta AI footage kecuali pengguna meminta lebih dan operator menaikkan batas.
- [ ] Klaim faktual tidak dibuat-buat.
- [ ] Tidak ada file path, URL provider, secret, atau executable code.
- [ ] Ukuran seluruh input di bawah 24.000 karakter.

Jika satu pemeriksaan gagal, perbaiki JSON sebelum mengirimkannya kepada pengguna. Jangan menyuruh pengguna mencoba berulang kali dengan JSON yang belum divalidasi.
