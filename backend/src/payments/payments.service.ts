import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { payments } from '../db/schema';
import { CreatePaymentDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string) {
    return this.db.query.payments.findMany({
      where: eq(payments.tenantId, tenantId),
      with: { student: true },
      orderBy: (p, { desc }) => desc(p.paidAt),
    });
  }

  async create(tenantId: string, dto: CreatePaymentDto) {
    const [payment] = await this.db
      .insert(payments)
      .values({
        tenantId,
        studentId: dto.studentId,
        amount: dto.amount,
        method: (dto.method as any) ?? 'CASH',
        status: (dto.status as any) ?? 'PAID',
        forMonth: dto.forMonth,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      })
      .returning();
    return payment;
  }

  async summary(tenantId: string) {
    const all = await this.findAll(tenantId);
    const total = all.reduce((sum, p) => (p.status === 'PAID' ? sum + p.amount : sum), 0);
    const pending = all.filter((p) => p.status === 'PENDING').length;
    const failed = all.filter((p) => p.status === 'FAILED').length;
    return { totalPaid: total, pendingCount: pending, failedCount: failed, count: all.length };
  }
}
