import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { payments, students } from '../db/schema';
import { CreatePaymentDto } from './dto/payment.dto';
import { TelegramService } from '../telegram/telegram.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly webhooks: WebhooksService,
  ) {}

  findAll(tenantId: string) {
    return this.db.query.payments.findMany({
      where: eq(payments.tenantId, tenantId),
      with: { student: true },
      orderBy: (p, { desc }) => desc(p.paidAt),
    });
  }

  async create(tenantId: string, dto: CreatePaymentDto) {
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) {
      throw new NotFoundException('O\'quvchi topilmadi');
    }

    const [payment] = await this.db
      .insert(payments)
      .values({
        tenantId,
        studentId: dto.studentId,
        amount: dto.amount,
        discount: dto.discount ?? 0,
        method: (dto.method as any) ?? 'CASH',
        status: (dto.status as any) ?? 'PAID',
        forMonth: dto.forMonth,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      })
      .returning();

    if (payment.status === 'PAID') {
      const amount = new Intl.NumberFormat('uz-UZ').format(payment.amount);
      void this.telegram.notifyStudent(
        payment.studentId,
        `To'lov qabul qilindi: ${amount} so'm (${payment.forMonth} oyi uchun). Rahmat!`,
      );
    }
    void this.webhooks.dispatch(tenantId, 'payment.created', payment);
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
