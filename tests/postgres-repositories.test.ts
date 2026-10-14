import '../scripts/load-env.mjs';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
const configPath = '../db/postgres/config.ts';
const repositoryPath = '../db/postgres/repositories/index.ts';
const { getDatabaseUrl } = await import(configPath) as typeof import('../db/postgres/config');
const { createRepositories } = await import(repositoryPath) as typeof import('../db/postgres/repositories');

const pool = new Pool({ connectionString: getDatabaseUrl() });
const repos = createRepositories(pool);
const owner = `test-${randomUUID()}`;
const other = `test-${randomUUID()}`;
const ids = [randomUUID(), randomUUID(), randomUUID()];
const raceOwner = `test-${randomUUID()}`;
const freshOwner = `test-${randomUUID()}`;
const staleOwner = `test-${randomUUID()}`;
const rollbackOwner = `test-${randomUUID()}`;
const allOwners = [owner, other, raceOwner, freshOwner, staleOwner, rollbackOwner];
const triggerName = `test_metadata_${randomUUID().replaceAll('-', '')}`;

test('repository contracts against PostgreSQL', async () => {
  let triggerInstalled = false;
  let functionInstalled = false;
  try {
    await repos.settings.upsert(owner, { appId: '123', selectedAccounts: '["1"]' });
    await repos.settings.upsert(owner, { appSecret: 'encrypted' });
    assert.deepEqual(await repos.settings.get(owner), { owner, appId: '123', appSecret: 'encrypted', selectedAccounts: '["1"]', tokenMetadata: null });
    await repos.connections.upsert(owner, 'token-a', 'first', '{"a":1}');
    assert.equal((await repos.settings.get(owner))?.tokenMetadata, '{"a":1}');
    assert.equal(await repos.connections.updateMetadata(owner, 'wrong', '{"bad":1}'), false);
    assert.equal(await repos.connections.updateMetadata(owner, 'token-a', '{"checked":1}', 'token-extended'), true);
    assert.equal((await repos.connections.get(owner))?.token, 'token-extended');
    assert.equal((await repos.settings.get(owner))?.tokenMetadata, '{"checked":1}');
    assert.equal(await repos.connections.updateMetadata(owner, 'token-a', '{"stale":1}'), false);
    assert.deepEqual(await repos.settings.view(owner), { appId: '123', hasAppSecret: true, selectedAccounts: ['1'] });
    assert.deepEqual(await repos.settings.view('unknown'), { appId: '1638631194443006', hasAppSecret: false, selectedAccounts: null });
    await repos.connections.upsert(other, 'other', 'second', null);
    assert.equal((await repos.connections.get(other))?.owner, other);
    assert.equal(await repos.connections.get('unknown'), null);
    await Promise.all([repos.connections.setCooldown(owner, 800), repos.connections.setCooldown(owner, 200), repos.connections.setCooldown(owner, 900)]);
    assert.equal((await repos.connections.get(owner))?.cooldown, 900);
    await repos.connections.upsert(owner, 'token-b', 'new', null);
    assert.equal((await repos.connections.get(owner))?.cooldown, 0);
    assert.equal(await repos.connections.updateMetadata(owner, 'token-a', '{"stale":1}'), false);
    assert.equal((await repos.settings.get(owner))?.tokenMetadata, null);
    await repos.settings.clearCredentials(other);
    assert.equal((await repos.settings.get(owner))?.appSecret, 'encrypted');
    await repos.presets.create({ id: ids[0], owner, account: '1', name: 'old', configuration: '{}', created: 1 });
    await repos.presets.create({ id: ids[1], owner, account: '1', name: 'new', configuration: '{"x":1}', created: 2 });
    assert.deepEqual((await repos.presets.listParsed(owner, '1')).map(p => p.configuration), [{ x: 1 }, {}]);
    assert.deepEqual((await repos.presets.list(owner, '1')).map(p => p.id), [ids[1], ids[0]]);
    const tied = randomUUID();
    await repos.presets.create({ id: tied, owner, account: '1', name: 'tie', configuration: 'null', created: 2 });
    assert.deepEqual((await repos.presets.listParsed(owner, '1')).slice(0, 2).map(p => p.id), [ids[1], tied].sort().reverse());
    await repos.presets.create({ id: randomUUID(), owner, account: '2', name: 'malformed', configuration: '{', created: 3 });
    await assert.rejects(repos.presets.listParsed(owner, '2'), SyntaxError);
    assert.equal(await repos.presets.delete(ids[0], other, '1'), false);
    assert.equal(await repos.presets.delete(ids[0], owner, '2'), false);
    assert.equal(await repos.presets.delete(ids[0], owner, '1'), true);
    const job = { id: ids[2], owner, kind: 'ad', payload: '{}', state: '{}', status: 'ready', created: 1, updated: 1 };
    assert.deepEqual((await Promise.all([repos.jobs.create(job), repos.jobs.create(job)])).map(r => r.kind).sort(), ['created', 'existing']);
    assert.equal((await repos.jobs.create({ ...job, owner: other })).kind, 'conflict');
    const ambiguous = createRepositories({
      query: async (sql: string, params: unknown[]) => {
        if (sql.startsWith('INSERT INTO jobs')) throw new Error('connection lost after insert');
        return pool.query(sql, params);
      },
    } as unknown as Pool);
    assert.equal((await ambiguous.jobs.create(job)).kind, 'existing');
    await assert.rejects(ambiguous.jobs.create({ ...job, id: randomUUID() }), /connection lost after insert/);
    assert.equal(await repos.jobs.get(ids[2], other), null);
    assert.equal(await repos.jobs.update(ids[2], other, { state: '{"bad":1}', status: 'done', updated: 2 }), false);
    assert.equal(await repos.jobs.update(ids[2], owner, { status: 'done', updated: 2, expectedStatuses: ['working'] }), false);
    assert.equal(await repos.jobs.recover(ids[2], other, '{}', 2), false);
    assert.equal(await repos.jobs.recover(ids[2], owner, '{"recovered":true}', 2), false);
    await repos.jobs.update(ids[2], owner, { status: 'failed', updated: 2 });
    assert.deepEqual((await Promise.all([repos.jobs.recover(ids[2], owner, '{"recovered":true}', 3), repos.jobs.recover(ids[2], owner, '{"stale":true}', 4)])).sort(), [false, true]);
    assert.equal((await repos.jobs.get(ids[2], owner))?.status, 'ready');
    assert.equal(await repos.jobs.prepareRetry(ids[2], owner, 5), false);
    assert.equal(await repos.jobs.update(ids[2], owner, { status: 'done', updated: 5, expectedStatuses: ['working'] }), false);
    assert.equal((await repos.jobs.get(ids[2], owner))?.status, 'ready');
    assert.equal((await repos.jobs.claim(ids[2], other, 1000)).kind, 'missing');
    assert.deepEqual((await Promise.all([repos.jobs.claim(ids[2], owner, 1000), repos.jobs.claim(ids[2], owner, 1000)])).map(r => r.kind).sort(), ['claimed', 'ineligible']);
    assert.equal((await repos.jobs.claim(ids[2], owner, 1000 + 180000)).kind, 'ineligible');
    assert.equal(await repos.jobs.update(ids[2], owner, { status: 'done', updated: 2, expectedStatuses: ['working'] }), true);
    assert.equal(await repos.jobs.update(ids[2], owner, { status: 'failed', updated: 3, expectedStatuses: ['working'] }), false);
    assert.equal((await repos.jobs.get(ids[2], owner))?.status, 'done');
    await repos.jobs.update(ids[2], owner, { status: 'ready', updated: 1 });
    assert.equal((await repos.jobs.claim(ids[2], owner, 1000 + 180001)).kind, 'claimed');
    // Distinct ready jobs race on separate pool clients; the owner lock permits only one.
    const makeJob = (id: string, jobOwner: string, status = 'ready', updated = 1) =>
      ({ ...job, id, owner: jobOwner, status, updated });
    const raceIds = [randomUUID(), randomUUID()];
    await Promise.all(raceIds.map(id => repos.jobs.create(makeJob(id, raceOwner))));
    const race = await Promise.all(raceIds.map(id => repos.jobs.claim(id, raceOwner, 1000)));
    assert.deepEqual(race.map(result => result.kind).sort(), ['busy', 'claimed']);
    assert.equal((await repos.jobs.list(raceOwner)).filter(row => row.status === 'working').length, 1);

    const thresholdNow = 200000;
    for (const [jobOwner, workingUpdated, expected] of [
      [freshOwner, thresholdNow - 180000 + 1, 'busy'],
      [staleOwner, thresholdNow - 180000, 'claimed'],
    ] as const) {
      const workingId = randomUUID();
      const readyId = randomUUID();
      await repos.jobs.create(makeJob(workingId, jobOwner, 'working', workingUpdated));
      await repos.jobs.create(makeJob(readyId, jobOwner));
      assert.equal((await repos.jobs.claim(readyId, jobOwner, thresholdNow)).kind, expected);
      assert.equal((await repos.jobs.get(readyId, jobOwner))?.status, expected === 'busy' ? 'ready' : 'working');
    }

    // Force the settings statement to fail after the connection INSERT succeeds.
    await pool.query(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test metadata rollback'; END $$`);
    functionInstalled = true;
    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT OR UPDATE ON settings FOR EACH ROW WHEN (NEW.owner = '${rollbackOwner}') EXECUTE FUNCTION ${triggerName}()`);
    triggerInstalled = true;
    await assert.rejects(repos.connections.upsert(rollbackOwner, 'new-token', 'name', '{}'), /test metadata rollback/);
    assert.equal(await repos.connections.get(rollbackOwner), null);
    assert.equal(await repos.settings.get(rollbackOwner), null);

    await repos.connections.delete(owner);
    assert.equal(await repos.connections.get(owner), null);
    assert.equal((await repos.settings.get(owner))?.tokenMetadata, null);
    assert.equal((await repos.connections.get(other))?.owner, other);
  } finally {
    try {
      if (triggerInstalled) await pool.query(`DROP TRIGGER ${triggerName} ON settings`);
      if (functionInstalled) await pool.query(`DROP FUNCTION ${triggerName}()`);
    } finally {
      try {
        await pool.query('DELETE FROM jobs WHERE owner = ANY($1)', [allOwners]);
        await pool.query('DELETE FROM presets WHERE owner = ANY($1)', [allOwners]);
        await pool.query('DELETE FROM connections WHERE owner = ANY($1)', [allOwners]);
        await pool.query('DELETE FROM settings WHERE owner = ANY($1)', [allOwners]);
      } finally {
        await pool.end();
      }
    }
  }
});
