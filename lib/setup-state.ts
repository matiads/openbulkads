import { MetaError } from '@/lib/meta-core';

export type QueryablePool = {
  query: (queryText: string) => Promise<{ rows: Array<{ count: number }> }>;
};

export async function isSetupRequired(pool?: QueryablePool): Promise<boolean> {
  let activePool = pool;
  if (!activePool) {
    const { authPool } = await import('@/lib/auth');
    activePool = authPool;
  }
  const result = await activePool.query(
    'SELECT count(*)::int as count FROM "user"'
  );
  return (result.rows[0]?.count ?? 0) === 0;
}

export async function assertSetupAllowed(pool?: QueryablePool): Promise<void> {
  const required = await isSetupRequired(pool);
  if (!required) {
    throw new MetaError('La configuración inicial ya fue completada.', 403);
  }
}
