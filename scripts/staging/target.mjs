// Where verify-flows.mjs is allowed to send requests, decided BEFORE any
// request is made. The script creates data, so the destination has to be
// the environment the operator confirmed - not just a root-domain string.
//
// Staging (default):
//   --api https://<root>/api --root <root> --confirm <root>
//   The API host must be exactly the confirmed root domain, over https, on
//   the default port, at /api (how the stack is deployed: nginx serves the
//   API on the site's own address).
//
// A separate API host, if an environment is deployed that way:
//   --api https://api.<something>/api --root <root> --confirm <root> --confirm-api-host <that host[:port]>
//   The actual host of --api must be repeated in --confirm-api-host, and it
//   must look like a test host too.
//
// Local rehearsal (constrained):
//   --local --api http://127.0.0.1:<port>/api --root <name>.localhost --confirm <name>.localhost
//   Only a loopback API (127.0.0.1, localhost, ::1) and a .localhost root.
//
// Rejected always: URLs that do not parse, protocols other than http(s),
// credentials in the URL, a query or fragment, a path other than /api.

const TEST_LABEL = /(^|[-.])(staging|stage|stg|test|dev|sandbox|rehearsal)([-.]|$)/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[.*\]$/;

export class TargetError extends Error {}
const refuse = (msg) => { throw new TargetError(msg); };

export function looksLikeTestHost(host) {
  return TEST_LABEL.test(host);
}

/**
 * @param {Record<string, string | boolean | undefined>} args parsed command line
 * @returns {{ api: string, apiUrl: URL, root: string, local: boolean, https: boolean, siteScheme: string, allowedHost: (host: string) => boolean }}
 */
export function resolveTarget(args) {
  const rawApi = typeof args.api === 'string' ? args.api : '';
  const root = typeof args.root === 'string' ? args.root.toLowerCase() : '';
  const local = args.local === true;
  if (!rawApi || !root) refuse('usage: --api <https://host/api> --root <root domain> --confirm <root domain>');

  if (!HOSTNAME.test(root)) refuse(`--root must be a bare domain name (no scheme, port or path): "${root}"`);
  if (args.confirm !== root) refuse(`--confirm must repeat the root domain (${root}). This script creates data.`);

  let apiUrl;
  try {
    apiUrl = new URL(rawApi);
  } catch {
    refuse(`--api is not a valid URL: "${rawApi}"`);
  }
  if (apiUrl.protocol !== 'https:' && apiUrl.protocol !== 'http:') refuse(`--api must be http(s), not "${apiUrl.protocol}"`);
  if (apiUrl.username || apiUrl.password) refuse('--api must not contain a user name or password');
  if (apiUrl.search || apiUrl.hash) refuse('--api must not contain a query string or fragment');
  if (apiUrl.pathname.replace(/\/+$/, '') !== '/api') refuse(`--api must end in /api (got path "${apiUrl.pathname}")`);
  // What the user typed and what the parser understood must be the same
  // host: "https://staging.x.uz@evil.com/api" or odd encodings do not pass.
  const typedHost = rawApi.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  if (typedHost !== apiUrl.host) refuse(`--api host is ambiguous: written "${typedHost}", parsed as "${apiUrl.host}"`);

  const host = apiUrl.hostname.toLowerCase();

  if (local) {
    if (!LOOPBACK.has(host)) refuse(`--local allows only a loopback API (127.0.0.1, localhost, [::1]), not "${host}"`);
    if (root !== 'localhost' && !root.endsWith('.localhost')) refuse(`--local needs a .localhost root domain, not "${root}"`);
    if (args['confirm-api-host'] !== undefined) refuse('--confirm-api-host is not used with --local');
  } else {
    if (LOOPBACK.has(host) || root === 'localhost' || root.endsWith('.localhost')) refuse('a loopback / .localhost target needs --local');
    if (apiUrl.protocol !== 'https:') refuse('--api must be https outside --local');
    if (IP_LITERAL.test(host)) refuse(`--api must name a host, not an address ("${host}")`);
    if (!looksLikeTestHost(root) && args['not-a-test-name'] !== true) {
      refuse(`"${root}" does not look like a test domain (no staging/stage/stg/test/dev/sandbox label). Pass --not-a-test-name only if this really is a staging environment.`);
    }
    if (host === root) {
      if (apiUrl.port) refuse(`--api uses port ${apiUrl.port}; the confirmed root domain is served on the default https port`);
      if (args['confirm-api-host'] !== undefined && args['confirm-api-host'] !== apiUrl.host) refuse('--confirm-api-host does not match the host of --api');
    } else {
      // A separate API host is its own destination: it must be named again.
      if (args['confirm-api-host'] !== apiUrl.host) {
        refuse(`the API host "${apiUrl.host}" is not the confirmed root domain "${root}". If this environment really serves its API there, repeat it: --confirm-api-host ${apiUrl.host}`);
      }
      if (!looksLikeTestHost(host) && args['not-a-test-name'] !== true) refuse(`the API host "${host}" does not look like a test host`);
    }
  }

  const api = `${apiUrl.origin}/api`;
  const siteScheme = local ? 'http' : 'https';
  // Besides the API itself the script only ever talks to the root site and
  // to one level of center subdomains under it.
  const allowedHost = (h) => {
    const name = h.toLowerCase();
    if (name === apiUrl.host.toLowerCase()) return true;
    if (local) return false;
    // The site itself: default port only (another port is another service).
    if (/:\d+$/.test(name)) return false;
    return name === root || (name.endsWith(`.${root}`) && !name.slice(0, -(root.length + 1)).includes('.'));
  };
  return { api, apiUrl, root, local, https: apiUrl.protocol === 'https:', siteScheme, allowedHost };
}

/**
 * fetch that cannot leave the confirmed destination: the URL's host must be
 * allowed, and redirects are never followed (a 3xx is returned as it is, so
 * a redirect to another origin cannot carry the request - or a token -
 * anywhere else).
 */
export function guardedFetch(target, fetchImpl = globalThis.fetch) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TargetError(`refusing to request ${u.protocol}`);
    if (u.username || u.password) throw new TargetError('refusing a URL with credentials');
    if (!target.allowedHost(u.host)) throw new TargetError(`refusing to request ${u.host}: not the confirmed destination`);
    if (!target.local && u.protocol !== 'https:' && init.allowPlainHttp !== true) throw new TargetError(`refusing plain http to ${u.host}`);
    const { allowPlainHttp: _a, ...rest } = init;
    return fetchImpl(u, { ...rest, redirect: 'manual' });
  };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}
