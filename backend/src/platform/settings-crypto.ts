import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM for the integration keys kept in platform_settings.
 * SETTINGS_KEY is a base64 32-byte key that exists only in the server's
 * environment. There is no fallback key: without it nothing is stored, so a
 * key can never end up sealed under a secret that was meant for something
 * else (and rotated for other reasons).
 */
export class SettingsCrypto {
  private constructor(private readonly key: Buffer) {}

  /** null when SETTINGS_KEY is missing or is not 32 bytes of base64. */
  static fromEnv(raw: string | undefined): SettingsCrypto | null {
    const value = raw?.trim();
    if (!value) return null;
    const key = Buffer.from(value, 'base64');
    return key.length === 32 ? new SettingsCrypto(key) : null;
  }

  /** The setting's name is bound into the seal: a row copied under another name does not open. */
  seal(name: string, plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(name, 'utf8'));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
  }

  open(name: string, sealed: string): string {
    const [v, iv, tag, ct] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('unreadable setting');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(name, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
}
