import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { featureFlags } from '../db/schema';

@Injectable()
export class FeatureFlagsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Per-tenant flag overrides the global one; if neither exists, default false.
  async isEnabled(key: string, tenantId?: string | null): Promise<boolean> {
    const rows = await this.db.query.featureFlags.findMany({
      where: and(eq(featureFlags.key, key), tenantId ? or(eq(featureFlags.tenantId, tenantId), isNull(featureFlags.tenantId)) : isNull(featureFlags.tenantId)),
    });
    const tenantRow = rows.find((r) => r.tenantId === tenantId);
    if (tenantRow) return tenantRow.enabled;
    const globalRow = rows.find((r) => r.tenantId === null);
    return globalRow?.enabled ?? false;
  }

  async listForTenant(tenantId: string | null) {
    return this.db.query.featureFlags.findMany({
      where: tenantId ? or(eq(featureFlags.tenantId, tenantId), isNull(featureFlags.tenantId)) : isNull(featureFlags.tenantId),
    });
  }

  // Superadmin only: global default for all tenants. Postgres unique
  // indexes don't treat two NULLs as equal, so ON CONFLICT can't target
  // the (tenantId, key) pair when tenantId is NULL — look the row up first.
  async setGlobal(key: string, enabled: boolean) {
    const existing = await this.db.query.featureFlags.findFirst({
      where: and(isNull(featureFlags.tenantId), eq(featureFlags.key, key)),
    });
    if (existing) {
      const [row] = await this.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.id, existing.id)).returning();
      return row;
    }
    const [row] = await this.db.insert(featureFlags).values({ tenantId: null, key, enabled }).returning();
    return row;
  }
}
