import type { Pool, PoolClient } from 'pg';

type Connection = { owner: string; token: string; name: string; cooldown: number };
type Settings = { owner: string; appId: string | null; appSecret: string | null; selectedAccounts: string | null; tokenMetadata: string | null };
type Preset = { id: string; owner: string; account: string; name: string; configuration: string; created: number };
type Job = { id: string; owner: string; kind: string; payload: string; state: string; status: string; created: number; updated: number };
type Claim = { kind: 'claimed'; job: Job } | { kind: 'missing' | 'ineligible' | 'busy' };
type Created = { kind: 'created' | 'existing'; job: Job } | { kind: 'conflict' };

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const connectionFields = 'owner,token,name,cooldown::float8 AS cooldown';
const presetFields = 'id,owner,account,name,configuration,created::float8 AS created';
const jobFields = 'id,owner,kind,payload,state,status,created::float8 AS created,updated::float8 AS updated';
const settingsFields = 'owner,app_id AS "appId",app_secret AS "appSecret",selected_accounts AS "selectedAccounts",token_metadata AS "tokenMetadata"';

export function createRepositories(pool: Pool) {
  return {
    connections: {
      async get(owner: string): Promise<Connection | null> {
        return (await pool.query<Connection>(`SELECT ${connectionFields} FROM connections WHERE owner=$1`, [owner])).rows[0] ?? null;
      },
      async upsert(owner: string, token: string, name: string, metadata: string | null): Promise<void> {
        await transaction(pool, async client => {
          await client.query('INSERT INTO connections(owner,token,name,cooldown) VALUES($1,$2,$3,0) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,name=excluded.name,cooldown=0', [owner, token, name]);
          await client.query('INSERT INTO settings(owner,token_metadata) VALUES($1,$2) ON CONFLICT(owner) DO UPDATE SET token_metadata=excluded.token_metadata', [owner, metadata]);
        });
      },
      async updateMetadata(owner: string, expectedToken: string, metadata: string, replacementToken?: string): Promise<boolean> {
        return transaction(pool, async client => {
          const changed = await client.query('UPDATE connections SET token=COALESCE($3,token) WHERE owner=$1 AND token=$2 RETURNING owner', [owner, expectedToken, replacementToken ?? null]);
          if (!changed.rowCount) return false;
          await client.query('INSERT INTO settings(owner,token_metadata) VALUES($1,$2) ON CONFLICT(owner) DO UPDATE SET token_metadata=excluded.token_metadata', [owner, metadata]);
          return true;
        });
      },
      async setCooldown(owner: string, until: number): Promise<boolean> {
        return (await pool.query('UPDATE connections SET cooldown=GREATEST(cooldown,$2) WHERE owner=$1', [owner, until])).rowCount === 1;
      },
      async delete(owner: string): Promise<boolean> {
        return transaction(pool, async client => {
          const removed = await client.query('DELETE FROM connections WHERE owner=$1', [owner]);
          await client.query('UPDATE settings SET token_metadata=NULL WHERE owner=$1', [owner]);
          return removed.rowCount === 1;
        });
      },
    },
    settings: {
      async get(owner: string): Promise<Settings | null> {
        return (await pool.query<Settings>(`SELECT ${settingsFields} FROM settings WHERE owner=$1`, [owner])).rows[0] ?? null;
      },
      async view(owner: string) {
        const row = await this.get(owner);
        return { appId: row?.appId || '1638631194443006', hasAppSecret: Boolean(row?.appSecret), selectedAccounts: row?.selectedAccounts ? JSON.parse(row.selectedAccounts) as string[] : null };
      },
      async upsert(owner: string, values: Partial<Omit<Settings, 'owner'>>): Promise<void> {
        const columns: Record<keyof Omit<Settings, 'owner'>, string> = { appId: 'app_id', appSecret: 'app_secret', selectedAccounts: 'selected_accounts', tokenMetadata: 'token_metadata' };
        const entries = Object.entries(values) as [keyof typeof columns, string | null][];
        if (!entries.length) return;
        const names = entries.map(([key]) => columns[key]);
        await pool.query(`INSERT INTO settings(owner,${names.join(',')}) VALUES($1,${entries.map((_, i) => `$${i + 2}`).join(',')}) ON CONFLICT(owner) DO UPDATE SET ${names.map(name => `${name}=excluded.${name}`).join(',')}`, [owner, ...entries.map(([, value]) => value)]);
      },
      async clearCredentials(owner: string): Promise<boolean> {
        return (await pool.query('UPDATE settings SET app_secret=NULL,token_metadata=NULL WHERE owner=$1', [owner])).rowCount === 1;
      },
    },
    presets: {
      async create(preset: Preset): Promise<void> {
        await pool.query('INSERT INTO presets(id,owner,account,name,configuration,created) VALUES($1,$2,$3,$4,$5,$6)', [preset.id, preset.owner, preset.account, preset.name, preset.configuration, preset.created]);
      },
      async list(owner: string, account: string): Promise<Preset[]> {
        return (await pool.query<Preset>(`SELECT ${presetFields} FROM presets WHERE owner=$1 AND account=$2 ORDER BY created DESC,id DESC`, [owner, account])).rows;
      },
      async listParsed(owner: string, account: string): Promise<Array<{ id: string; name: string; configuration: unknown; created: number }>> {
        return (await this.list(owner, account)).map(({ id, name, configuration, created }) => ({ id, name, configuration: JSON.parse(configuration) as unknown, created }));
      },
      async delete(id: string, owner: string, account: string): Promise<boolean> {
        return (await pool.query('DELETE FROM presets WHERE id=$1 AND owner=$2 AND account=$3', [id, owner, account])).rowCount === 1;
      },
    },
    jobs: {
      async recover(id: string, owner: string, state: string, updated: number): Promise<boolean> {
        return (await pool.query("UPDATE jobs SET state=$3,status='ready',updated=$4 WHERE id=$1 AND owner=$2 AND status IN ('failed','uncertain')", [id, owner, state, updated])).rowCount === 1;
      },
      async get(id: string, owner: string): Promise<Job | null> {
        return (await pool.query<Job>(`SELECT ${jobFields} FROM jobs WHERE id=$1 AND owner=$2`, [id, owner])).rows[0] ?? null;
      },
      async list(owner: string): Promise<Job[]> {
        return (await pool.query<Job>(`SELECT ${jobFields} FROM jobs WHERE owner=$1 ORDER BY created DESC LIMIT 50`, [owner])).rows;
      },
      async create(job: Job): Promise<Created> {
        let inserted;
        try {
          inserted = await pool.query<Job>(`INSERT INTO jobs(id,owner,kind,payload,state,status,created,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING ${jobFields}`, [job.id, job.owner, job.kind, job.payload, job.state, job.status, job.created, job.updated]);
        } catch (error) {
          const existing = await this.get(job.id, job.owner);
          if (existing) return { kind: 'existing', job: existing };
          throw error;
        }
        if (inserted.rows[0]) return { kind: 'created', job: inserted.rows[0] };
        const existing = await this.get(job.id, job.owner);
        return existing ? { kind: 'existing', job: existing } : { kind: 'conflict' };
      },
      async prepareRetry(id: string, owner: string, updated: number): Promise<boolean> {
        return (await pool.query("UPDATE jobs SET status='ready',updated=$3 WHERE id=$1 AND owner=$2 AND status='failed'", [id, owner, updated])).rowCount === 1;
      },
      async update(id: string, owner: string, changes: { state?: string; status?: string; updated: number; expectedStatuses?: string[] }): Promise<boolean> {
        return (await pool.query('UPDATE jobs SET state=COALESCE($3,state),status=COALESCE($4,status),updated=$5 WHERE id=$1 AND owner=$2 AND ($6::text[] IS NULL OR status=ANY($6))', [id, owner, changes.state ?? null, changes.status ?? null, changes.updated, changes.expectedStatuses ?? null])).rowCount === 1;
      },
      async claim(id: string, owner: string, now: number): Promise<Claim> {
        return transaction(pool, async client => {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [owner]);
          const found = await client.query<Job>(`SELECT ${jobFields} FROM jobs WHERE id=$1 AND owner=$2`, [id, owner]);
          const job = found.rows[0];
          if (!job) return { kind: 'missing' };
          if (!['ready', 'waiting'].includes(job.status)) return { kind: 'ineligible' };
          const active = await client.query('SELECT 1 FROM jobs WHERE owner=$1 AND status=$2 AND updated>$3 LIMIT 1', [owner, 'working', now - 180000]);
          if (active.rowCount) return { kind: 'busy' };
          const claimed = await client.query<Job>(`UPDATE jobs SET status='working',updated=$3 WHERE id=$1 AND owner=$2 AND status IN ('ready','waiting') RETURNING ${jobFields}`, [id, owner, now]);
          return claimed.rows[0] ? { kind: 'claimed', job: claimed.rows[0] } : { kind: 'ineligible' };
        });
      },
    },
  };
}
