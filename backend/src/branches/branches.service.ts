import { entitlementsOf, limitOf, planLimitReached } from '../plans/entitlements';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches } from '../db/schema';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string) {
    return this.db.query.branches.findMany({
      where: eq(branches.tenantId, tenantId),
      orderBy: (b, { desc }) => desc(b.createdAt),
    });
  }

  async create(tenantId: string, dto: CreateBranchDto) {
    return this.db.transaction(async (tx) => {
      // The plan's limit (plans/entitlements.ts), counted under a lock.
      const max = limitOf(await entitlementsOf(tx, tenantId), 'MAX_BRANCHES');
      if (max !== null) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`branches:${tenantId}`}))`);
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(branches).where(eq(branches.tenantId, tenantId));
        if (n + 1 > max) throw planLimitReached('filial', max);
      }
      const [branch] = await tx.insert(branches).values({ tenantId, ...dto }).returning();
      return branch;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateBranchDto) {
    // Nothing to change (an empty form): answer with the branch as it is.
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (Object.keys(changes).length === 0) {
      const branch = await this.db.query.branches.findFirst({ where: and(eq(branches.id, id), eq(branches.tenantId, tenantId)) });
      if (!branch) throw new NotFoundException('Filial topilmadi');
      return branch;
    }
    const [branch] = await this.db
      .update(branches)
      .set(changes)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId)))
      .returning();
    if (!branch) throw new NotFoundException('Filial topilmadi');
    return branch;
  }

  async remove(tenantId: string, id: string) {
    const [deleted] = await this.db
      .delete(branches)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId)))
      .returning();
    if (!deleted) throw new NotFoundException('Filial topilmadi');
    return { success: true };
  }
}
