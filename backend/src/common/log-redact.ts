// Request logs keep the path and query, but never a credential that travels
// in them: invitation and placement-test links carry their token in the
// path, e-mail verification in the query. A log reader must not be able to
// accept someone's invitation from a log line. Calendar subscription links
// carry their key in the path too; the OAuth callback its code and state.

const SECRET_PATH = /^(\/api\/(?:invitations|public\/placement|calendar\/feed)\/)[^/?#]+/;
const SECRET_KEYS = new Set(['token', 'code', 'secret', 'pin', 'password', 'refreshtoken', 'state']);
const MASK = '[redacted]';

export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  const path = (q === -1 ? url : url.slice(0, q)).replace(SECRET_PATH, `$1${MASK}`);
  if (q === -1) return path;
  const out = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(url.slice(q + 1))) out.append(key, SECRET_KEYS.has(key.toLowerCase()) ? MASK : value);
  const rest = out.toString().replace(/%5Bredacted%5D/g, MASK);
  return rest ? `${path}?${rest}` : path;
}

export function redactQuery(query: unknown): unknown {
  if (!query || typeof query !== 'object') return query;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) out[k] = SECRET_KEYS.has(k.toLowerCase()) ? MASK : v;
  return out;
}
