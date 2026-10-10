import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsCrypto } from './settings-crypto';

const key = () => randomBytes(32).toString('base64');

describe('SettingsCrypto', () => {
  it('exists only with a 32-byte base64 key', () => {
    expect(SettingsCrypto.fromEnv(undefined)).toBeNull();
    expect(SettingsCrypto.fromEnv('  ')).toBeNull();
    expect(SettingsCrypto.fromEnv(randomBytes(16).toString('base64'))).toBeNull();
    expect(SettingsCrypto.fromEnv(key())).not.toBeNull();
  });

  it('opens what it sealed, and never stores the value as written', () => {
    const crypto = SettingsCrypto.fromEnv(key())!;
    const sealed = crypto.seal('GEMINI_API_KEY', 'AIza-secret-value');
    expect(sealed).not.toContain('AIza-secret-value');
    expect(crypto.open('GEMINI_API_KEY', sealed)).toBe('AIza-secret-value');
    // A fresh nonce every time: the same value never seals to the same text.
    expect(crypto.seal('GEMINI_API_KEY', 'AIza-secret-value')).not.toBe(sealed);
  });

  it('does not open under another key, another name, or after a change', () => {
    const crypto = SettingsCrypto.fromEnv(key())!;
    const sealed = crypto.seal('PAYME_KEY', 'merchant-secret');
    expect(() => SettingsCrypto.fromEnv(key())!.open('PAYME_KEY', sealed)).toThrow();
    expect(() => crypto.open('PLATFORM_PAYME_KEY', sealed)).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('other-secret-xx').toString('base64url');
    expect(() => crypto.open('PAYME_KEY', parts.join('.'))).toThrow();
    expect(() => crypto.open('PAYME_KEY', 'plain text')).toThrow();
  });
});

describe('stored settings over the environment', () => {
  const names = ['GEMINI_API_KEY', 'ESKIZ_SENDER', 'JWT_SECRET'];
  const before = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  // The module remembers the environment as it first saw it (what .env
  // had): each test starts it afresh, as a server start does.
  let mod: typeof import('./stored-settings');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./stored-settings');
  });
  afterEach(() => {
    for (const n of names) {
      if (before[n] === undefined) delete process.env[n];
      else process.env[n] = before[n];
    }
  });

  it("offers integration keys only, never the server's own secrets", () => {
    for (const forbidden of ['DATABASE_URL', 'JWT_SECRET', 'SETTINGS_KEY', 'CALENDAR_TOKEN_KEY', 'FILE_URL_SECRET', 'NODE_ENV']) {
      expect(mod.EDITABLE.has(forbidden)).toBe(false);
    }
    expect(mod.EDITABLE.get('GEMINI_API_KEY')?.secret).toBe(true);
    expect(mod.EDITABLE.get('GEMINI_MODEL')?.secret).toBe(false);
  });

  it('a stored value wins over .env, and removing it brings the .env value back', () => {
    process.env.ESKIZ_SENDER = 'from-env';
    mod.applySettings(new Map());
    expect(mod.sourceOf('ESKIZ_SENDER')).toBe('env');

    mod.applySettings(new Map([['ESKIZ_SENDER', 'from-panel']]));
    expect(process.env.ESKIZ_SENDER).toBe('from-panel');
    expect(mod.sourceOf('ESKIZ_SENDER')).toBe('panel');

    mod.applySettings(new Map());
    expect(process.env.ESKIZ_SENDER).toBe('from-env');
    expect(mod.sourceOf('ESKIZ_SENDER')).toBe('env');
  });

  it('a name with nothing in .env is unset again once its stored value is removed', () => {
    delete process.env.GEMINI_API_KEY;
    mod.applySettings(new Map([['GEMINI_API_KEY', 'from-panel']]));
    expect(process.env.GEMINI_API_KEY).toBe('from-panel');
    mod.applySettings(new Map());
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(mod.sourceOf('GEMINI_API_KEY')).toBeNull();
  });

  it('a name that is not an integration key is ignored even when it is in the table', () => {
    const crypto = SettingsCrypto.fromEnv(key())!;
    const jwt = process.env.JWT_SECRET;
    const { values, unreadable } = mod.openRows(crypto, [
      { key: 'JWT_SECRET', value: crypto.seal('JWT_SECRET', 'attacker-chosen') },
      { key: 'GEMINI_API_KEY', value: crypto.seal('GEMINI_API_KEY', 'real') },
      { key: 'ESKIZ_SENDER', value: 'not sealed at all' },
    ]);
    expect([...values.keys()]).toEqual(['GEMINI_API_KEY']);
    expect(unreadable).toEqual(['ESKIZ_SENDER']);
    mod.applySettings(values);
    expect(process.env.JWT_SECRET).toBe(jwt);
    expect(process.env.GEMINI_API_KEY).toBe('real');
  });
});
