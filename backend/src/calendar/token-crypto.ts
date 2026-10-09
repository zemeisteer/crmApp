import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * AES-256-GCM for OAuth tokens at rest. CALENDAR_TOKEN_KEY is a base64
 * 32-byte key (production); without it a key is derived from JWT_SECRET so
 * development works, and the service logs that it should be set.
 */
export class TokenCrypto {
  private readonly key: Buffer;
  readonly dedicated: boolean;

  constructor(env: { CALENDAR_TOKEN_KEY?: string; JWT_SECRET?: string }) {
    const raw = env.CALENDAR_TOKEN_KEY ? Buffer.from(env.CALENDAR_TOKEN_KEY, 'base64') : null;
    if (raw && raw.length !== 32) throw new Error('CALENDAR_TOKEN_KEY must be 32 bytes, base64-encoded');
    this.dedicated = !!raw;
    this.key = raw ?? createHmac('sha256', env.JWT_SECRET ?? '').update('talimcrm:calendar-token-key:v1').digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
  }

  decrypt(sealed: string): string {
    const [v, iv, tag, ct] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('unreadable token');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
}
