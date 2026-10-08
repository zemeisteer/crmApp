import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import * as http from 'http';
import * as https from 'https';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assertPublicHttpUrl,
  isBlockedAddress,
  OutboundUrlError,
  parseIPv6,
  postToPublicUrl,
  privateTargetsAllowed,
  type Resolver,
  urlForLog,
} from './outbound-url';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, CGNAT, multicast and mapped v4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('blocks every textual form of a mapped / embedded private IPv4 address', () => {
    for (const ip of [
      '::ffff:7f00:1', // what new URL() makes of [::ffff:127.0.0.1]
      '::FFFF:7F00:0001',
      '0:0:0:0:0:ffff:7f00:1',
      '0000:0000:0000:0000:0000:ffff:7f00:0001',
      '::ffff:a9fe:a9fe', // 169.254.169.254
      '::ffff:a00:5', // 10.0.0.5
      '::ffff:c0a8:101', // 192.168.1.1
      '::7f00:1', // deprecated IPv4-compatible
      '::127.0.0.1',
      '::ffff:0:7f00:1', // SIIT translated
      '64:ff9b::7f00:1', // NAT64 to 127.0.0.1
      '64:ff9b::a9fe:a9fe',
      '64:ff9b:1::1', // local-use NAT64
      '2002:7f00:1::1', // 6to4 of 127.0.0.1
      '2002:a9fe:a9fe::', // 6to4 of 169.254.169.254
      '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      'fec0::1', // site-local
      'ff02::1',
      '100::1', // discard-only
      '2001:db8::1', // documentation
      'fe80::1%eth0',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows ordinary public addresses, including a public address written as mapped IPv6', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946', '2a00:1450:4001:82a::200e', '::ffff:808:808', '64:ff9b::808:808']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('blocks documentation / relay IPv4 ranges and non-addresses', () => {
    for (const ip of ['198.51.100.7', '203.0.113.9', '192.0.2.1', '192.88.99.1', '255.255.255.255', 'example.com', '', '1.2.3']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('parses IPv6 into eight groups whatever the notation', () => {
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6('::FFFF:7F00:1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('127.0.0.1')).toBeNull();
  });
});

const noDns: Resolver = async () => {
  throw new Error('no DNS in tests');
};
const resolvesTo = (...addrs: string[]): Resolver => async () => addrs;

describe('assertPublicHttpUrl', () => {
  it('rejects loopback / metadata / private literals and bad schemes', async () => {
    for (const url of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data', 'http://localhost:4000', 'http://[::1]/', 'http://10.0.0.5/', 'https://user:pass@example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'not a url']) {
      await expect(assertPublicHttpUrl(url, false, noDns), url).rejects.toBeInstanceOf(OutboundUrlError);
    }
  });

  it('rejects the URL forms that normalise private IPv4 into IPv6 or other notations', async () => {
    for (const url of [
      'http://[::ffff:127.0.0.1]/x', // becomes [::ffff:7f00:1] - accepted before this fix
      'http://[::ffff:169.254.169.254]/latest/meta-data',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
      'http://[::FFFF:A9FE:A9FE]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[2002:7f00:1::1]/',
      'http://[::127.0.0.1]/',
      'http://[fec0::1]/',
      'http://0x7f.1/', // 127.0.0.1
      'http://2130706433/', // 127.0.0.1
      'http://017700000001/', // 127.0.0.1 (octal)
      'http://0xa9.0xfe.0xa9.0xfe/', // 169.254.169.254
    ]) {
      await expect(assertPublicHttpUrl(url, false, noDns), url).rejects.toBeInstanceOf(OutboundUrlError);
    }
  });

  it('rejects a host name that resolves to any blocked address (all answers are checked)', async () => {
    await expect(assertPublicHttpUrl('https://hook.example/x', false, resolvesTo('::ffff:7f00:1'))).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(assertPublicHttpUrl('https://hook.example/x', false, resolvesTo('93.184.216.34', '10.0.0.1'))).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(assertPublicHttpUrl('https://hook.example/x', false, resolvesTo())).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(assertPublicHttpUrl('https://hook.example/x', false, noDns)).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it('accepts a public https URL', async () => {
    const u = await assertPublicHttpUrl('https://hook.example/webhook', false, resolvesTo('93.184.216.34'));
    expect(u.hostname).toBe('hook.example');
  });

  it('allows a loopback URL only when explicitly permitted (dev)', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1:4999/x', true)).resolves.toBeInstanceOf(URL);
  });
});

describe('privateTargetsAllowed', () => {
  it('is never on in production, whatever the flag', () => {
    expect(privateTargetsAllowed({ WEBHOOK_ALLOW_PRIVATE: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(privateTargetsAllowed({ WEBHOOK_ALLOW_PRIVATE: 'true', NODE_ENV: 'development' })).toBe(true);
    expect(privateTargetsAllowed({ NODE_ENV: 'development' })).toBe(false);
  });
});

describe('urlForLog', () => {
  it('keeps only scheme and host', () => {
    expect(urlForLog('https://hooks.example.com/path/SECRET?token=abc')).toBe('https://hooks.example.com');
  });
});

// Local fixtures only: a receiver on 127.0.0.1 and a resolver that says
// what a (pretend) DNS answers. Nothing leaves the machine.
describe('postToPublicUrl', () => {
  const servers: (http.Server | https.Server)[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  async function receiver(handler?: http.RequestListener) {
    const hits: { host?: string; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        hits.push({ host: req.headers.host, body });
        if (handler) handler(req, res);
        else res.end('ok');
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { port: (server.address() as AddressInfo).port, hits };
  }

  it('connects to the address the check approved, keeping the host name', async () => {
    const { port, hits } = await receiver();
    // allowPrivate only so the 127.0.0.1 fixture can stand in for the
    // approved address; the name itself is never looked up in real DNS.
    const status = await postToPublicUrl(`http://hook.example:${port}/in`, '{"a":1}', { 'Content-Type': 'application/json' }, { allowPrivate: true, timeoutMs: 2000, resolve: resolvesTo('127.0.0.1') });
    expect(status).toBe(200);
    expect(hits).toEqual([{ host: `hook.example:${port}`, body: '{"a":1}' }]);
  });

  it('refuses when the name points at a private address, and nothing is sent', async () => {
    const { port, hits } = await receiver();
    await expect(postToPublicUrl(`http://hook.example:${port}/in`, '{}', {}, { timeoutMs: 2000, resolve: resolvesTo('127.0.0.1') })).rejects.toBeInstanceOf(OutboundUrlError);
    expect(hits).toHaveLength(0);
  });

  it('DNS rebinding: a public answer for the check and a private one for the connection is refused', async () => {
    const { port, hits } = await receiver();
    let calls = 0;
    const rebinding: Resolver = async () => (++calls === 1 ? ['93.184.216.34'] : ['127.0.0.1']);
    await expect(postToPublicUrl(`http://hook.example:${port}/in`, '{}', {}, { timeoutMs: 2000, resolve: rebinding })).rejects.toThrow(/Ichki tarmoq/);
    expect(calls).toBe(2); // the connection asked again and got the checked answer
    expect(hits).toHaveLength(0);
  });

  it('does not follow redirects', async () => {
    const target = await receiver();
    const { port } = await receiver((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/stolen` });
      res.end();
    });
    const status = await postToPublicUrl(`http://hook.example:${port}/in`, '{}', {}, { allowPrivate: true, timeoutMs: 2000, resolve: resolvesTo('127.0.0.1') });
    expect(status).toBe(302);
    expect(target.hits).toHaveLength(0);
  });

  it('times out the whole operation: a resolver that never answers', async () => {
    const started = Date.now();
    const hang: Resolver = () => new Promise(() => undefined);
    await expect(postToPublicUrl('http://hook.example/in', '{}', {}, { timeoutMs: 150, resolve: hang })).rejects.toThrow(/vaqti tugadi/);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('times out the whole operation: a receiver that never answers', async () => {
    const { port } = await receiver(() => undefined);
    await expect(postToPublicUrl(`http://hook.example:${port}/in`, '{}', {}, { allowPrivate: true, timeoutMs: 200, resolve: resolvesTo('127.0.0.1') })).rejects.toThrow(/vaqti tugadi/);
  });

  it('keeps verifying the TLS certificate against the host name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outbound-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=hook.example', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
    let reached = false;
    const server = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (_req, res) => {
      reached = true;
      res.end('ok');
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    // Self-signed, so an untrusting client must refuse it.
    await expect(postToPublicUrl(`https://hook.example:${port}/in`, '{}', {}, { allowPrivate: true, timeoutMs: 3000, resolve: resolvesTo('127.0.0.1') })).rejects.toThrow(/self[- ]signed|certificate/i);
    expect(reached).toBe(false);
  });
});
