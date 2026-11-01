import test from 'node:test';
import assert from 'node:assert/strict';
import { isAccessAllowed } from '../lib/access-guard.js';

test('menolak password yang belum diatur', () => {
  assert.equal(isAccessAllowed('', 'secret'), false);
  assert.equal(isAccessAllowed('secret', ''), false);
  assert.equal(isAccessAllowed(undefined, 'secret'), false);
  assert.equal(isAccessAllowed('secret', undefined), false);
});

test('menolak password yang tidak cocok', () => {
  assert.equal(isAccessAllowed('password-benar', 'password-salah'), false);
  assert.equal(isAccessAllowed('password', 'password '), false);
});

test('menerima password yang cocok persis', () => {
  assert.equal(isAccessAllowed('Kunci-Rahasia-2026!', 'Kunci-Rahasia-2026!'), true);
});
