import { describe, expect, it, vi } from 'vitest';
import { phpUrlEncode, zadarmaApiSignature, zadarmaQuery, zadarmaWebhookSignature, ZadarmaProvider } from './zadarma.provider';

// Expected values were produced by PHP itself, with the code from Zadarma's
// documentation (base64_encode(hash_hmac('sha1', ...)), ksort +
// http_build_query(..., PHP_QUERY_RFC1738)), not by this implementation.
const SECRET = 'testsecret';
const CREDS = { apiKey: 'key123', apiSecret: SECRET };

const start = { event: 'NOTIFY_START', call_start: '2026-11-04 10:00:00', pbx_call_id: 'in_1', caller_id: '+998901234567', called_did: '+998712000000' };

describe('Zadarma signatures', () => {
  it('signs a webhook as PHP does: caller_id . called_did . call_start', () => {
    expect(zadarmaWebhookSignature(start, SECRET)).toBe('Njc2YjVjY2IzY2U1MGY4NmFkNTA4ZGQ0OWFjOTRmYTdkMDNkYmRhMA==');
  });

  it('outgoing events are signed over internal . destination . call_start', () => {
    const out = { event: 'NOTIFY_OUT_START', call_start: '2026-11-04 10:05:00', pbx_call_id: 'out_1', internal: '100', destination: '998901234567' };
    expect(zadarmaWebhookSignature(out, SECRET)).toBe('NGEyZGQ2ZGE5NjcyMGU0ZTVjZWExNjNhNWMzM2M2ZDQ3YmE5NWJhMg==');
  });

  it('a recording event is signed over pbx_call_id . call_id_with_rec', () => {
    const rec = { event: 'NOTIFY_RECORD', pbx_call_id: 'in_1730000000.123', call_id_with_rec: '1730000000.123456' };
    expect(zadarmaWebhookSignature(rec, SECRET)).toBe('MTUxNjVjNWU2M2JmZjY0MGRhYjY4OWFjYzU2MTQxNDZhZDEyMGQyYg==');
  });

  it('an event it does not know has no signature', () => {
    expect(zadarmaWebhookSignature({ event: 'NUMBER_LOOKUP' }, SECRET)).toBeNull();
  });

  it('signs an API request as PHP does (sorted, RFC 1738, method + query + md5)', () => {
    const q = zadarmaQuery({ to: '998901234567', from: '100', sip: '100' });
    expect(q).toBe('from=100&sip=100&to=998901234567');
    expect(zadarmaApiSignature('/v1/request/callback/', q, SECRET)).toBe('NWYyZWVjZTQxZDhkNzIyY2UxYThlMGU1ZGMzZDJlM2YzZDM2ZWY4YQ==');
    const q2 = zadarmaQuery({ lifetime: '1800', call_id: '1730000000.123456' });
    expect(q2).toBe('call_id=1730000000.123456&lifetime=1800');
    expect(zadarmaApiSignature('/v1/pbx/record/request/', q2, SECRET)).toBe('NWE0ZmFhZGQxNjY0YTVmNDEyOGY1N2UzMGNkMGE4MjkxNTc0ZTRmMg==');
  });

  it("encodes like PHP's urlencode", () => {
    // PHP: http_build_query(["a"=>"x y*~!('),"b"=>"+998 90"]) === a=x+y%2A%7E%21%28%27%29&b=%2B998+90
    expect(`a=${phpUrlEncode("x y*~!(')")}&b=${phpUrlEncode('+998 90')}`).toBe('a=x+y%2A%7E%21%28%27%29&b=%2B998+90');
  });
});

describe('ZadarmaProvider', () => {
  const p = new ZadarmaProvider();
  const signed = (body: Record<string, string>) => ({ signature: zadarmaWebhookSignature(body, SECRET)! });

  it('accepts a correctly signed event and refuses a wrong or missing signature, or another secret', () => {
    expect(p.verify(start, signed(start), CREDS)).toBe(true);
    expect(p.verify(start, {}, CREDS)).toBe(false);
    expect(p.verify(start, { signature: 'bm9wZQ==' }, CREDS)).toBe(false);
    expect(p.verify(start, signed(start), { ...CREDS, apiSecret: 'other' })).toBe(false);
    // A field changed after signing.
    expect(p.verify({ ...start, caller_id: '+998900000000' }, signed(start), CREDS)).toBe(false);
  });

  it('reads the events in our terms', () => {
    expect(p.parse(start)).toMatchObject({ kind: 'INBOUND_START', providerCallId: 'in_1', clientNumber: '+998901234567', lineNumber: '+998712000000' });
    expect(p.parse({ ...start, event: 'NOTIFY_INTERNAL', internal: '100' })).toMatchObject({ kind: 'RINGING_EXTENSION', extension: '100' });
    expect(p.parse({ event: 'NOTIFY_ANSWER', pbx_call_id: 'in_1', caller_id: '+998901234567', destination: '100', call_start: '2026-11-04 10:00:00', internal: '100' }))
      .toMatchObject({ kind: 'ANSWERED', extension: '100' });
    expect(p.parse({ ...start, event: 'NOTIFY_END', internal: '100', last_internal: '101', duration: '95', disposition: 'answered', is_recorded: '1', call_id_with_rec: 'rec1' }))
      .toMatchObject({ kind: 'INBOUND_END', extension: '101', durationSec: 95, answered: true, hasRecording: true, recordingRef: 'rec1' });
    expect(p.parse({ ...start, event: 'NOTIFY_END', duration: '0', disposition: 'no answer', is_recorded: '0' }))
      .toMatchObject({ kind: 'INBOUND_END', answered: false, hasRecording: false, recordingRef: null });
    expect(p.parse({ event: 'NOTIFY_OUT_START', pbx_call_id: 'out_1', internal: '100', destination: '998901234567', call_start: 'x' }))
      .toMatchObject({ kind: 'OUTBOUND_START', clientNumber: '998901234567', extension: '100' });
    expect(p.parse({ event: 'NOTIFY_IVR', pbx_call_id: 'in_1', caller_id: '1', called_did: '2', call_start: '3' })).toMatchObject({ kind: 'IGNORED' });
    expect(p.parse({ event: 'NOTIFY_START' })).toBeNull(); // no call id
    expect(p.parse({ event: 'SMS', pbx_call_id: 'x' })).toBeNull();
  });

  it('the same event always gives the same dedupe key; another event of the call another', () => {
    const a = p.parse(start)!.dedupeKey;
    expect(p.parse({ ...start })!.dedupeKey).toBe(a);
    expect(p.parse({ ...start, event: 'NOTIFY_INTERNAL', internal: '100' })!.dedupeKey).not.toBe(a);
    // Two extensions rung for one call are two events.
    expect(p.parse({ ...start, event: 'NOTIFY_INTERNAL', internal: '100' })!.dedupeKey)
      .not.toBe(p.parse({ ...start, event: 'NOTIFY_INTERNAL', internal: '101' })!.dedupeKey);
  });

  it('echoes only a plain zd_echo token', () => {
    expect(p.handshake({ zd_echo: 'abc123' })).toBe('abc123');
    expect(p.handshake({ zd_echo: '<script>' })).toBeNull();
    expect(p.handshake({})).toBeNull();
  });

  it('calls the API with the signed Authorization header, and reads errors', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'success', from: 100, to: 998901234567, time: 1 }), { status: 200 }));
    const z = new ZadarmaProvider({ baseUrl: 'https://api.example.test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await z.startCallback(CREDS, { extension: '100', to: '+998 90 123 45 67' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/request/callback/?from=100&sip=100&to=998901234567');
    expect((init.headers as Record<string, string>).Authorization).toBe('key123:NWYyZWVjZTQxZDhkNzIyY2UxYThlMGU1ZGMzZDJlM2YzZDM2ZWY4YQ==');

    const failing = new ZadarmaProvider({ fetchImpl: (async () => new Response(JSON.stringify({ status: 'error', message: 'Check phone number' }), { status: 200 })) as unknown as typeof fetch });
    await expect(failing.startCallback(CREDS, { extension: '100', to: '1' })).rejects.toThrow('Zadarma: Check phone number');
    const limited = new ZadarmaProvider({ fetchImpl: (async () => new Response('', { status: 429 })) as unknown as typeof fetch });
    expect(await limited.testCredentials(CREDS)).toMatchObject({ ok: false });
  });

  it('asks for a recording link by the recording id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'success', link: 'https://api.zadarma.com/v1/pbx/record/download/x.mp3', lifetime_till: '2026-11-04 11:00:00' }), { status: 200 }));
    const z = new ZadarmaProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await z.recordingLink(CREDS, { providerCallId: 'in_1', recordingRef: '1730000000.123456' }))
      .toEqual({ url: 'https://api.zadarma.com/v1/pbx/record/download/x.mp3', expiresAt: '2026-11-04 11:00:00' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.zadarma.com/v1/pbx/record/request/?call_id=1730000000.123456&lifetime=1800');
    expect((init.headers as Record<string, string>).Authorization).toBe('key123:NWE0ZmFhZGQxNjY0YTVmNDEyOGY1N2UzMGNkMGE4MjkxNTc0ZTRmMg==');
  });
});
