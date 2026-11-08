const DEFAULT_INTERVAL_MINUTES = 10;
const STARTUP_DELAY_MS = 90_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 24 * 60 * 60_000;

function boundedIntervalMinutes(value) {
  const parsed = Number(value);
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MINUTES;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, minutes * 60_000));
}

const CHECK_INTERVAL_MS = boundedIntervalMinutes(process.env.AUTO_UPDATE_INTERVAL_MINUTES);
let checking = false;
let started = false;

function log(message) {
  console.log('[AUTO-UPDATE]', message);
}

export async function runAutomaticUpdate(updater = global.plugins?.['owner/update.js']) {
  if (process.env.AUTO_UPDATE_ENABLED === 'false') return false;
  if ((Number(global.__alvarethRenderJobs) || 0) > 0) {
    log('Pemeriksaan ditunda karena render sedang berjalan.');
    return false;
  }
  if (checking || global.__alvarethUpdateRunning) return false;
  if (typeof updater !== 'function') {
    log('Updater belum tersedia; pemeriksaan akan dicoba lagi pada interval berikutnya.');
    return false;
  }

  checking = true;
  try {
    await updater({
      async reply(message) {
        const summary = String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
        if (summary) log(summary);
      }
    }, { isOwner: true });
    return true;
  } catch (error) {
    log('Pemeriksaan otomatis gagal: ' + String(error?.message || error).slice(0, 500));
    return false;
  } finally {
    checking = false;
  }
}

export function startAutoUpdate() {
  if (started) return false;
  if (process.env.AUTO_UPDATE_ENABLED === 'false') {
    log('Dinonaktifkan melalui AUTO_UPDATE_ENABLED=false.');
    return false;
  }

  started = true;
  log('Pembaruan otomatis aktif; branch=' + (process.env.AUTO_UPDATE_BRANCH || 'main') +
    ', pemeriksaan pertama dalam 90 detik, interval=' + (CHECK_INTERVAL_MS / 60_000) + ' menit.');

  const firstCheck = setTimeout(() => { void runAutomaticUpdate(); }, STARTUP_DELAY_MS);
  firstCheck.unref?.();
  const interval = setInterval(() => { void runAutomaticUpdate(); }, CHECK_INTERVAL_MS);
  interval.unref?.();
  return true;
}
