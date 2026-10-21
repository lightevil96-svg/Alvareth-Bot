# Alvareth Bot

**Alvareth Bot** adalah bot WhatsApp Multi-Device berbasis Node.js, Baileys, dan sistem plugin. Nama owner yang ditampilkan: **Light V**.

Struktur proyek ini dibuat dengan mempertahankan struktur SC yang diberikan: `index.js`, `main.js`, `handler.js`, `config.js`, `plugins/`, `lib/`, `json/`, dan aset di `media/`.

## Fitur

- Sistem plugin untuk menu, utilitas, downloader, permainan, sticker, AI, dan manajemen grup.
- Konfigurasi identitas bot serta nomor bot/owner melalui `.env`.
- GitHub Actions untuk mengirim kode terbaru ke VPS ketika ada `push` ke branch `main`.
- Restart otomatis dengan PM2 setelah kode dikirim.
- File sesi WhatsApp dan `.env` dikecualikan dari sinkronisasi agar tidak terhapus saat deployment.

## Persiapan lokal / VPS

Kebutuhan runtime: Node.js 22+, npm, Git (opsional), FFmpeg, ImageMagick, WebP tools, dan PM2. Pada VPS berbasis Debian/Ubuntu, pasang juga `rsync` karena workflow GitHub menggunakannya.

```bash
cp .env.example .env
nano .env
npm install
npm start
```

Isi `BOT_NUMBER` dengan nomor akun WhatsApp yang akan dipasangkan dan `OWNER_NUMBER` dengan nomor WhatsApp owner, dalam format internasional **angka saja** (tanpa `+` atau spasi). `OWNER_NAME` sudah diset ke `Light V`. Jangan jalankan bot sebelum nomor owner diganti dari contoh pada `.env.example`.

Untuk menjalankan stabil di VPS:

```bash
npm install -g pm2
pm2 start index.js --name alvareth-bot
pm2 save
pm2 startup
```

Jalankan perintah yang ditampilkan oleh `pm2 startup` jika diminta. Setelah itu, pantau log dengan `pm2 logs alvareth-bot`.

## Aktifkan auto-deploy GitHub

1. Buat repository GitHub milikmu dan push isi proyek ini ke branch `main`.
2. Di VPS, siapkan folder deploy (default `/opt/alvareth-bot`), Node.js, npm, `rsync`, dependensi sistem di atas, serta PM2. Pastikan user SSH punya hak menulis ke folder tersebut.
3. Buat file `.env` di folder deploy. **Jangan commit `.env` ke GitHub.**
4. Tambahkan repository secrets berikut di **Settings → Secrets and variables → Actions**:

   | Secret | Isi |
   | --- | --- |
   | `DEPLOY_HOST` | IP/domain VPS |
   | `DEPLOY_USER` | User SSH untuk deploy |
   | `DEPLOY_SSH_KEY` | Private SSH key khusus deployment |
   | `DEPLOY_PORT` | Port SSH; opsional, default `22` |
   | `DEPLOY_PATH` | Folder bot; opsional, default `/opt/alvareth-bot` |
   | `DEPLOY_KNOWN_HOST` | Baris host key SSH yang sudah diverifikasi; direkomendasikan |

5. Pastikan public key pasangan `DEPLOY_SSH_KEY` sudah ditambahkan ke `~/.ssh/authorized_keys` milik user deploy di VPS. Untuk keamanan, gunakan user khusus yang hanya bisa mengelola folder bot, bukan login root.
6. Push commit ke `main`. Buka tab **Actions** di GitHub untuk melihat status deploy. Workflow akan upload kode, menjalankan `npm install`, lalu me-restart proses `alvareth-bot` melalui PM2.

Jika nama branch utama bukan `main`, ubah bagian `on.push.branches` di `.github/workflows/deploy.yml` sesuai branch yang dipakai.

### Perhatian soal `.env` dan sesi

Workflow sengaja mengecualikan `.env`, `sessions/`, `auth_info/`, `auth_info_baileys/`, `.baileys_auth_info/`, `database/`, `database.json`, `data.json`, `lib/chat.json`, dan `node_modules/` saat sinkronisasi. Database chat akan dibuat otomatis jika belum ada dan tidak ditimpa pada deployment berikutnya. Buat `.env` langsung di VPS sebelum deployment pertama. Folder sesi tidak boleh masuk GitHub karena berisi kredensial login WhatsApp. Kode dari setiap commit yang berhasil di-push akan dijalankan di server; hanya push perubahan dari sumber yang kamu percaya.

## Docker (opsional)

```bash
cp .env.example .env
# Edit .env terlebih dahulu
docker compose up -d --build
```

## Catatan audit kode

`main.js` telah diganti dengan implementasi yang dapat dibaca untuk pairing code/QR, reconnect, loader plugin rekursif, dan lowdb. Perubahan ini menghilangkan obfuscation pada `main.js`, tetapi **bukan audit keamanan menyeluruh** atas semua plugin, dependensi, atau endpoint pihak ketiga. Tetap periksa sumber plugin dan jangan commit `.env` atau `sessions/`.

Beberapa fitur menggunakan API pihak ketiga dan dapat berubah sewaktu-waktu. Aset gambar di `media/` masih memakai aset dari arsip sumber; ganti `media/ryo.jpg` dan `media/thumbnail.jpg` jika ingin branding visual yang sepenuhnya baru.

## Lisensi dan atribusi

Berkas `LICENSE` dari SC sumber tetap disertakan. Karena proyek ini memanfaatkan struktur dan kode yang diwarisi dari arsip sumber, pertahankan lisensi dan atribusi yang berlaku saat kamu membagikan ulang atau memodifikasinya.
