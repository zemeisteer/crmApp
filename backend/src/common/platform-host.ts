// The platform admin's panel lives on the main domain only (<ROOT_DOMAIN>/admin).
// A request coming from a center's own address (<sub>.<ROOT_DOMAIN>, or
// <sub>.localhost on a dev machine) never gets platform data, whoever is
// signed in: a superadmin who opened a center works there as that center.

// Labels that are never a center (same list as the frontend's lib/domain.ts).
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'mail', 'static', 'cdn']);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The center label of a host name ("alpha.crmapp.com", "alpha.localhost:3100"), or null. */
export function centerLabelOf(host: string | null | undefined, root: string): string | null {
  if (!host) return null;
  const name = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const roots = [root, 'localhost'].filter(Boolean);
  const base = roots.find((d) => name.endsWith(`.${d}`));
  if (!base) return null;
  const label = name.slice(0, -(base.length + 1));
  if (!LABEL.test(label) || RESERVED.has(label)) return null;
  return label;
}

type Headers = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();

/**
 * Whether the browser that sent this request is on a center's address: its
 * Origin (cross-origin calls, e.g. the dev frontend on another port), or the
 * host nginx forwarded (production: every address reaches /api on itself).
 */
export function fromCenterHost(headers: Headers, root: string = process.env.ROOT_DOMAIN || ''): boolean {
  const cleanRoot = root.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const hosts: Array<string | undefined> = [first(headers['x-forwarded-host']), first(headers.host)];
  const origin = first(headers.origin);
  if (origin) {
    try {
      hosts.push(new URL(origin).host);
    } catch {
      // not a URL: ignored
    }
  }
  return hosts.some((h) => centerLabelOf(h, cleanRoot) !== null);
}
