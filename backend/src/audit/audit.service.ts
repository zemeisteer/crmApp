import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { auditLogs } from '../db/schema';

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Fire-and-forget from services — never let a logging failure break the
  // actual mutation it's recording.
  log(entry: {
    tenantId: string | null;
    userId: string | null;
    action: 'create' | 'update' | 'delete' | 'restore';
    entityType: string;
    entityId: string;
    meta?: unknown;
  }) {
    void this.db
      .insert(auditLogs)
      .values({
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        meta: entry.meta ? JSON.stringify(entry.meta) : null,
      })
      .catch(() => undefined);
  }

  findAll(tenantId: string, entityType?: string) {
    const conditions = [eq(auditLogs.tenantId, tenantId)];
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
    return this.db.query.auditLogs.findMany({
      where: and(...conditions),
      with: { user: { columns: { id: true, fullName: true, email: true } } },
      orderBy: desc(auditLogs.createdAt),
      limit: 200,
    });
  }
}
