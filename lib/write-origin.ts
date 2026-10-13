// Next may build the route URL from the bind address (`--hostname`) while the
// browser sends the public Host and Origin. Compare those headers, and honor
// the proxy scheme, so a same-site write is not rejected as cross-origin.
function publicScheme(request: Request): 'http' | 'https' | null {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    const scheme = forwarded.split(',')[0]?.trim().toLowerCase();
    return scheme === 'http' || scheme === 'https' ? scheme : null;
  }
  const protocol = new URL(request.url).protocol;
  return protocol === 'http:' || protocol === 'https:' ? protocol.slice(0, -1) as 'http' | 'https' : null;
}

function publicOrigin(request: Request): string | null {
  const host = request.headers.get('host')?.trim();
  // Route tests and same-origin requests may omit Host. Fall back to the URL
  // Next already built instead of treating that as a foreign origin.
  if (!host) {
    try {
      return new URL(request.url).origin;
    } catch {
      return null;
    }
  }
  if (/[\s/\\]/.test(host)) return null;
  const scheme = publicScheme(request);
  if (!scheme) return null;
  try {
    const url = new URL(`${scheme}://${host}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isSameOriginWrite(request: Request): boolean {
  const originHeader = request.headers.get('origin');
  if (!originHeader || originHeader === 'null') return false;
  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }
  if (origin === 'null') return false;
  return origin === publicOrigin(request);
}
