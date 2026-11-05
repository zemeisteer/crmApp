// IPv4 CIDR lists for the optional webhook address check
// (TELEPHONY_ZADARMA_IPS="185.45.152.40/30,..."). IPv6 or a malformed entry
// is dropped from the list; an address that is not IPv4 is not allowed.

const toInt = (ip: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
};

export function parseCidrs(raw: string | undefined): Array<{ base: number; mask: number }> {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [ip, bitsRaw] = entry.split('/');
      const base = toInt(ip);
      const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
      if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return [];
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return [{ base: (base & mask) >>> 0, mask }];
    });
}

export function ipAllowed(ip: string | undefined, cidrs: Array<{ base: number; mask: number }>): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const n = toInt(v4);
  if (n === null) return false;
  return cidrs.some((c) => ((n & c.mask) >>> 0) === c.base);
}
