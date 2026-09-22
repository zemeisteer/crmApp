import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { salaryPayments, teachers } from '../db/schema';
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
    const teacher = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId)),
    });
    if (!teacher) {
      throw new BadRequestException("O'qituvchi topilmadi yoki boshqa markazga tegishli");
    }

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

