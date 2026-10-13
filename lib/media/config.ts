export type MediaConfig = { adapter: 'local'; root: string };

export function getMediaConfig(env?: Record<string, string | undefined>): MediaConfig {
  const e = env ?? process.env;
  const storage = e.MEDIA_STORAGE ?? 'local';
  if (storage !== 'local') {
    throw new Error('MEDIA_STORAGE must be "local" on the Node runtime');
  }
  const root = e.MEDIA_ROOT;
  if (!root || !root.trim()) {
    throw new Error('MEDIA_ROOT is required and must be an absolute path');
  }
  if (!root.startsWith('/')) {
    throw new Error('MEDIA_ROOT must be an absolute path');
  }
  return { adapter: 'local', root };
}
