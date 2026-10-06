import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, isBlockedAddress, OutboundUrlError } from './outbound-url';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, CGNAT, multicast and mapped v4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects loopback / metadata / private literals and bad schemes', async () => {
    for (const url of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data', 'http://localhost:4000', 'http://[::1]/', 'http://10.0.0.5/', 'https://user:pass@example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'not a url']) {
      await expect(assertPublicHttpUrl(url), url).rejects.toBeInstanceOf(OutboundUrlError);
    }
  });
  it('accepts a public https URL', async () => {
    const u = await assertPublicHttpUrl('https://example.com/webhook');
    expect(u.hostname).toBe('example.com');
  });
  it('allows a loopback URL only when explicitly permitted (dev)', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1:4999/x', true)).resolves.toBeInstanceOf(URL);
  });
});
