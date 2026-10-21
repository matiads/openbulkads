import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginWrite } from '../lib/write-origin';

function request(url: string, headers: Record<string, string>) {
  return new Request(url, { method: 'POST', headers });
}

test('a browser host that differs from the bind address stays same-origin', () => {
  const same = request('http://100.64.0.10:3000/api/settings', {
    origin: 'http://devbox.example.ts.net:3000',
    host: 'devbox.example.ts.net:3000',
  });
  assert.equal(isSameOriginWrite(same), true);
});

test('foreign origins stay blocked when the public host differs from the bind address', () => {
  const foreign = request('http://100.64.0.10:3000/api/settings', {
    origin: 'http://evil.example',
    host: 'devbox.example.ts.net:3000',
  });
  assert.equal(isSameOriginWrite(foreign), false);
});

test('https behind a proxy matches the forwarded scheme, not the internal http URL', () => {
  const proxied = request('http://0.0.0.0:3000/api/settings', {
    origin: 'https://openbulkads.internal',
    host: 'openbulkads.internal',
    'x-forwarded-proto': 'https',
  });
  assert.equal(isSameOriginWrite(proxied), true);
});

test('a scheme mismatch and a missing origin stay blocked', () => {
  const downgrade = request('http://127.0.0.1:3000/api/settings', {
    origin: 'https://app.test',
    host: 'app.test',
  });
  const missing = request('https://app.test/api/settings', { host: 'app.test' });
  assert.equal(isSameOriginWrite(downgrade), false);
  assert.equal(isSameOriginWrite(missing), false);
});
