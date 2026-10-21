import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPOSITORY_BRANCH = process.env.AUTO_UPDATE_BRANCH || 'main';
const CHECK_INTERVAL_MS = Math.max(1, Number(process.env.AUTO_UPDATE_INTERVAL_MINUTES || 10)) * 60_000;
const APP_NAME = process.env.PM2_APP_NAME || 'alvareth-bot';
let checking = false;

function log(message) {
  console.log('[AUTO-UPDATE]', message);
}

async function git(args) {
  return execFileAsync('git', args, {
    cwd: process.cwd(),
    timeout: 120_000,
    maxBuffer: 5 * 1024 * 1024
  });
}

async function checkForUpdate() {
  if (checking || process.env.AUTO_UPDATE_ENABLED === 'false') return;
  checking = true;

  try {
    // This updater intentionally requires a Git checkout and a PM2-managed bot.
    await git(['rev-parse', '--is-inside-work-tree']);

    // Do not overwrite edits to tracked files made directly on the server.
    const { stdout: unstaged } = await git(['diff', '--quiet']).catch(async error => {
      if (error.code === 1) return { stdout: 'modified' };
      throw error;
    });
    const { stdout: staged } = await git(['diff', '--cached', '--quiet']).catch(async error => {
      if (error.code === 1) return { stdout: 'modified' };
      throw error;
    });
    if (unstaged || staged) {
      log('Pembaruan dilewati: ada perubahan lokal pada file yang dilacak Git.');
      return;
    }

    await git(['fetch', '--quiet', 'origin', REPOSITORY_BRANCH]);
    const { stdout: commits } = await git([
      'rev-list', '--count', `HEAD..origin/${REPOSITORY_BRANCH}`
    ]);
    if (Number(commits.trim()) < 1) return;

    // Confirm PM2 is available before changing the working tree.
    await execFileAsync('pm2', ['describe', APP_NAME], {
      cwd: process.cwd(), timeout: 15_000, maxBuffer: 1024 * 1024
    });

    const { stdout: changedFiles } = await git([
      'diff', '--name-only', 'HEAD', `origin/${REPOSITORY_BRANCH}`
    ]);
    const filesToUpdate = changedFiles
      .split('\n')
      .map(file => file.trim())
      .filter(Boolean);

    if (filesToUpdate.length === 0) {
      log('Ada commit baru, tetapi tidak ada file yang perlu diperbarui.');
      return;
    }

    log(`Ditemukan ${commits.trim()} commit baru. File yang berubah:`);
    for (const file of filesToUpdate) log(`  • ${file}`);

    // Fast-forward Git applies only the changed files from these commits;
    // ignored runtime data (.env, WhatsApp sessions, and database files) stays untouched.
    await git(['pull', '--ff-only', 'origin', REPOSITORY_BRANCH]);

    if (changedFiles.split('\n').some(file =>
      ['package.json', 'package-lock.json'].includes(file.trim())
    )) {
      log('Perubahan dependency terdeteksi; menjalankan npm install.');
      await execFileAsync('npm', ['install', '--omit=dev'], {
        cwd: process.cwd(), timeout: 10 * 60_000, maxBuffer: 5 * 1024 * 1024
      });
    }

    log(`Pembaruan berhasil diambil; merestart PM2: ${APP_NAME}.`);
    await execFileAsync('pm2', ['restart', APP_NAME], {
      cwd: process.cwd(), timeout: 60_000, maxBuffer: 2 * 1024 * 1024
    });
  } catch (error) {
    const message = error?.stderr?.toString?.().trim() || error?.message || String(error);
    log(`Pengecekan gagal atau auto-update tidak tersedia: ${message}`);
  } finally {
    checking = false;
  }
}

export function startAutoUpdate() {
  if (process.env.AUTO_UPDATE_ENABLED === 'false') {
    log('Dinonaktifkan melalui AUTO_UPDATE_ENABLED=false.');
    return;
  }
  log(`Pemantauan GitHub aktif; branch=${REPOSITORY_BRANCH}, interval=${CHECK_INTERVAL_MS / 60_000} menit.`);
  // Delay the first check so the bot can finish starting up.
  setTimeout(checkForUpdate, 60_000).unref?.();
  setInterval(checkForUpdate, CHECK_INTERVAL_MS).unref?.();
}
