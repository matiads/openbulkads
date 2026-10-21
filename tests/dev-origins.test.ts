import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveAllowedDevOrigins } from '../lib/dev-origins';

test('resolveAllowedDevOrigins extracts hostname from BETTER_AUTH_URL', () => {
  const origins = resolveAllowedDevOrigins({
    BETTER_AUTH_URL: 'http://devbox.example.ts.net:3000',
  });
  assert.deepEqual(origins, ['devbox.example.ts.net']);
});

test('resolveAllowedDevOrigins ignores localhost and loopback IP from BETTER_AUTH_URL', () => {
  assert.deepEqual(resolveAllowedDevOrigins({ BETTER_AUTH_URL: 'http://localhost:3000' }), []);
  assert.deepEqual(resolveAllowedDevOrigins({ BETTER_AUTH_URL: 'http://127.0.0.1:3000' }), []);
});

test('resolveAllowedDevOrigins merges and deduplicates ALLOWED_DEV_ORIGINS', () => {
  const origins = resolveAllowedDevOrigins({
    BETTER_AUTH_URL: 'https://app.custom.internal',
    ALLOWED_DEV_ORIGINS: 'app.custom.internal, 192.168.1.50, other.domain.com ',
  });
  assert.deepEqual(origins, ['app.custom.internal', '192.168.1.50', 'other.domain.com']);
});

test('resolveAllowedDevOrigins handles empty or malformed input safely', () => {
  assert.deepEqual(resolveAllowedDevOrigins({}), []);
  assert.deepEqual(resolveAllowedDevOrigins({ BETTER_AUTH_URL: 'not-a-url' }), []);
  assert.deepEqual(resolveAllowedDevOrigins({ ALLOWED_DEV_ORIGINS: '  ,  , ' }), []);
});
