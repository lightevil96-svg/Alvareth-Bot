import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const cwd = process.cwd();
const branch = process.env.AUTO_UPDATE_BRANCH || 'main';

function log(message) {
  console.log('[STARTUP-UPDATE]', message);
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd,
    timeout: options.timeout || 120_000,
    maxBuffer: 5 * 1024 * 1024,
    ...options
  });
}

async function main() {
  if (process.env.AUTO_UPDATE_ENABLED === 'false') {
    log('Pembaruan otomatis dimatikan; langsung menjalankan bot.');
    await launchBot();
    return;
  }

  try {
    if (!existsSync('.git')) {
      log('Folder .git tidak ditemukan; melewati update GitHub.');
      await launchBot();
      return;
    }

    await run('git', ['rev-parse', '--is-inside-work-tree']);

    const { stdout: status } = await run('git', ['status', '--porcelain', '--untracked-files=no']);
    if (status.trim()) {
      log('Ada perubahan lokal. Demi keamanan, update dilewati agar pekerjaan lokal tidak tertimpa.');
      await launchBot();
      return;
    }

    log(`Memeriksa pembaruan origin/${branch}...`);
    await run('git', ['fetch', '--quiet', 'origin', branch]);

    const { stdout: countText } = await run('git', [
      'rev-list', '--count', `HEAD..origin/${branch}`
    ]);
    const count = Number(countText.trim());

    if (!Number.isFinite(count) || count < 1) {
      log('SC sudah versi terbaru.');
      await launchBot();
      return;
    }

    const { stdout: changed } = await run('git', [
      'diff', '--name-only', 'HEAD', `origin/${branch}`
    ]);
    const files = changed.split('\n').map(x => x.trim()).filter(Boolean);

    log(`Ada ${count} commit baru. File yang akan berubah:`);
    for (const file of files) log(`  • ${file}`);

    await run('git', ['merge', '--ff-only', `origin/${branch}`]);

    if (files.some(file => file === 'package.json' || file === 'package-lock.json')) {
      log('File dependensi berubah; menjalankan npm install...');
      await run('npm', ['install'], { timeout: 10 * 60_000 });
    }

    log('Update selesai. Menjalankan SC versi terbaru.');
  } catch (error) {
    const message = error?.stderr?.toString?.().trim() || error?.message || String(error);
    log(`Update gagal (${message}). Bot akan dijalankan dari versi lokal yang tersedia.`);
  }

  await launchBot();
}

function applyBaileys405CompatibilityPatch() {
  let entry;
  try {
    entry = require.resolve('baileys');
  } catch (error) {
    log(`Baileys 405 patch dilewati: modul tidak dapat ditemukan (${error.message}).`);
    return false;
  }

  // The project uses the npm alias "baileys" -> @itsliaaa/baileys.
  // Patch the library before index.js imports it, so WhatsApp receives the
  // MACOS UserAgent platform required by current companion-device handshakes.
  const candidates = [
    join(dirname(entry), 'Utils', 'validate-connection.js'),
    join(dirname(entry), 'utils', 'validate-connection.js')
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch (error) {
      log(`Baileys 405 patch gagal membaca ${file}: ${error.message}`);
      return false;
    }

    const webPlatformExpression = `platform: config.browser[1].toLocaleLowerCase().includes('android')
            ? proto.ClientPayload.UserAgent.Platform.ANDROID
            : proto.ClientPayload.UserAgent.Platform.WEB`;
    if (source.includes(webPlatformExpression)) {
      const patched = source.replace(
        webPlatformExpression,
        webPlatformExpression.replace(
          'proto.ClientPayload.UserAgent.Platform.WEB',
          'proto.ClientPayload.UserAgent.Platform.MACOS'
        )
      );
      try {
        writeFileSync(file, patched, 'utf8');
        log('Baileys 405 compatibility patch diterapkan: UserAgent platform WEB → MACOS.');
        return true;
      } catch (error) {
        log(`Baileys 405 patch gagal menulis ${file}: ${error.message}`);
        return false;
      }
    }

    if (
      source.includes('platform: config.browser[1].toLocaleLowerCase().includes') &&
      source.includes('proto.ClientPayload.UserAgent.Platform.MACOS')
    ) {
      log('Baileys 405 compatibility patch sudah aktif.');
      return true;
    }
  }

  log('PERINGATAN: kode UserAgent Baileys tidak cocok dengan pola patch 405; file dependensi tidak diubah.');
  return false;
}

async function launchBot() {
  applyBaileys405CompatibilityPatch();
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['index.js', ...process.argv.slice(2)], {
    cwd,
    env: process.env,
    stdio: 'inherit'
  });

  child.on('error', error => {
    console.error('[STARTUP]', error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

main().catch(error => {
  console.error('[STARTUP-UPDATE] Error fatal:', error);
  process.exitCode = 1;
});
