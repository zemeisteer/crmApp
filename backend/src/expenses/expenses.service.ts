import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, like } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { expenses } from '../db/schema';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    tenantId: string,
    filters?: {
      forMonth?: string; // YYYY-MM
      category?: string;
      branchId?: string;
    },
  ) {
    const list = await this.db.query.expenses.findMany({
      where: and(
        eq(expenses.tenantId, tenantId),
        filters?.forMonth ? like(expenses.date, `${filters.forMonth}%`) : undefined,
        filters?.category ? eq(expenses.category, filters.category as any) : undefined,
        filters?.branchId ? eq(expenses.branchId, filters.branchId) : undefined,
      ),
      with: {
        branch: true,
        recordedBy: true,
      },
      orderBy: [desc(expenses.date), desc(expenses.createdAt)],
    });
    return list;
  }

  async findOne(tenantId: string, id: string) {
    const item = await this.db.query.expenses.findFirst({
      where: and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)),
      with: {
        branch: true,
        recordedBy: true,
      },
    });
    if (!item) throw new NotFoundException('Xarajat topilmadi');
    return item;
  }

  async create(tenantId: string, userId: string, dto: CreateExpenseDto) {
    const [created] = await this.db
      .insert(expenses)
      .values({
        tenantId,
        branchId: dto.branchId || null,
        title: dto.title,
        category: (dto.category as any) || 'OTHER',
        amount: dto.amount,
        paymentMethod: (dto.paymentMethod as any) || 'CASH',
        date: dto.date,
        notes: dto.notes || null,
        recordedById: userId || null,
      })
      .returning();

    this.audit.log({
      tenantId,
      userId,
      action: 'create',
      entityType: 'expense',
      entityId: created.id,
      meta: { title: created.title, amount: created.amount, category: created.category },
    });

    return this.findOne(tenantId, created.id);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateExpenseDto) {
    await this.findOne(tenantId, id);

    const [updated] = await this.db
      .update(expenses)
      .set({
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.category !== undefined ? { category: dto.category as any } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod as any } : {}),
        ...(dto.date !== undefined ? { date: dto.date } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)))
      .returning();

    this.audit.log({
      tenantId,
      userId,
      action: 'update',
      entityType: 'expense',
      entityId: id,
      meta: dto,
    });

    return this.findOne(tenantId, updated.id);
  }

  async delete(tenantId: string, userId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));

    this.audit.log({
      tenantId,
      userId,
      action: 'delete',
      entityType: 'expense',
      entityId: id,
    });

    return { success: true };
  }

  async summary(tenantId: string, forMonth?: string) {
    const list = await this.findAll(tenantId, { forMonth });
    const totalAmount = list.reduce((sum, item) => sum + item.amount, 0);

    const byCategory: Record<string, number> = {};
    for (const item of list) {
      byCategory[item.category] = (byCategory[item.category] || 0) + item.amount;
    }

    return {
      totalAmount,
      count: list.length,
      byCategory,
    };
  }
}
