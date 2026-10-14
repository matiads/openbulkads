import '../scripts/load-env.mjs';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const configPath = '../db/postgres/config.ts';
const mediaRefsPath = '../db/postgres/media-references.ts';
const { getDatabaseUrl } = (await import(configPath)) as typeof import('../db/postgres/config');
const { listProtectedMediaKeys } = (await import(mediaRefsPath)) as typeof import('../db/postgres/media-references');

const pool = new Pool({ connectionString: getDatabaseUrl() });
const owner = `test-${randomUUID()}`;
const ids: string[] = [];

function jobRow(
  id: string,
  status: string,
  payload: string,
  state: string,
) {
  const now = Date.now();
  return {
    id,
    owner,
    kind: 'ad',
    payload,
    state,
    status,
    created: now,
    updated: now,
  };
}

async function insertJob(
  id: string,
  status: string,
  payload: string,
  state: string,
) {
  const j = jobRow(id, status, payload, state);
  await pool.query(
    'INSERT INTO jobs(id,owner,kind,payload,state,status,created,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [j.id, j.owner, j.kind, j.payload, j.state, j.status, j.created, j.updated],
  );
  ids.push(id);
}

test('listProtectedMediaKeys respects job status and JSON shape', async () => {
  const doneId = randomUUID();
  const readyId = randomUUID();
  const failedId = randomUUID();
  const uncertainId = randomUUID();
  const workingId = randomUUID();
  const waitingId = randomUUID();
  const badJsonId = randomUUID();

  const keyDone = `${owner}/done-upload`;
  const keyReady = `${owner}/ready-upload`;
  const keyState = `${owner}/state-key`;
  const keyFailed = `${owner}/failed-upload`;
  const keyUncertain = `${owner}/uncertain-upload`;
  const keyWorking = `${owner}/working-upload`;
  const keyWaiting = `${owner}/waiting-upload`;

  try {
    await insertJob(
      doneId,
      'done',
      JSON.stringify({ source: 'upload', uploadKey: keyDone }),
      JSON.stringify({ key: `${owner}/done-state` }),
    );
    await insertJob(
      readyId,
      'ready',
      JSON.stringify({ source: 'upload', uploadKey: keyReady }),
      '{}',
    );
    await insertJob(
      failedId,
      'failed',
      JSON.stringify({ uploadKey: keyFailed }),
      '{}',
    );
    await insertJob(
      uncertainId,
      'uncertain',
      JSON.stringify({ uploadKey: keyUncertain }),
      '{}',
    );
    await insertJob(
      workingId,
      'working',
      JSON.stringify({ uploadKey: keyWorking }),
      JSON.stringify({ key: keyState }),
    );
    await insertJob(
      waitingId,
      'waiting',
      JSON.stringify({ uploadKey: keyWaiting }),
      '{}',
    );
    await insertJob(badJsonId, 'ready', '{', '{');

    const keys = await listProtectedMediaKeys(pool);

    assert.equal(keys.has(keyDone), false);
    assert.equal(keys.has(`${owner}/done-state`), false);
    assert.equal(keys.has(keyReady), true);
    assert.equal(keys.has(keyFailed), true);
    assert.equal(keys.has(keyUncertain), true);
    assert.equal(keys.has(keyState), true);
    assert.equal(keys.has(keyWorking), true);
    assert.equal(keys.has(keyWaiting), true);
  } finally {
    await pool.query('DELETE FROM jobs WHERE owner = $1', [owner]);
    await pool.end();
  }
});
