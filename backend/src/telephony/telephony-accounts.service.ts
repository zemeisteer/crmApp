import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, telephonyAccounts, telephonyExtensions, users } from '../db/schema';
import { SettingsCrypto } from '../platform/settings-crypto';
import { allows, entitlementsOf, notInPlan } from '../plans/entitlements';
import type { TelephonyCredentials, TelephonyProviderName } from './providers/telephony-provider.interface';
import { TelephonyProviders } from './providers/telephony-providers';

export interface SaveTelephonyAccount {
  provider: TelephonyProviderName;
  apiKey: string;
  /** Empty on an edit: the stored secret stays. */
  apiSecret?: string;
  enabled?: boolean;
  callsVisibility?: 'OWN' | 'ALL';
  recordingsAccess?: 'ADMINS' | 'CALL_VIEWERS';
}

export type TelephonyAccountRow = typeof telephonyAccounts.$inferSelect;

/** Staff roles that can be given an extension (not students or parents). */
const STAFF_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER'] as const;

/**
 * A center's own telephony account and its extensions. The secret is sealed
 * with SETTINGS_KEY, bound to the center and the provider (as the payment
 * accounts are), and never goes back to the browser; the API key is shown
 * only by its last characters.
 */
@Injectable()
export class TelephonyAccountsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly providers: TelephonyProviders,
  ) {}

  private crypto() {
    return SettingsCrypto.fromEnv(this.config.get<string>('SETTINGS_KEY'));
  }

  private sealName(tenantId: string, provider: TelephonyProviderName) {
    return `tenant:${tenantId}:telephony:${provider}`;
  }

  /** The mock is for local work and tests only. */
  mockAllowed() {
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  webhookUrl(token: string) {
    const explicit = this.config.get<string>('PUBLIC_API_URL');
    const base = explicit
      ? explicit.replace(/\/+$/, '')
      : `${(this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(/\/+$/, '')}/api`;
    return `${base}/telephony/webhook/${token}`;
  }

  async requireFeature(tenantId: string) {
    if (!allows(await entitlementsOf(this.db, tenantId), 'TELEPHONY')) throw notInPlan('TELEPHONY');
  }

  async row(tenantId: string): Promise<TelephonyAccountRow | null> {
    const [r] = await this.db.select().from(telephonyAccounts).where(eq(telephonyAccounts.tenantId, tenantId));
    return r ?? null;
  }

  /** The settings screen: what is connected, never the secret. */
  async view(tenantId: string) {
    const r = await this.row(tenantId);
    const extensions = await this.extensions(tenantId);
    return {
      canStore: Boolean(this.crypto()),
      mockAllowed: this.mockAllowed(),
      connected: Boolean(r),
      provider: r?.provider ?? null,
      apiKeyHint: r ? `…${r.apiKey.slice(-4)}` : null,
      enabled: r?.enabled ?? false,
      callsVisibility: (r?.callsVisibility ?? 'OWN') as 'OWN' | 'ALL',
      recordingsAccess: (r?.recordingsAccess ?? 'ADMINS') as 'ADMINS' | 'CALL_VIEWERS',
      webhookUrl: r ? this.webhookUrl(r.webhookToken) : null,
      lastEventAt: r?.lastEventAt ?? null,
      updatedAt: r?.updatedAt ?? null,
      extensions,
    };
  }

  async save(tenantId: string, dto: SaveTelephonyAccount) {
    await this.requireFeature(tenantId);
    const crypto = this.crypto();
    if (!crypto) throw new ServiceUnavailableException("Kalitlarni saqlash o'chirilgan: serverda SETTINGS_KEY sozlanmagan.");
    if (dto.provider === 'MOCK' && !this.mockAllowed()) throw new BadRequestException("Sinov (MOCK) provayderi faqat lokal muhitda ishlaydi");
    const existing = await this.row(tenantId);
    const apiKey = dto.apiKey.trim();
    const apiSecret = dto.apiSecret?.trim() || '';
    // A new account, or another provider: the secret has to be given again.
    if ((!existing || existing.provider !== dto.provider) && !apiSecret) throw new BadRequestException('Secret kerak');
    const now = new Date();
    const values = {
      provider: dto.provider,
      apiKey,
      ...(apiSecret ? { apiSecret: crypto.seal(this.sealName(tenantId, dto.provider), apiSecret) } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.callsVisibility ? { callsVisibility: dto.callsVisibility } : {}),
      ...(dto.recordingsAccess ? { recordingsAccess: dto.recordingsAccess } : {}),
      updatedAt: now,
    };
    if (existing) {
      await this.db.update(telephonyAccounts).set(values).where(eq(telephonyAccounts.id, existing.id));
    } else {
      await this.db.insert(telephonyAccounts).values({
        tenantId,
        ...values,
        apiSecret: values.apiSecret!,
        webhookToken: randomBytes(24).toString('base64url'),
        createdAt: now,
      });
    }
    return this.view(tenantId);
  }

  /** On/off and who sees what; the keys stay as they are. */
  async setPolicy(tenantId: string, dto: Pick<SaveTelephonyAccount, 'enabled' | 'callsVisibility' | 'recordingsAccess'>) {
    const r = await this.row(tenantId);
    if (!r) throw new NotFoundException('Telefoniya ulanmagan');
    await this.db.update(telephonyAccounts).set({
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.callsVisibility ? { callsVisibility: dto.callsVisibility } : {}),
      ...(dto.recordingsAccess ? { recordingsAccess: dto.recordingsAccess } : {}),
      updatedAt: new Date(),
    }).where(eq(telephonyAccounts.id, r.id));
    return this.view(tenantId);
  }

  /** A new webhook address; the old one stops working at once. */
  async rotateToken(tenantId: string) {
    const r = await this.row(tenantId);
    if (!r) throw new NotFoundException('Telefoniya ulanmagan');
    await this.db.update(telephonyAccounts)
      .set({ webhookToken: randomBytes(24).toString('base64url'), updatedAt: new Date() })
      .where(eq(telephonyAccounts.id, r.id));
    return this.view(tenantId);
  }

  async remove(tenantId: string) {
    await this.db.delete(telephonyAccounts).where(eq(telephonyAccounts.tenantId, tenantId));
    return this.view(tenantId);
  }

  async test(tenantId: string) {
    const r = await this.row(tenantId);
    if (!r) throw new NotFoundException('Telefoniya ulanmagan');
    const creds = this.open(r);
    if (!creds) return { ok: false, message: "Saqlangan secret'ni ochib bo'lmadi: uni qayta kiriting" };
    return this.providers.get(r.provider).testCredentials(creds);
  }

  /** The account's opened credentials; null when the secret cannot be opened. */
  open(r: TelephonyAccountRow): TelephonyCredentials | null {
    const crypto = this.crypto();
    if (!crypto) return null;
    try {
      return { apiKey: r.apiKey, apiSecret: crypto.open(this.sealName(r.tenantId, r.provider), r.apiSecret) };
    } catch {
      return null;
    }
  }

  /** The account a webhook token belongs to (any center); null for an unknown token. */
  async byWebhookToken(token: string): Promise<TelephonyAccountRow | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const [r] = await this.db.select().from(telephonyAccounts).where(eq(telephonyAccounts.webhookToken, token));
    return r ?? null;
  }

  async touch(accountId: string) {
    await this.db.update(telephonyAccounts).set({ lastEventAt: new Date() }).where(eq(telephonyAccounts.id, accountId));
  }

  // ---- Extensions ----

  async extensions(tenantId: string) {
    return this.db
      .select({ extension: telephonyExtensions.extension, userId: telephonyExtensions.userId, fullName: users.fullName })
      .from(telephonyExtensions)
      .innerJoin(users, eq(users.id, telephonyExtensions.userId))
      .where(eq(telephonyExtensions.tenantId, tenantId))
      .orderBy(asc(telephonyExtensions.extension));
  }

  /** Replaces the whole list. Every user must be an active staff member of this center. */
  async setExtensions(tenantId: string, items: Array<{ extension: string; userId: string }>) {
    await this.requireFeature(tenantId);
    const clean = items.map((i) => ({ extension: i.extension.trim(), userId: i.userId }));
    const seen = new Set<string>();
    for (const i of clean) {
      if (seen.has(i.extension)) throw new BadRequestException(`Ichki raqam ${i.extension} ikki marta yozilgan`);
      seen.add(i.extension);
    }
    const userIds = [...new Set(clean.map((i) => i.userId))];
    if (userIds.length) {
      const staff = await this.db
        .select({ userId: organizationMemberships.userId })
        .from(organizationMemberships)
        .where(and(
          eq(organizationMemberships.tenantId, tenantId),
          inArray(organizationMemberships.userId, userIds),
          eq(organizationMemberships.status, 'ACTIVE'),
          inArray(organizationMemberships.role, [...STAFF_ROLES]),
        ));
      const ok = new Set(staff.map((s) => s.userId));
      const bad = userIds.find((u) => !ok.has(u));
      if (bad) throw new BadRequestException("Ichki raqam faqat markazning faol xodimiga biriktiriladi");
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(telephonyExtensions).where(eq(telephonyExtensions.tenantId, tenantId));
      if (clean.length) {
        const now = new Date();
        await tx.insert(telephonyExtensions).values(clean.map((i) => ({ tenantId, extension: i.extension, userId: i.userId, createdAt: now })));
      }
    });
    return this.view(tenantId);
  }

  /** The staff member an extension belongs to, in this center. */
  async userForExtension(tenantId: string, extension: string | null | undefined): Promise<string | null> {
    if (!extension) return null;
    const [r] = await this.db
      .select({ userId: telephonyExtensions.userId })
      .from(telephonyExtensions)
      .where(and(eq(telephonyExtensions.tenantId, tenantId), eq(telephonyExtensions.extension, extension)));
    return r?.userId ?? null;
  }

  /** The extension of a staff member, in this center (click-to-call rings it). */
  async extensionOfUser(tenantId: string, userId: string): Promise<string | null> {
    const [r] = await this.db
      .select({ extension: telephonyExtensions.extension })
      .from(telephonyExtensions)
      .where(and(eq(telephonyExtensions.tenantId, tenantId), eq(telephonyExtensions.userId, userId)))
      .orderBy(asc(telephonyExtensions.extension))
      .limit(1);
    return r?.extension ?? null;
  }
}

