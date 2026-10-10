import { Client } from 'pg';
import { SettingsCrypto } from './settings-crypto';

export interface SettingKey {
  name: string;
  /** A secret is never sent back to the panel; other values (ids, addresses) are shown. */
  secret: boolean;
}

export interface IntegrationDef {
  id: string;
  group: 'ai' | 'messaging' | 'payments' | 'other';
  keys: SettingKey[];
  /** Connected when every name of any one of these sets has a value. */
  need: string[][];
  /** These names are read once when the server starts: a change needs a restart. */
  restart?: boolean;
}

const s = (name: string): SettingKey => ({ name, secret: true });
const v = (name: string): SettingKey => ({ name, secret: false });

/**
 * What the platform admin may enter in the panel. Only integration keys:
 * the database address, the sign-in secret and the encryption keys
 * themselves are not here and can never be changed from a browser.
 */
export const INTEGRATIONS: IntegrationDef[] = [
  { id: 'ai', group: 'ai', keys: [s('ANTHROPIC_API_KEY'), s('GEMINI_API_KEY'), v('GEMINI_MODEL')], need: [['ANTHROPIC_API_KEY'], ['GEMINI_API_KEY']] },
  { id: 'translate', group: 'ai', keys: [s('GOOGLE_TRANSLATE_API_KEY')], need: [['GOOGLE_TRANSLATE_API_KEY']] },
  { id: 'telegram', group: 'messaging', keys: [s('TELEGRAM_BOT_TOKEN'), v('TELEGRAM_BOT_USERNAME'), s('TELEGRAM_WEBHOOK_SECRET')], need: [['TELEGRAM_BOT_TOKEN']], restart: true },
  { id: 'email', group: 'messaging', keys: [s('RESEND_API_KEY'), v('EMAIL_FROM'), v('SMTP_HOST'), v('SMTP_PORT'), v('SMTP_USER'), s('SMTP_PASS'), v('SMTP_FROM')], need: [['RESEND_API_KEY'], ['SMTP_HOST']], restart: true },
  { id: 'sms', group: 'messaging', keys: [s('ESKIZ_API_TOKEN'), v('ESKIZ_SENDER'), s('PLAYMOBILE_API_TOKEN'), v('PLAYMOBILE_ORIGINATOR')], need: [['ESKIZ_API_TOKEN'], ['PLAYMOBILE_API_TOKEN']] },
  { id: 'platformClick', group: 'payments', keys: [v('PLATFORM_CLICK_MERCHANT_ID'), v('PLATFORM_CLICK_SERVICE_ID'), s('PLATFORM_CLICK_SECRET_KEY')], need: [['PLATFORM_CLICK_MERCHANT_ID', 'PLATFORM_CLICK_SERVICE_ID', 'PLATFORM_CLICK_SECRET_KEY']] },
  { id: 'platformPayme', group: 'payments', keys: [v('PLATFORM_PAYME_MERCHANT_ID'), s('PLATFORM_PAYME_KEY')], need: [['PLATFORM_PAYME_MERCHANT_ID', 'PLATFORM_PAYME_KEY']] },
  { id: 'centerClick', group: 'payments', keys: [v('CLICK_MERCHANT_ID'), v('CLICK_SERVICE_ID'), s('CLICK_SECRET_KEY')], need: [['CLICK_MERCHANT_ID', 'CLICK_SERVICE_ID', 'CLICK_SECRET_KEY']] },
  { id: 'centerPayme', group: 'payments', keys: [v('PAYME_MERCHANT_ID'), s('PAYME_KEY')], need: [['PAYME_MERCHANT_ID', 'PAYME_KEY']] },
  { id: 'googleCalendar', group: 'other', keys: [v('GOOGLE_CLIENT_ID'), s('GOOGLE_CLIENT_SECRET'), v('GOOGLE_REDIRECT_URI')], need: [['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']], restart: true },
  { id: 'sentry', group: 'other', keys: [s('SENTRY_DSN')], need: [['SENTRY_DSN']], restart: true },
];

export const EDITABLE = new Map(INTEGRATIONS.flatMap((i) => i.keys).map((k) => [k.name, k]));

// The environment as the server found it (the .env file), per editable name:
// what a name goes back to when its row is removed.
const baseline = new Map<string, string | undefined>();
let fromPanel = new Set<string>();

/**
 * Puts the stored values where the rest of the server reads its settings
 * (process.env, through ConfigService), over the values from .env. A name
 * with no stored value goes back to what .env had.
 */
export function applySettings(stored: Map<string, string>): void {
  for (const name of EDITABLE.keys()) {
    if (!baseline.has(name)) baseline.set(name, process.env[name]);
    const value = stored.get(name);
    if (value !== undefined) {
      process.env[name] = value;
    } else if (fromPanel.has(name)) {
      const original = baseline.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  }
  fromPanel = new Set([...stored.keys()].filter((name) => EDITABLE.has(name)));
}

/** Where a name's current value comes from. */
export function sourceOf(name: string): 'panel' | 'env' | null {
  if (fromPanel.has(name)) return 'panel';
  return process.env[name]?.trim() ? 'env' : null;
}

/** Rows as stored -> the values that open under this key. A row that does not open is skipped and named. */
export function openRows(crypto: SettingsCrypto, rows: Array<{ key: string; value: string }>): { values: Map<string, string>; unreadable: string[] } {
  const values = new Map<string, string>();
  const unreadable: string[] = [];
  for (const row of rows) {
    if (!EDITABLE.has(row.key)) continue;
    try {
      values.set(row.key, crypto.open(row.key, row.value));
    } catch {
      unreadable.push(row.key);
    }
  }
  return { values, unreadable };
}

/**
 * Before the application is built: the stored keys go into the environment
 * so that everything read at start-up (the mail transport, Sentry, the
 * Telegram poller) sees them. A database that is not reachable or not
 * migrated yet is not a reason to refuse to start: the server then runs on
 * .env alone, as it did before this table existed.
 */
export async function loadStoredSettingsAtBoot(log: (message: string) => void = () => undefined): Promise<void> {
  const crypto = SettingsCrypto.fromEnv(process.env.SETTINGS_KEY);
  if (!crypto || !process.env.DATABASE_URL) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const res = await client.query<{ key: string; value: string }>('SELECT key, value FROM platform_settings');
    const { values, unreadable } = openRows(crypto, res.rows);
    applySettings(values);
    if (values.size) log(`Platform settings: ${values.size} value(s) from the panel in use`);
    if (unreadable.length) log(`Platform settings: could not open ${unreadable.join(', ')} (was SETTINGS_KEY changed?)`);
  } catch (err) {
    log(`Platform settings: not loaded (${(err as Error).message})`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
