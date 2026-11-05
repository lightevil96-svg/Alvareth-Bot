import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const cwd = process.cwd();

function log(message) {
  console.log('[STARTUP] ' + message);
}

// Keep the Baileys compatibility patch, but never fetch, merge, or apply
// repository updates during startup. The owner controls updates with .update.
function applyBaileys405CompatibilityPatch() {
  let entry;
  try {
    entry = require.resolve('baileys');
  } catch (error) {
    log(`Baileys 405 patch dilewati: modul tidak dapat ditemukan (${error.message}).`);
    return false;
  }

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
  log('Mode update manual aktif. Gunakan .update untuk memeriksa dan menerapkan pembaruan.');
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

launchBot().catch(error => {
  console.error('[STARTUP] Error fatal:', error);
  process.exitCode = 1;
});
