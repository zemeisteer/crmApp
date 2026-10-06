import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
    const [branch] = await this.db.insert(branches).values({ tenantId, ...dto }).returning();
    return branch;
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
