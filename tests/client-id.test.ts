import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientId } from '../lib/client-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function withoutRandomUUID<T>(run: () => T): T {
  const cryptoObj = globalThis.crypto;
  const original = cryptoObj.randomUUID;
  Object.defineProperty(cryptoObj, 'randomUUID', { configurable: true, value: undefined });
  try {
    return run();
  } finally {
    Object.defineProperty(cryptoObj, 'randomUUID', { configurable: true, value: original });
  }
}

test('clientId returns a UUID v4 when crypto.randomUUID is unavailable', () => {
  const ids = withoutRandomUUID(() => [clientId(), clientId()]);
  for (const id of ids) assert.match(id, UUID_V4);
  assert.notEqual(ids[0], ids[1]);
});

test('clientId uses crypto.randomUUID when the secure context provides it', () => {
  assert.match(clientId(), UUID_V4);
});
