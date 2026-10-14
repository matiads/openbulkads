import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isSetupRequired, assertSetupAllowed } from '../lib/setup-state';
import { setupPath, safeRelativeReturnPath } from '../app/auth-paths';

test('auth-paths exports setupPath returning /setup', () => {
  assert.equal(setupPath(), '/setup');
});

test('safeRelativeReturnPath handles /setup safely', () => {
  assert.equal(safeRelativeReturnPath('/setup'), '/setup');
});

test('isSetupRequired returns true when user table has 0 rows', async () => {
  const fakePool = {
    async query() {
      return { rows: [{ count: 0 }] };
    },
  };
  const required = await isSetupRequired(fakePool);
  assert.equal(required, true);
});

test('isSetupRequired returns false when user table has 1 or more rows', async () => {
  const fakePool = {
    async query() {
      return { rows: [{ count: 1 }] };
    },
  };
  const required = await isSetupRequired(fakePool);
  assert.equal(required, false);
});

test('assertSetupAllowed passes when 0 users exist', async () => {
  const fakePool = {
    async query() {
      return { rows: [{ count: 0 }] };
    },
  };
  await assert.doesNotReject(async () => {
    await assertSetupAllowed(fakePool);
  });
});

test('assertSetupAllowed fails closed with 403 when users already exist', async () => {
  const fakePool = {
    async query() {
      return { rows: [{ count: 2 }] };
    },
  };
  await assert.rejects(
    async () => {
      await assertSetupAllowed(fakePool);
    },
    (err: unknown) => {
      const error = err as { code?: number; message?: string };
      return error.code === 403 && (error.message?.includes('configuración inicial ya fue completada') ?? false);
    }
  );
});
