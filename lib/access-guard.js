import { timingSafeEqual } from 'node:crypto';

/**
 * Compare the access key supplied by the operator with the private password
 * configured on the host. Never log either value.
 */
export function isAccessAllowed(
  expected = process.env.ALVARETH_ACCESS_PASSWORD,
  supplied = process.env.ALVARETH_ACCESS_KEY
) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false;
  if (!expected.length || !supplied.length) return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  if (expectedBuffer.length !== suppliedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function enforceAccess() {
  const expected = process.env.ALVARETH_ACCESS_PASSWORD;
  const supplied = process.env.ALVARETH_ACCESS_KEY;

  if (typeof expected !== 'string' || !expected.trim()) {
    console.error('[ACCESS] Password akses belum dikonfigurasi di environment server.');
    console.error('[ACCESS] Atur ALVARETH_ACCESS_PASSWORD pada file .env privat, lalu mulai ulang.');
    process.exit(1);
  }

  if (!isAccessAllowed(expected, supplied)) {
    console.error('[ACCESS] Akses ditolak. ALVARETH_ACCESS_KEY tidak ada atau tidak cocok.');
    console.error('[ACCESS] Minta password akses kepada pengelola instalasi Alvareth-Bot.');
    process.exit(1);
  }

  console.log('[ACCESS] Password diterima. Akses Alvareth-Bot diizinkan.');
}
