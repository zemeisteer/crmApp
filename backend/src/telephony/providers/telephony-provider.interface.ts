/**
 * One IP-telephony provider (Zadarma today; Novofon, Binotel, ... later).
 * Everything provider-specific lives behind this interface: how a webhook is
 * verified and read, and how the provider's API is called. The rest of
 * telephony/ only sees CallEvent and these methods.
 */
export type TelephonyProviderName = 'ZADARMA' | 'MOCK';

/** A center's opened credentials (the secret already unsealed). */
export interface TelephonyCredentials {
  apiKey: string;
  apiSecret: string;
}

/** What one webhook event says, in our terms. */
export type CallEventKind =
  | 'INBOUND_START' // a call came into the center's line
  | 'RINGING_EXTENSION' // it rings a manager's extension
  | 'ANSWERED' // someone picked up
  | 'INBOUND_END'
  | 'OUTBOUND_START' // a manager calls out (or a click-to-call)
  | 'OUTBOUND_END'
  | 'RECORDING_READY'
  | 'IGNORED'; // an event this module does not use (IVR digits, ...): stored, nothing else

export interface CallEvent {
  kind: CallEventKind;
  /** The provider's raw event name, e.g. NOTIFY_START. */
  eventType: string;
  /** The provider's id of the whole call (Zadarma: pbx_call_id). */
  providerCallId: string;
  /** Identifies this event among repeated deliveries: the same event gives the same key. */
  dedupeKey: string;
  /** The outside party, as the provider wrote it (not normalized). */
  clientNumber?: string | null;
  /** The center's own line (the number that was called, for an incoming call). */
  lineNumber?: string | null;
  callerNumber?: string | null;
  calledNumber?: string | null;
  /** The manager's extension, when the event names one. */
  extension?: string | null;
  durationSec?: number | null;
  /** The provider's word for how the call ended ('answered', 'busy', 'no answer', ...). */
  disposition?: string | null;
  /** For *_END: whether there was a conversation. */
  answered?: boolean;
  recordingRef?: string | null;
  hasRecording?: boolean;
}

export interface TelephonyProvider {
  readonly name: TelephonyProviderName;

  /**
   * The URL check some providers make when the address is saved in their
   * cabinet (Zadarma: GET ?zd_echo=X, answered with X). The text to answer
   * with, or null when the request is not such a check.
   */
  handshake(query: Record<string, unknown>): string | null;

  /** Whether the event really comes from the provider, checked with this center's secret. */
  verify(body: Record<string, string>, headers: Record<string, string | string[] | undefined>, creds: TelephonyCredentials): boolean;

  /** The event in our terms; null when the body is not an event at all. */
  parse(body: Record<string, string>): CallEvent | null;

  /** Checks the keys against the provider (the settings page's "Check" button). */
  testCredentials(creds: TelephonyCredentials): Promise<{ ok: boolean; message?: string }>;

  /**
   * Click-to-call: the provider rings the manager's extension first, then
   * connects the client.
   */
  startCallback(creds: TelephonyCredentials, call: { extension: string; to: string }): Promise<void>;

  /** A playable, short-lived link to a call's recording, or null when there is none. */
  recordingLink(creds: TelephonyCredentials, call: { providerCallId: string; recordingRef: string | null }): Promise<{ url: string; expiresAt: string | null } | null>;
}

/** The provider's API refused or could not be reached; message is safe to show staff. */
export class TelephonyProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}
