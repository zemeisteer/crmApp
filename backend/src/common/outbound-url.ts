import { lookup } from 'dns/promises';
import { isIP } from 'net';

// Addresses a center-supplied URL (outbound webhooks) must never reach from
// the server: loopback, private networks, link-local (cloud metadata),
// carrier-grade NAT, multicast, unspecified - the API's own neighbours.

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Blocked(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Blocked(mapped[1]);
  return /^(fc|fd)/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) return ipv6Blocked(ip);
  return true;
}

export class OutboundUrlError extends Error {}

/**
 * Throws OutboundUrlError unless `raw` is an http(s) URL whose host resolves
 * only to public addresses. `allowPrivate` (WEBHOOK_ALLOW_PRIVATE=true) is
 * for local development against a receiver on the same machine.
 */
export async function assertPublicHttpUrl(raw: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundUrlError("Manzil noto'g'ri");
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new OutboundUrlError('Faqat http(s) manzil');
  if (url.username || url.password) throw new OutboundUrlError("Manzil ichida login/parol bo'lmasin");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new OutboundUrlError("Ichki tarmoq manzili qabul qilinmaydi");
  }
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new OutboundUrlError('Manzil topilmadi');
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new OutboundUrlError("Ichki tarmoq manzili qabul qilinmaydi");
  }
  return url;
}
