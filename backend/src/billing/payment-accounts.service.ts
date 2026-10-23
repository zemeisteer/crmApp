import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenantPaymentAccounts } from '../db/schema';
import { SettingsCrypto } from '../platform/settings-crypto';

export type GatewayProvider = 'CLICK' | 'PAYME';

/** What a payment link and a gateway callback are checked with. */
export interface GatewayCredentials {
  merchantId: string;
  serviceId: string | null;
  secret: string;
  /** The center's own account (true), or the platform-wide one it falls back to. */
  own: boolean;
}

export interface SavePaymentAccount {
  merchantId: string;
  serviceId?: string;
  /** Empty on an edit: the stored secret stays. */
  secret?: string;
}

/**
 * A center's own Click / Payme merchant account: students pay the center
 * directly, into the center's own account. The secret (Click's secret key,
 * Payme's key) is sealed with SETTINGS_KEY and bound to the center and the
 * provider, and never goes back to the browser.
 *
 * A center without one falls back to the platform-wide account the platform
 * admin may have set (the old single-merchant setup), when there is one.
 */
@Injectable()
export class PaymentAccountsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  private crypto() {
    return SettingsCrypto.fromEnv(this.config.get<string>('SETTINGS_KEY'));
  }

  private sealName(tenantId: string, provider: GatewayProvider) {
    return `tenant:${tenantId}:${provider}`;
  }

  /** Where the gateway calls back for this center (set in the merchant cabinet). */
  webhookUrl(tenantId: string, provider: GatewayProvider) {
    const explicit = this.config.get<string>('PUBLIC_API_URL');
    const base = explicit
      ? explicit.replace(/\/+$/, '')
      : `${(this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(/\/+$/, '')}/api`;
    return `${base}/billing/${provider.toLowerCase()}/webhook/${tenantId}`;
  }

  /** The settings screen: what is connected, never a secret. */
  async list(tenantId: string) {
    const rows = await this.db.select().from(tenantPaymentAccounts).where(eq(tenantPaymentAccounts.tenantId, tenantId));
    const view = (provider: GatewayProvider) => {
      const r = rows.find((x) => x.provider === provider);
      return {
        connected: Boolean(r),
        merchantId: r?.merchantId ?? null,
        serviceId: r?.serviceId ?? null,
        webhookUrl: this.webhookUrl(tenantId, provider),
        updatedAt: r?.updatedAt ?? null,
      };
    };
    return {
      canStore: Boolean(this.crypto()),
      click: view('CLICK'),
      payme: view('PAYME'),
      platformFallback: {
        click: Boolean(this.platform('CLICK')),
        payme: Boolean(this.platform('PAYME')),
      },
    };
  }

  async save(tenantId: string, provider: GatewayProvider, dto: SavePaymentAccount) {
    const crypto = this.crypto();
    if (!crypto) throw new ServiceUnavailableException("Kalitlarni saqlash o'chirilgan: serverda SETTINGS_KEY sozlanmagan.");
    const merchantId = dto.merchantId.trim();
    const serviceId = dto.serviceId?.trim() || null;
    const secret = dto.secret?.trim() || '';
    if (provider === 'CLICK' && !serviceId) throw new BadRequestException('Click uchun Service ID kerak');
    const [existing] = await this.db
      .select({ id: tenantPaymentAccounts.id })
      .from(tenantPaymentAccounts)
      .where(and(eq(tenantPaymentAccounts.tenantId, tenantId), eq(tenantPaymentAccounts.provider, provider)));
    if (!existing && !secret) throw new BadRequestException(provider === 'CLICK' ? 'Secret key kerak' : 'Kalit (key) kerak');
    const values = {
      merchantId,
      serviceId: provider === 'CLICK' ? serviceId : null,
      ...(secret ? { secret: crypto.seal(this.sealName(tenantId, provider), secret) } : {}),
      updatedAt: new Date(),
    };
    if (existing) {
      await this.db.update(tenantPaymentAccounts).set(values).where(eq(tenantPaymentAccounts.id, existing.id));
    } else {
      await this.db.insert(tenantPaymentAccounts).values({ tenantId, provider, ...values, secret: values.secret! });
    }
    return this.list(tenantId);
  }

  async remove(tenantId: string, provider: GatewayProvider) {
    await this.db
      .delete(tenantPaymentAccounts)
      .where(and(eq(tenantPaymentAccounts.tenantId, tenantId), eq(tenantPaymentAccounts.provider, provider)));
    return this.list(tenantId);
  }

  /** The center's own account, opened; null when it has none (or it cannot be opened). */
  async own(tenantId: string, provider: GatewayProvider): Promise<GatewayCredentials | null> {
    const [r] = await this.db
      .select()
      .from(tenantPaymentAccounts)
      .where(and(eq(tenantPaymentAccounts.tenantId, tenantId), eq(tenantPaymentAccounts.provider, provider)));
    const crypto = this.crypto();
    if (!r || !crypto) return null;
    try {
      return { merchantId: r.merchantId, serviceId: r.serviceId, secret: crypto.open(this.sealName(tenantId, provider), r.secret), own: true };
    } catch {
      return null;
    }
  }

  async hasOwn(tenantId: string, provider: GatewayProvider) {
    const [r] = await this.db
      .select({ id: tenantPaymentAccounts.id })
      .from(tenantPaymentAccounts)
      .where(and(eq(tenantPaymentAccounts.tenantId, tenantId), eq(tenantPaymentAccounts.provider, provider)));
    return Boolean(r);
  }

  /** The platform-wide account (env / platform settings), when the platform admin set one. */
  platform(provider: GatewayProvider): GatewayCredentials | null {
    const get = (k: string) => this.config.get<string>(k) || '';
    if (provider === 'CLICK') {
      const [merchantId, serviceId, secret] = [get('CLICK_MERCHANT_ID'), get('CLICK_SERVICE_ID'), get('CLICK_SECRET_KEY')];
      return merchantId && serviceId ? { merchantId, serviceId, secret, own: false } : null;
    }
    const [merchantId, secret] = [get('PAYME_MERCHANT_ID'), get('PAYME_KEY')];
    return merchantId ? { merchantId, serviceId: null, secret, own: false } : null;
  }

  /**
   * What a payment link for this center is made with: its own account when it
   * has one (null if that cannot be opened - never the platform's instead),
   * else the platform-wide one.
   */
  async resolve(tenantId: string, provider: GatewayProvider) {
    if (await this.hasOwn(tenantId, provider)) return this.own(tenantId, provider);
    return this.platform(provider);
  }
}
