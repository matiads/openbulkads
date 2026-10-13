export function getDatabaseUrl(value?: string): string {
  if (arguments.length === 0) value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.username || !url.password || !url.hostname || url.pathname.length < 2 || url.search || url.hash) {
    throw new Error('DATABASE_URL must contain PostgreSQL credentials, host and database (without query or fragment)');
  }
  return value;
}
