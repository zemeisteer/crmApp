import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { platformSettings, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { TranslateService } from '../plans/translate.service';
import { SettingsCrypto } from './settings-crypto';
import { applySettings, INTEGRATIONS, openRows, sourceOf } from './stored-settings';

const RELOAD_MS = 60_000;
const MAX_VALUE_LENGTH = 4000;

@Injectable()
export class PlatformSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly translate: TranslateService,
  ) {}

  private crypto(): SettingsCrypto | null {
    return SettingsCrypto.fromEnv(this.config.get<string>('SETTINGS_KEY'));
  }

  async onModuleInit() {
    await this.reload().catch((err) => this.logger.warn(`settings not loaded: ${(err as Error).message}`));
    // Another instance of the server may have saved a change: pick it up.
    this.timer = setInterval(() => void this.reload().catch(() => undefined), RELOAD_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The stored values, opened and put over .env. */
  async reload(): Promise<void> {
    const crypto = this.crypto();
    if (!crypto) return;
    const rows = await this.db.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings);
    const { values, unreadable } = openRows(crypto, rows);
    applySettings(values);
    if (unreadable.length) this.logger.warn(`could not open ${unreadable.join(', ')} (was SETTINGS_KEY changed?)`);
  }

  private value(name: string): string {
    return this.config.get<string>(name)?.trim() ?? '';
  }

  /**
   * What the panel shows. A secret never leaves the server: only whether it
   * is set, where from, and its last four characters to tell two keys apart.
   */
  list() {
    const ai = this.value('ANTHROPIC_API_KEY') ? 'Claude' : this.value('GEMINI_API_KEY') ? 'Gemini' : null;
    const email = this.value('RESEND_API_KEY') ? 'Resend' : this.value('SMTP_HOST') ? 'SMTP' : null;
    const sms = this.value('ESKIZ_API_TOKEN') ? 'Eskiz' : this.value('PLAYMOBILE_API_TOKEN') ? 'PlayMobile' : null;
    const detail: Record<string, string | null> = { ai, email, sms, translate: this.translate.provider(), telegram: this.value('TELEGRAM_BOT_USERNAME') || null };
    return {
      environment: this.value('NODE_ENV') || 'development',
      rootDomain: this.value('ROOT_DOMAIN') || null,
      // Without SETTINGS_KEY nothing can be sealed: the page is read-only.
      editable: !!this.crypto(),
      items: INTEGRATIONS.map((i) => ({
        id: i.id,
        group: i.group,
        restart: !!i.restart,
        // Translation always has someone to answer (the public endpoint).
        configured: i.id === 'translate' ? !!this.translate.provider() : i.need.some((set) => set.every((name) => !!this.value(name))),
        detail: detail[i.id] ?? null,
        keys: i.keys.map((k) => {
          const value = this.value(k.name);
          return {
            name: k.name,
            secret: k.secret,
            set: !!value,
            source: sourceOf(k.name),
            shown: !value ? null : k.secret ? (value.length >= 12 ? `••••${value.slice(-4)}` : '••••') : value,
          };
        }),
      })),
    };
  }

  /**
   * Saves one integration's keys: a value is sealed and stored, null or ""
   * removes the stored value (the name goes back to .env). The admin's own
   * password is asked for every time: these keys decide where payments and
   * messages go, and an open session alone must not be enough to change them.
   */
  async save(actorId: string, integrationId: string, password: string, values: Record<string, string | null>) {
    const def = INTEGRATIONS.find((i) => i.id === integrationId);
    if (!def) throw new NotFoundException('Integratsiya topilmadi');
    const crypto = this.crypto();
    if (!crypto) {
      throw new ServiceUnavailableException("Kalitlarni saqlash o'chirilgan: serverda SETTINGS_KEY sozlanmagan (backend/.env).");
    }
    const [actor] = await this.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, actorId));
    if (!actor || !(await bcrypt.compare(password, actor.passwordHash))) throw new ForbiddenException("Parol noto'g'ri");

    const allowed = new Set(def.keys.map((k) => k.name));
    const set: Array<{ key: string; value: string }> = [];
    const remove: string[] = [];
    for (const [name, raw] of Object.entries(values)) {
      if (!allowed.has(name)) throw new BadRequestException(`"${name}" bu integratsiyaga tegishli emas`);
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) {
        remove.push(name);
        continue;
      }
      if (value.length > MAX_VALUE_LENGTH || /[\r\n\0]/.test(value)) throw new BadRequestException(`"${name}" qiymati noto'g'ri`);
      set.push({ key: name, value: crypto.seal(name, value) });
    }
    if (set.length === 0 && remove.length === 0) throw new BadRequestException("O'zgarish yo'q");

    await this.db.transaction(async (tx) => {
      for (const row of set) {
        await tx.insert(platformSettings).values({ ...row, updatedBy: actorId, updatedAt: new Date() })
          .onConflictDoUpdate({ target: platformSettings.key, set: { value: row.value, updatedBy: actorId, updatedAt: new Date() } });
      }
      if (remove.length) await tx.delete(platformSettings).where(inArray(platformSettings.key, remove));
    });
    await this.reload();
    // Which names changed, never their values.
    this.audit.log({ tenantId: null, userId: actorId, action: 'update', entityType: 'platform_setting', entityId: integrationId, meta: { set: set.map((r) => r.key), removed: remove } });
    return { ...this.list().items.find((i) => i.id === integrationId)!, restartNeeded: !!def.restart };
  }
}
