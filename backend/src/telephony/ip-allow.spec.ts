import { describe, expect, it } from 'vitest';
import { ipAllowed, parseCidrs } from './ip-allow';

describe('webhook address check', () => {
  const zadarma = parseCidrs('185.45.152.40/30');

  it("allows Zadarma's four addresses and nothing next to them", () => {
    for (const ip of ['185.45.152.40', '185.45.152.41', '185.45.152.42', '185.45.152.43', '::ffff:185.45.152.42']) expect(ipAllowed(ip, zadarma)).toBe(true);
    for (const ip of ['185.45.152.39', '185.45.152.44', '10.0.0.1', '::1', 'garbage', undefined]) expect(ipAllowed(ip, zadarma)).toBe(false);
  });

  it('drops malformed entries and reads single addresses', () => {
    expect(parseCidrs('nope, 300.1.1.1/8, 1.2.3.4/33, ,10.0.0.5')).toHaveLength(1);
    expect(ipAllowed('10.0.0.5', parseCidrs('10.0.0.5'))).toBe(true);
    expect(parseCidrs(undefined)).toEqual([]);
  });
});
