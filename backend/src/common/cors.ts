// Which browser origins may call the API. In production the app and every
// center site (<sub>.<ROOT_DOMAIN>) reach the API through nginx on their own
// address, so only those origins are allowed; development also allows
// localhost and *.localhost on any port.

export function corsOriginChecker(env: { ROOT_DOMAIN?: string; FRONTEND_URL?: string; NODE_ENV?: string }) {
  const root = (env.ROOT_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const extra = new Set<string>();
  if (env.FRONTEND_URL) {
    try {
      extra.add(new URL(env.FRONTEND_URL).origin);
    } catch {
      // ignore a malformed FRONTEND_URL
    }
  }
  const dev = env.NODE_ENV !== 'production';

  return function isAllowed(origin: string | undefined): boolean {
    // Same-origin requests, server-to-server calls and curl send no Origin.
    if (!origin) return true;
    if (extra.has(origin)) return true;
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      return false;
    }
    const host = u.hostname.toLowerCase();
    if (dev && (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost'))) return true;
    if (!root || u.protocol !== 'https:') return false;
    return host === root || (host.endsWith(`.${root}`) && !host.slice(0, -(root.length + 1)).includes('.'));
  };
}
