import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAllowedDevOrigins } from '../next.config';

test('derives the development origin hostname from BETTER_AUTH_URL', () => {
  assert.deepEqual(
    resolveAllowedDevOrigins({ BETTER_AUTH_URL: 'http://dev.example.internal:3000' }),
    ['dev.example.internal'],
  );
});

test('appends explicit development origins without duplicates', () => {
  assert.deepEqual(
    resolveAllowedDevOrigins({
      BETTER_AUTH_URL: 'https://ads.example.internal',
      ALLOWED_DEV_ORIGINS: 'localhost, ads.example.internal, 192.168.1.20',
    }),
    ['ads.example.internal', 'localhost', '192.168.1.20'],
  );
  assert.deepEqual(
    resolveAllowedDevOrigins({ ALLOWED_DEV_ORIGINS: '  , localhost, localhost ' }),
    ['localhost'],
  );
});

test('rejects development origins with a protocol or port', () => {
  for (const origin of ['http://ads.example.internal', 'ads.example.internal:3000']) {
    assert.throws(
      () => resolveAllowedDevOrigins({ ALLOWED_DEV_ORIGINS: origin }),
      /ALLOWED_DEV_ORIGINS must contain hostnames without protocol or port/,
    );
  }
});

test('rejects an invalid BETTER_AUTH_URL', () => {
  assert.throws(
    () => resolveAllowedDevOrigins({ BETTER_AUTH_URL: 'dev.example.internal:3000' }),
    /BETTER_AUTH_URL must be a valid absolute URL/,
  );
});

test('keeps the development origin allowlist empty when no origins are configured', () => {
  assert.deepEqual(resolveAllowedDevOrigins({}), []);
});
