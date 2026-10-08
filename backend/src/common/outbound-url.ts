import { lookup } from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import { isIP } from 'net';

// Addresses a center-supplied URL (outbound webhooks) must never reach from
// the server: loopback, private networks, link-local (cloud metadata),
// carrier-grade NAT, multicast, unspecified, documentation - the API's own
// neighbours. IPv6 is parsed into its eight groups first, so every textual
// form of the same address (`::ffff:127.0.0.1`, `::ffff:7f00:1` - what
// `new URL()` turns the former into - `0:0:0:0:0:ffff:7f00:1`, upper case)
// gets the same answer.

function ipv4Blocked(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (isIP(s) !== 6) return null;
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const p = tail.split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  let groups: string[];
  if (halves.length === 1) groups = head;
  else {
    const rest = halves[1] ? halves[1].split(':') : [];
    groups = [...head, ...Array<string>(8 - head.length - rest.length).fill('0'), ...rest];
  }
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g, 16));
}

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function ipv6Blocked(ip: string): boolean {
  const h = parseIPv6(ip);
  if (!h) return true;
  const zeros = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  // IPv4-mapped ::ffff:a.b.c.d - the IPv4 address decides.
  if (zeros(0, 5) && h[5] === 0xffff) return ipv4Blocked(v4Of(h[6], h[7]));
  // NAT64 well-known prefix 64:ff9b::/96 reaches the embedded IPv4 address.
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return ipv4Blocked(v4Of(h[6], h[7]));
  // 6to4 2002::/16 carries an IPv4 address in groups 1-2.
  if (h[0] === 0x2002) return ipv4Blocked(v4Of(h[1], h[2]));
  // Only global unicast 2000::/3. This alone refuses ::, ::1, the
  // deprecated IPv4-compatible ::a.b.c.d, ::ffff:0:a.b.c.d, 64:ff9b:1::/48,
  // 100::/64, unique-local fc00::/7, link-local fe80::/10, site-local
  // fec0::/10 and multicast ff00::/8.
  if ((h[0] & 0xe000) !== 0x2000) return true;
  // Inside 2000::/3: IANA special purpose 2001::/23 (Teredo 2001::/32 hides
  // an IPv4 address, benchmarking, ORCHID) and the documentation ranges.
  if (h[0] === 0x2001 && h[1] < 0x200) return true;
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;
  if (h[0] === 0x3fff && h[1] < 0x1000) return true;
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) return ipv6Blocked(ip);
  return parseIPv6(ip) ? ipv6Blocked(ip) : true;
}

export class OutboundUrlError extends Error {}

/** Every address a host name resolves to. Replaceable in tests (no real DNS). */
export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Private targets are a development convenience (a receiver on the same
 * machine) and never apply in production, whatever the flag says.
 */
export function privateTargetsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WEBHOOK_ALLOW_PRIVATE === 'true' && env.NODE_ENV !== 'production';
}

function hostOf(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/** The addresses `host` may be reached at, or OutboundUrlError. */
async function allowedAddresses(host: string, allowPrivate: boolean, resolve: Resolver): Promise<string[]> {
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new OutboundUrlError('Manzil topilmadi');
    }
  }
  if (addresses.length === 0) throw new OutboundUrlError('Manzil topilmadi');
  if (!allowPrivate && addresses.some(isBlockedAddress)) throw new OutboundUrlError('Ichki tarmoq manzili qabul qilinmaydi');
  return addresses;
}

/**
 * Throws OutboundUrlError unless `raw` is an http(s) URL whose host resolves
 * only to public addresses. `allowPrivate` (see privateTargetsAllowed) is
 * for local development against a receiver on the same machine.
 *
 * This is the check for saving a URL. Sending to it goes through
 * postToPublicUrl, which checks again on the connection itself.
 */
export async function assertPublicHttpUrl(raw: string, allowPrivate = false, resolve: Resolver = systemResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundUrlError("Manzil noto'g'ri");
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new OutboundUrlError('Faqat http(s) manzil');
  if (url.username || url.password) throw new OutboundUrlError("Manzil ichida login/parol bo'lmasin");
  if (allowPrivate) return url;
  const host = hostOf(url);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new OutboundUrlError('Ichki tarmoq manzili qabul qilinmaydi');
  }
  await allowedAddresses(host, allowPrivate, resolve);
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void;

/**
 * A `lookup` for http(s).request that resolves the name, checks every
 * address and hands the socket exactly those addresses - the check and the
 * connection use the same answer, so a name that changes its mind between
 * the two (DNS rebinding) cannot slip through. TLS still verifies the
 * certificate against the host name (servername stays the URL's host).
 */
export function guardedLookup(allowPrivate: boolean, resolve: Resolver = systemResolver) {
  return (hostname: string, options: unknown, callback?: LookupCallback) => {
    let cb = callback as LookupCallback;
    let opts = options as { all?: boolean } | undefined;
    if (typeof options === 'function') {
      cb = options as LookupCallback;
      opts = {};
    }
    allowedAddresses(hostname.replace(/^\[|\]$/g, ''), allowPrivate, resolve).then(
      (addresses) => {
        if (opts?.all) cb(null, addresses.map((address) => ({ address, family: isIP(address) })));
        else cb(null, addresses[0], isIP(addresses[0]));
      },
      (err: Error) => cb(Object.assign(err, { code: 'EOUTBOUNDBLOCKED' })),
    );
  };
}

export interface PostOptions {
  allowPrivate?: boolean;
  /** For the whole operation: checks, resolution, connection, response head. */
  timeoutMs: number;
  resolve?: Resolver;
}

/**
 * POSTs `body` to a center-supplied URL and returns the response status.
 * Redirects are not followed (a 3xx is just the answer); no connection is
 * reused; the response body is not read.
 */
export async function postToPublicUrl(raw: string, body: string, headers: Record<string, string>, opts: PostOptions): Promise<number> {
  const allowPrivate = opts.allowPrivate ?? false;
  const resolve = opts.resolve ?? systemResolver;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OutboundUrlError('Javob kutish vaqti tugadi'));
    }, opts.timeoutMs);
  });
  const send = (async () => {
    const url = await assertPublicHttpUrl(raw, allowPrivate, resolve);
    const client = url.protocol === 'https:' ? https : http;
    return new Promise<number>((resolveStatus, reject) => {
      const req = client.request(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
          agent: false,
          lookup: guardedLookup(allowPrivate, resolve) as unknown as typeof import('dns').lookup,
          signal: controller.signal,
        },
        (res) => {
          resolveStatus(res.statusCode ?? 0);
          res.destroy();
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  })();
  try {
    return await Promise.race([send, timeout]);
  } finally {
    clearTimeout(timer);
    send.catch(() => undefined);
  }
}

/** A URL as it may appear in logs: scheme and host only (paths and queries can hold tokens). */
export function urlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '(invalid url)';
  }
}
