import type { createRepositories } from '@/db/postgres/repositories';

type Repositories = ReturnType<typeof createRepositories>;
let nodeRepositories: Promise<Repositories> | undefined;
export async function repositories(): Promise<Repositories> {
  return nodeRepositories ??= (async () => {
    const [{ createDatabase }, { createRepositories }] = await Promise.all([
      import('@/db/postgres/client'), import('@/db/postgres/repositories'),
    ]);
    return createRepositories(createDatabase().pool);
  })().catch(error => { nodeRepositories = undefined; throw error; });
}
