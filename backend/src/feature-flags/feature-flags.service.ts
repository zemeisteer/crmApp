import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { featureFlags, tenants } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { FLAGS, clearFlagCache, flagOn, type FlagKey } from './flags';

@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  isEnabled(key: FlagKey, tenantId?: string | null) {
    return flagOn(this.db, key, tenantId);
  }

  private known(key: string): FlagKey {
    if (!(FLAGS as readonly string[]).includes(key)) throw new BadRequestException(`Noma'lum bayroq: ${key}. Mavjudlari: ${FLAGS.join(', ')}`);
    return key as FlagKey;
  }

  /** What a center sees: each switch as it applies to it. */
  async listForTenant(tenantId: string | null) {
    return Promise.all(FLAGS.map(async (key) => ({ key, enabled: await flagOn(this.db, key, tenantId) })));
  }

  /** The platform admin's view: each switch, its global state and every center's override. */
  async overview() {
    const rows = await this.db
      .select({ key: featureFlags.key, tenantId: featureFlags.tenantId, enabled: featureFlags.enabled, name: tenants.name, subdomain: tenants.subdomain })
      .from(featureFlags)
      .leftJoin(tenants, eq(tenants.id, featureFlags.tenantId));
    return FLAGS.map((key) => ({
      key,
      enabled: rows.find((r) => r.key === key && r.tenantId === null)?.enabled ?? true,
      overrides: rows.filter((r) => r.key === key && r.tenantId !== null).map((r) => ({ tenantId: r.tenantId!, name: r.name, subdomain: r.subdomain, enabled: r.enabled })),
    }));
  }

  // Postgres unique indexes do not treat two NULLs as equal, so the global
  // row is looked up first instead of ON CONFLICT.
  async setGlobal(key: string, enabled: boolean, actorId?: string) {
    const k = this.known(key);
    const existing = await this.db.query.featureFlags.findFirst({ where: and(isNull(featureFlags.tenantId), eq(featureFlags.key, k)) });
    const [row] = existing
      ? await this.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.id, existing.id)).returning()
      : await this.db.insert(featureFlags).values({ tenantId: null, key: k, enabled }).returning();
    clearFlagCache();
    this.audit.log({ tenantId: null, userId: actorId ?? null, action: 'update', entityType: 'feature_flag', entityId: k, meta: { scope: 'global', enabled } });
    return row;
  }

  async setForTenant(key: string, tenantId: string, enabled: boolean, actorId: string) {
    const k = this.known(key);
    const [t] = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw new BadRequestException('Markaz topilmadi');
    const [row] = await this.db
      .insert(featureFlags)
      .values({ tenantId, key: k, enabled })
      .onConflictDoUpdate({ target: [featureFlags.tenantId, featureFlags.key], set: { enabled } })
      .returning();
    clearFlagCache();
    this.audit.log({ tenantId, userId: actorId, action: 'update', entityType: 'feature_flag', entityId: k, meta: { scope: 'tenant', enabled } });
    return row;
  }

  async clearForTenant(key: string, tenantId: string, actorId: string) {
    const k = this.known(key);
    await this.db.delete(featureFlags).where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.key, k)));
    clearFlagCache();
    this.audit.log({ tenantId, userId: actorId, action: 'delete', entityType: 'feature_flag', entityId: k, meta: { scope: 'tenant' } });
    return { success: true };
  }
}
