// The Better Auth handler is loaded lazily so route graphs that never touch
// authentication keep better-auth and PostgreSQL out of their static bundle.
async function handler(request: Request, method: 'GET' | 'POST') {
  const [{ toNextJsHandler }, { auth }] = await Promise.all([
    import('better-auth/next-js'),
    import('@/lib/auth'),
  ]);
  return toNextJsHandler(auth)[method](request);
}

export const GET = (request: Request) => handler(request, 'GET');
export const POST = (request: Request) => handler(request, 'POST');
