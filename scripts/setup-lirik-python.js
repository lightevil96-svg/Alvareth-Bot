import { ensureLirikPythonDependencies } from '../lib/lirik-python.js'

const skipped = /^(1|true)$/i.test(String(process.env.CI || '')) ||
  /^(1|true)$/i.test(String(process.env.ALVARETH_SKIP_LIRIK_PYTHON_SETUP || ''))

if (skipped) {
  console.log('[LIRIK SETUP] Dilewati oleh environment CI/ALVARETH_SKIP_LIRIK_PYTHON_SETUP.')
} else {
  try {
    const result = await ensureLirikPythonDependencies({ root: process.cwd() })
    console.log(result.installed
      ? '[LIRIK SETUP] Dependensi Python berhasil dipasang.'
      : '[LIRIK SETUP] Dependensi Python sudah siap; tidak perlu instalasi ulang.')
  } catch (error) {
    // Do not fail npm install or block a code update. The manual .update path
    // runs the same setup again and reports a detailed error to the owner.
    console.warn('[LIRIK SETUP] Belum siap: ' + String(error?.message || error).slice(0, 1200))
  }
}
