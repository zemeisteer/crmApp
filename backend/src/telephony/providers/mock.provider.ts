import { TelephonyCredentials } from './telephony-provider.interface';
import { ZadarmaProvider } from './zadarma.provider';

/**
 * The local stand-in: webhooks in Zadarma's format and signature (so
 * scripts/telephony-mock-call.cjs drives both), and no request ever leaves
 * the server. Click-to-call and recordings are answered locally. Refused in
 * production (TelephonyAccountsService).
 */
export class MockTelephonyProvider extends ZadarmaProvider {
  /** Click-to-call requests it was asked for, newest last (for tests and the local simulator). */
  readonly callbacks: Array<{ extension: string; to: string; at: Date }> = [];

  constructor() {
    super({ name: 'MOCK', baseUrl: 'http://mock.invalid', fetchImpl: () => Promise.reject(new Error('the mock provider makes no requests')) });
  }

  override async testCredentials(creds: TelephonyCredentials) {
    return creds.apiKey && creds.apiSecret ? { ok: true } : { ok: false, message: "Kalit va secret kerak" };
  }

  override async startCallback(_creds: TelephonyCredentials, call: { extension: string; to: string }) {
    this.callbacks.push({ ...call, at: new Date() });
    if (this.callbacks.length > 50) this.callbacks.shift();
  }

  override async recordingLink(_creds: TelephonyCredentials, call: { providerCallId: string; recordingRef: string | null }) {
    if (!call.recordingRef) return null;
    // A short tone served by the frontend itself (frontend/public/telephony/), so ▶ really plays.
    return { url: `/telephony/mock-recording.wav#${encodeURIComponent(call.recordingRef)}`, expiresAt: null };
  }
}
