import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { salaryPayments } from '../db/schema';
import { CreateSalaryPaymentDto } from './dto/salary.dto';

@Injectable()
export class SalaryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string, teacherId?: string) {
    const conditions = [eq(salaryPayments.tenantId, tenantId)];
    if (teacherId) conditions.push(eq(salaryPayments.teacherId, teacherId));
    return this.db.query.salaryPayments.findMany({
      where: and(...conditions),
      orderBy: (s, { desc }) => desc(s.paidAt),
    });
  }

  async create(tenantId: string, dto: CreateSalaryPaymentDto) {
    const [row] = await this.db
      .insert(salaryPayments)
      .values({
        tenantId,
        teacherId: dto.teacherId,
        amount: dto.amount,
        forMonth: dto.forMonth,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      })
      .onConflictDoUpdate({
        target: [salaryPayments.teacherId, salaryPayments.forMonth],
        set: { amount: dto.amount, paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date() },
      })
      .returning();
    return row;
  }
}
