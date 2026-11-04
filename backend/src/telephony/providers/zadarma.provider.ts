import { createHash, createHmac, timingSafeEqual } from 'crypto';
import {
  CallEvent,
  TelephonyCredentials,
  TelephonyProvider,
  TelephonyProviderError,
  type TelephonyProviderName,
} from './telephony-provider.interface';

/**
 * Zadarma (https://zadarma.com/en/support/api/), as its documentation
 * describes it:
 *
 * - API requests carry `Authorization: <key>:<signature>`. The parameters
 *   are sorted by name and joined as PHP's http_build_query (RFC 1738:
 *   spaces as '+'); signature = base64(hex(HMAC-SHA1(secret,
 *   method + params + md5(params)))), where method is the path with the
 *   version, e.g. "/v1/request/callback/".
 * - Call notifications are POSTed form fields with a `Signature` header,
 *   base64(hex(HMAC-SHA1(secret, s))), where s joins fields that depend on
 *   the event (SIGNED_FIELDS below).
 * - When the URL is saved in the Zadarma cabinet it is checked with
 *   GET ?zd_echo=X, answered with X.
 *
 * The docs say nothing about repeated deliveries; call_events.dedupe_key
 * makes a repeat harmless either way.
 */

/** The fields each notification's signature covers, in order (from the docs). */
export const SIGNED_FIELDS: Record<string, string[]> = {
  NOTIFY_START: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_INTERNAL: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_ANSWER: ['caller_id', 'destination', 'call_start'],
  NOTIFY_END: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_OUT_START: ['internal', 'destination', 'call_start'],
  NOTIFY_OUT_END: ['internal', 'destination', 'call_start'],
  NOTIFY_RECORD: ['pbx_call_id', 'call_id_with_rec'],
  NOTIFY_IVR: ['caller_id', 'called_did', 'call_start'],
};

const hmacSha1Hex = (secret: string, data: string) => createHmac('sha1', secret).update(data, 'utf8').digest('hex');

/** PHP's urlencode (what http_build_query with PHP_QUERY_RFC1738 uses). */
export function phpUrlEncode(v: string): string {
  return encodeURIComponent(v)
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

/** http_build_query of the parameters sorted by name (ksort). */
export function zadarmaQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${phpUrlEncode(k)}=${phpUrlEncode(params[k])}`)
    .join('&');
}

export function zadarmaApiSignature(method: string, query: string, secret: string): string {
  const md5 = createHash('md5').update(query, 'utf8').digest('hex');
  return Buffer.from(hmacSha1Hex(secret, method + query + md5), 'utf8').toString('base64');
}

/** The Signature header Zadarma sends with this notification; null for an event it does not sign. */
export function zadarmaWebhookSignature(body: Record<string, string>, secret: string): string | null {
  const fields = SIGNED_FIELDS[body.event ?? ''];
  if (!fields) return null;
  const data = fields.map((f) => body[f] ?? '').join('');
  return Buffer.from(hmacSha1Hex(secret, data), 'utf8').toString('base64');
}

const header = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

const num = (v: string | undefined) => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const dedupe = (parts: Array<string | undefined>) => createHash('sha256').update(parts.map((p) => p ?? '').join('|')).digest('hex');

export interface ZadarmaOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** The provider name events are stored under (MOCK reuses Zadarma's format). */
  name?: TelephonyProviderName;
}

export class ZadarmaProvider implements TelephonyProvider {
  readonly name: TelephonyProviderName;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ZadarmaOptions = {}) {
    this.name = opts.name ?? 'ZADARMA';
    this.baseUrl = (opts.baseUrl || 'https://api.zadarma.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  handshake(query: Record<string, unknown>): string | null {
    const echo = query.zd_echo;
    // Only a plain, short token is echoed back: the response is ours, not a reflection channel.
    return typeof echo === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(echo) ? echo : null;
  }

  verify(body: Record<string, string>, headers: Record<string, string | string[] | undefined>, creds: TelephonyCredentials): boolean {
    const got = header(headers, 'signature');
    const want = zadarmaWebhookSignature(body, creds.apiSecret);
    if (!got || !want) return false;
    const a = Buffer.from(got);
    const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parse(body: Record<string, string>): CallEvent | null {
    const event = body.event;
    const callId = body.pbx_call_id;
    if (!event || !SIGNED_FIELDS[event] || !callId) return null;
    const base = {
      eventType: event,
      providerCallId: callId,
      dedupeKey: dedupe([event, callId, body.call_start, body.internal, body.call_id_with_rec, body.disposition]),
    };
    const ended = (disposition: string | undefined) => ({
      durationSec: num(body.duration),
      disposition: disposition ?? null,
      answered: disposition === 'answered',
      hasRecording: body.is_recorded === '1',
      recordingRef: body.is_recorded === '1' ? body.call_id_with_rec || null : null,
    });
    switch (event) {
      case 'NOTIFY_START':
        return { ...base, kind: 'INBOUND_START', clientNumber: body.caller_id, lineNumber: body.called_did, callerNumber: body.caller_id, calledNumber: body.called_did };
      case 'NOTIFY_INTERNAL':
        return { ...base, kind: 'RINGING_EXTENSION', clientNumber: body.caller_id, lineNumber: body.called_did, callerNumber: body.caller_id, calledNumber: body.called_did, extension: body.internal || null };
      case 'NOTIFY_ANSWER':
        return { ...base, kind: 'ANSWERED', extension: body.internal || null };
      case 'NOTIFY_END':
        return {
          ...base, kind: 'INBOUND_END', clientNumber: body.caller_id, lineNumber: body.called_did, callerNumber: body.caller_id, calledNumber: body.called_did,
          // After a transfer or a pickup, the last one on the line is the one who talked.
          extension: body.last_internal || body.internal || null,
          ...ended(body.disposition),
        };
      case 'NOTIFY_OUT_START':
        return { ...base, kind: 'OUTBOUND_START', clientNumber: body.destination, callerNumber: body.internal || null, calledNumber: body.destination, extension: body.internal || null };
      case 'NOTIFY_OUT_END':
        return {
          ...base, kind: 'OUTBOUND_END', clientNumber: body.destination, callerNumber: body.caller_id || body.internal || null, calledNumber: body.destination,
          extension: body.internal || null, ...ended(body.disposition),
        };
      case 'NOTIFY_RECORD':
        return { ...base, kind: 'RECORDING_READY', recordingRef: body.call_id_with_rec || null, hasRecording: Boolean(body.call_id_with_rec) };
      default:
        return { ...base, kind: 'IGNORED' };
    }
  }

  async testCredentials(creds: TelephonyCredentials) {
    try {
      await this.api(creds, '/v1/info/balance/', {});
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof TelephonyProviderError ? e.message : "Zadarma bilan bog'lanib bo'lmadi" };
    }
  }

  async startCallback(creds: TelephonyCredentials, call: { extension: string; to: string }) {
    // from: the manager's extension is rung first; sip: the call is made as
    // that extension (its caller id, its recording settings, its statistics).
    await this.api(creds, '/v1/request/callback/', { from: call.extension, to: call.to.replace(/\D/g, ''), sip: call.extension });
  }

  async recordingLink(creds: TelephonyCredentials, call: { providerCallId: string; recordingRef: string | null }) {
    const params: Record<string, string> = call.recordingRef ? { call_id: call.recordingRef } : { pbx_call_id: call.providerCallId };
    params.lifetime = '1800';
    const res = (await this.api(creds, '/v1/pbx/record/request/', params)) as { link?: string; links?: string[]; lifetime_till?: string };
    const url = res.link ?? res.links?.[0];
    return url ? { url, expiresAt: res.lifetime_till ?? null } : null;
  }

  /** GET method?params, signed; the JSON answer when its status is success. */
  private async api(creds: TelephonyCredentials, method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const query = zadarmaQuery(params);
    const auth = `${creds.apiKey}:${zadarmaApiSignature(method, query, creds.apiSecret)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${method}${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new TelephonyProviderError("Zadarma bilan bog'lanib bo'lmadi");
    }
    if (res.status === 429) throw new TelephonyProviderError("Zadarma: so'rovlar limiti oshdi, birozdan keyin urinib ko'ring", 429);
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // not JSON: judged by the status below
    }
    if (res.status === 401 || res.status === 403) throw new TelephonyProviderError("Zadarma kalitlari noto'g'ri", res.status);
    if (!res.ok || body.status !== 'success') {
      const msg = typeof body.message === 'string' ? body.message.slice(0, 200) : `HTTP ${res.status}`;
      throw new TelephonyProviderError(`Zadarma: ${msg}`, res.status);
    }
    return body;
  }
}
