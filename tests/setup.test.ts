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

test('setup wizard loads ad accounts through the supported accounts query', async () => {
  const { setupAccountsPath, setupAccountsFromResponse } = await import('../app/setup/setup-accounts');
  assert.equal(setupAccountsPath, 'meta?kind=accounts');
  const response = {
    data: [],
    available: [
      { id: 'act_1', name: 'Activa', account_status: 1 },
      { id: 'act_2', name: 'Deshabilitada', account_status: 2 },
    ],
    selectedAccounts: [],
  };
  assert.deepEqual(setupAccountsFromResponse(response), {
    accounts: response.available,
    selected: ['act_1'],
  });
});

test('setup wizard selects every account when none is active', async () => {
  const { setupAccountsFromResponse } = await import('../app/setup/setup-accounts');
  const available = [{ id: 'act_3', name: 'Pendiente', account_status: 3 }];
  assert.deepEqual(setupAccountsFromResponse({ data: available }), { accounts: available, selected: ['act_3'] });
  assert.deepEqual(setupAccountsFromResponse({}), { accounts: [], selected: [] });
});
