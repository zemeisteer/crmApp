import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, like } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { enrollments, expenses, invoices, paymentAllocations, payments, salaryPayments, students } from '../db/schema';
import { CreatePaymentDto } from './dto/payment.dto';
import { TelegramService } from '../telegram/telegram.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

export interface DebtorItem {
  studentId: string;
  studentName: string;
  phone: string | null;
  parentPhone: string | null;
  groups: Array<{ id: string; name: string; monthlyPrice: number }>;
  expectedAmount: number;
  discountAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: 'PAID' | 'PARTIAL' | 'UNPAID';
}

export interface DebtorsResponse {
  forMonth: string;
  totalExpected: number;
  totalPaid: number;
  totalDebt: number;
  totalStudents: number;
  debtorCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  debtors: DebtorItem[];
}

export interface FinanceSummaryResponse {
  forMonth: string;
  totalRevenue: number;
  totalCenterExpenses: number;
  totalSalaries: number;
  totalExpenses: number;
  netProfit: number;
  totalExpectedRevenue: number;
  totalOutstandingDebt: number;
  debtorCount: number;
  collectionRate: number;
  revenueByMethod: Record<string, number>;
  expensesByCategory: Record<string, number>;
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string) {
    return this.db.query.payments.findMany({
      where: eq(payments.tenantId, tenantId),
      with: { student: true, invoice: true, allocations: true },
      orderBy: (p, { desc }) => desc(p.paidAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const payment = await this.db.query.payments.findFirst({
      where: and(eq(payments.id, id), eq(payments.tenantId, tenantId)),
      with: {
        student: {
          with: {
            enrollments: {
              with: {
                group: true,
              },
            },
          },
        },
        invoice: true,
        allocations: {
          with: {
            invoice: true,
          },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException("To'lov topilmadi");
    }
    return payment;
  }

  async create(tenantId: string, dto: CreatePaymentDto, userId?: string) {
    const student = await this.db.query.students.findFirst({
      where: and(
        eq(students.id, dto.studentId),
        eq(students.tenantId, tenantId),
        isNull(students.deletedAt),
      ),
    });
    if (!student) {
      throw new NotFoundException("O'quvchi topilmadi");
    }

    let targetInvoice: typeof invoices.$inferSelect | undefined;

    if (dto.invoiceId) {
      const inv = await this.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, dto.invoiceId),
          eq(invoices.tenantId, tenantId),
          eq(invoices.studentId, dto.studentId),
        ),
      });
      if (!inv) {
        throw new NotFoundException("Hisob-faktura topilmadi");
      }
      if (inv.status === 'CANCELLED') {
        throw new BadRequestException("Bekor qilingan hisob-faktura uchun to'lov qabul qilib bo'lmaydi");
      }
      if (dto.amount > inv.remainingAmount) {
        throw new BadRequestException(
          `To'lov summasi (${dto.amount}) hisob-fakturaning qoldiq summasidan (${inv.remainingAmount}) oshib ketishi mumkin emas`,
        );
      }
      targetInvoice = inv;
    } else {
      const openInv = await this.db.query.invoices.findFirst({
        where: and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.studentId, dto.studentId),
          eq(invoices.forMonth, dto.forMonth),
        ),
      });
      if (openInv && openInv.status !== 'CANCELLED' && openInv.remainingAmount > 0) {
        targetInvoice = openInv;
      }
    }

    const receiptNumber = `RCP-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Math.floor(100000 + Math.random() * 900000)}`;

    const [payment] = await this.db
      .insert(payments)
      .values({
        tenantId,
        studentId: dto.studentId,
        invoiceId: targetInvoice?.id || dto.invoiceId || null,
        amount: dto.amount,
        discount: dto.discount ?? 0,
        method: (dto.method as any) ?? 'CASH',
        status: (dto.status as any) ?? 'PAID',
        forMonth: dto.forMonth,
        receiptNumber,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      })
      .returning();

    if (targetInvoice && payment.status === 'PAID') {
      const allocAmount = Math.min(dto.amount, targetInvoice.remainingAmount);
      await this.db.insert(paymentAllocations).values({
        tenantId,
        paymentId: payment.id,
        invoiceId: targetInvoice.id,
        amount: allocAmount,
      });

      const newPaid = targetInvoice.amountPaid + allocAmount;
      const newRemaining = Math.max(0, targetInvoice.remainingAmount - allocAmount);
      const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';

      await this.db
        .update(invoices)
        .set({
          amountPaid: newPaid,
          remainingAmount: newRemaining,
          status: newStatus,
          paidAt: newRemaining === 0 ? new Date() : targetInvoice.paidAt,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, targetInvoice.id));
    }

    this.audit.log({
      tenantId,
      userId: userId || null,
      action: 'create',
      entityType: 'payment',
      entityId: payment.id,
      meta: {
        amount: payment.amount,
        method: payment.method,
        studentId: payment.studentId,
        invoiceId: targetInvoice?.id || dto.invoiceId,
        receiptNumber: payment.receiptNumber,
      },
    });

    if (payment.status === 'PAID') {
      void this.notifications.notifyPaymentReceived(
        tenantId,
        payment.studentId,
        payment.amount,
        payment.forMonth,
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

  async getDebtors(tenantId: string, forMonth?: string, onlyDebtors = false): Promise<DebtorsResponse> {
    const month = forMonth || new Date().toISOString().slice(0, 7);

    // Only students who are currently studying, and only their ACTIVE
    // enrollments, are expected to pay: left, graduated and paused students,
    // and cancelled/paused enrollments, used to inflate expected revenue and
    // debt.
    const studentList = await this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId), isNull(students.deletedAt), eq(students.status, 'ACTIVE')),
      with: {
        enrollments: {
          where: eq(enrollments.status, 'ACTIVE'),
          with: {
            group: true,
          },
        },
      },
      orderBy: [desc(students.createdAt)],
    });

    const monthPayments = await this.db.query.payments.findMany({
      where: and(eq(payments.tenantId, tenantId), eq(payments.forMonth, month)),
    });

    const paymentsByStudent = new Map<string, { paid: number; discount: number }>();
    for (const p of monthPayments) {
      if (p.status === 'PAID') {
        const current = paymentsByStudent.get(p.studentId) || { paid: 0, discount: 0 };
        current.paid += p.amount;
        current.discount += (p.discount || 0);
        paymentsByStudent.set(p.studentId, current);
      }
    }

    const allDebtorItems: DebtorItem[] = [];
    let totalExpected = 0;
    let totalPaid = 0;
    let totalDebt = 0;
    let debtorCount = 0;
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;

    for (const student of studentList) {
      const activeGroups = (student.enrollments || [])
        .map((e) => e.group)
        .filter((g): g is NonNullable<typeof g> => Boolean(g && !g.deletedAt));

      const expectedAmount = activeGroups.reduce((sum, g) => sum + (g.monthlyPrice || 0), 0);
      const pInfo = paymentsByStudent.get(student.id) || { paid: 0, discount: 0 };
      const paidAmount = pInfo.paid;
      const discountAmount = pInfo.discount;
      const effectiveExpected = Math.max(0, expectedAmount - discountAmount);
      const debtAmount = Math.max(0, effectiveExpected - paidAmount);

      let status: 'PAID' | 'PARTIAL' | 'UNPAID';
      if (effectiveExpected === 0 || debtAmount === 0) {
        status = 'PAID';
        paidCount++;
      } else if (paidAmount > 0) {
        status = 'PARTIAL';
        partialCount++;
        debtorCount++;
      } else {
        status = 'UNPAID';
        unpaidCount++;
        debtorCount++;
      }

      totalExpected += effectiveExpected;
      totalPaid += paidAmount;
      totalDebt += debtAmount;

      if (activeGroups.length > 0 || paidAmount > 0) {
        allDebtorItems.push({
          studentId: student.id,
          studentName: student.fullName,
          phone: student.phone,
          parentPhone: student.parentPhone,
          groups: activeGroups.map((g) => ({ id: g.id, name: g.name, monthlyPrice: g.monthlyPrice })),
          expectedAmount,
          discountAmount,
          paidAmount,
          debtAmount,
          status,
        });
      }
    }

    const debtors = onlyDebtors
      ? allDebtorItems.filter((d) => d.debtAmount > 0)
      : allDebtorItems;

    return {
      forMonth: month,
      totalExpected,
      totalPaid,
      totalDebt,
      totalStudents: allDebtorItems.length,
      debtorCount,
      paidCount,
      partialCount,
      unpaidCount,
      debtors,
    };
  }

  async getFinanceSummary(tenantId: string, forMonth?: string): Promise<FinanceSummaryResponse> {
    const month = forMonth || new Date().toISOString().slice(0, 7);

    const monthPayments = await this.db.query.payments.findMany({
      where: and(eq(payments.tenantId, tenantId), eq(payments.forMonth, month)),
    });

    const monthExpenses = await this.db.query.expenses.findMany({
      where: and(eq(expenses.tenantId, tenantId), like(expenses.date, `${month}%`)),
    });

    const monthSalaries = await this.db.query.salaryPayments.findMany({
      where: and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.forMonth, month)),
    });

    let totalRevenue = 0;
    const revenueByMethod: Record<string, number> = {};
    for (const p of monthPayments) {
      if (p.status === 'PAID') {
        totalRevenue += p.amount;
        revenueByMethod[p.method] = (revenueByMethod[p.method] || 0) + p.amount;
      }
    }

    let totalCenterExpenses = 0;
    const expensesByCategory: Record<string, number> = {};
    for (const e of monthExpenses) {
      totalCenterExpenses += e.amount;
      expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + e.amount;
    }

    let totalSalaries = 0;
    for (const s of monthSalaries) {
      totalSalaries += s.amount;
    }
    if (totalSalaries > 0) {
      expensesByCategory['SALARY'] = (expensesByCategory['SALARY'] || 0) + totalSalaries;
    }

    const totalExpenses = totalCenterExpenses + totalSalaries;
    const netProfit = totalRevenue - totalExpenses;

    const debtorsData = await this.getDebtors(tenantId, month, false);
    const totalExpectedRevenue = debtorsData.totalExpected;
    const totalOutstandingDebt = debtorsData.totalDebt;
    const debtorCount = debtorsData.debtorCount;
    const collectionRate =
      totalExpectedRevenue > 0
        ? Math.min(100, Math.round((totalRevenue / totalExpectedRevenue) * 100))
        : 100;

    return {
      forMonth: month,
      totalRevenue,
      totalCenterExpenses,
      totalSalaries,
      totalExpenses,
      netProfit,
      totalExpectedRevenue,
      totalOutstandingDebt,
      debtorCount,
      collectionRate,
      revenueByMethod,
      expensesByCategory,
    };
  }
}
