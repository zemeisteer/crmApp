import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, count, eq, isNull, like } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { STUDENT_LIST_COLUMNS } from '../common/teacher-scope';
import { expenses, invoices, payments, salaryPayments, students } from '../db/schema';
import { LedgerService } from '../ledger/ledger.service';
import { allocateToInvoices, LedgerTx, lockInvoice, lockOpenInvoices, lockStudentLedger } from './allocation';
import { CreatePaymentDto } from './dto/payment.dto';
import { TelegramService } from '../telegram/telegram.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

// node-postgres error, possibly wrapped by drizzle.
function isUniqueViolation(err: unknown, constraint: string) {
  const top = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = top?.cause ?? top;
  return (pg?.code === '23505' && pg.constraint === constraint) || (top?.code === '23505' && top.constraint === constraint);
}

export interface DebtorItem {
  studentId: string;
  studentName: string;
  phone: string | null;
  parentPhone: string | null;
  /** ACTIVE | PAUSED | GRADUATED | LEFT | REMOVED - as the student is now. */
  studentStatus: string;
  /** Part of the expected sum has no invoice and comes from enrollments. */
  estimated: boolean;
  groups: Array<{ id: string; name: string; monthlyPrice: number; verified: boolean }>;
  expectedAmount: number;
  discountAmount: number;
  paidAmount: number;
  /** Debt on record: invoices, or enrollments at a price known for that month. */
  debtAmount: number;
  /**
   * Tuition whose price in that month was never recorded, and what would be
   * owed of it. An estimate to review - not part of debtAmount or the totals.
   */
  unverifiedAmount: number;
  unverifiedDebt: number;
  /** UNVERIFIED: nothing on record is owed, only the estimate above. */
  status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'UNVERIFIED';
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
  /** Students whose expected sum is (partly) not backed by an invoice. */
  estimatedCount: number;
  /** Estimates with no recorded price: kept apart from the totals above. */
  totalUnverifiedDebt: number;
  unverifiedCount: number;
  /** Groups whose price in this month has to be confirmed to settle them. */
  unverifiedGroups: Array<{ id: string; name: string; assumedPrice: number }>;
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
  /** Estimated debt with no recorded price; not in totalOutstandingDebt. */
  unverifiedDebt: number;
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
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Payments, newest first. Without `page` the whole list (as before); with
   * `page` one page (pageSize default 50, max 200) and the total. Optional
   * filters run on the server: forMonth, studentId, method, status.
   */
  async list(tenantId: string, q: { page?: number; pageSize?: number; forMonth?: string; studentId?: string; method?: string; status?: string } = {}) {
    // Filters on enum columns: an unknown value is a 400, not a database error.
    if (q.method && !['CLICK', 'PAYME', 'BANK_TRANSFER', 'CASH'].includes(q.method)) throw new BadRequestException("To'lov usuli noto'g'ri");
    if (q.status && !['PAID', 'PENDING', 'FAILED'].includes(q.status)) throw new BadRequestException("Holat noto'g'ri");
    const where = and(
      eq(payments.tenantId, tenantId),
      q.forMonth ? eq(payments.forMonth, q.forMonth) : undefined,
      q.studentId ? eq(payments.studentId, q.studentId) : undefined,
      q.method ? eq(payments.method, q.method as typeof payments.$inferSelect.method) : undefined,
      q.status ? eq(payments.status, q.status as typeof payments.$inferSelect.status) : undefined,
    );
    const list = (limit?: number, offset?: number) => this.db.query.payments.findMany({
      where,
      columns: { idempotencyKey: false, requestHash: false },
      with: { student: { columns: STUDENT_LIST_COLUMNS }, invoice: true, allocations: true },
      orderBy: (p, { desc }) => [desc(p.paidAt), desc(p.id)],
      ...(limit ? { limit, offset } : {}),
    });
    if (!q.page) return list();
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 200);
    const page = Math.max(q.page, 1);
    const [{ total }] = await this.db.select({ total: count() }).from(payments).where(where);
    return { items: await list(pageSize, (page - 1) * pageSize), total: Number(total), page, pageSize };
  }

  /** The whole list (internal callers). */
  findAll(tenantId: string) {
    return this.db.query.payments.findMany({
      where: eq(payments.tenantId, tenantId),
      columns: { idempotencyKey: false, requestHash: false },
      with: { student: { columns: STUDENT_LIST_COLUMNS }, invoice: true, allocations: true },
      orderBy: (p, { desc }) => desc(p.paidAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const payment = await this.db.query.payments.findFirst({
      where: and(eq(payments.id, id), eq(payments.tenantId, tenantId)),
      columns: { idempotencyKey: false, requestHash: false },
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

  // One payment = one transaction. The student's ledger lock and the
  // invoices' row locks make two cashiers (or one double click) work one
  // after the other, each from the balance the other left; the idempotency
  // key makes a retried request return the first payment instead of a
  // second one. Notifications go out only after the commit.
  async create(tenantId: string, dto: CreatePaymentDto, userId?: string, headerKey?: string) {
    const discount = dto.discount ?? 0;
    if (discount < 0) throw new BadRequestException("Chegirma manfiy bo'lishi mumkin emas");
    if (dto.amount + discount <= 0) throw new BadRequestException("To'lov summasi 0 dan katta bo'lishi kerak");
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : null;
    if (paidAt && Number.isNaN(paidAt.getTime())) throw new BadRequestException("To'lov sanasi noto'g'ri");
    const status = dto.status ?? 'PAID';
    const method = dto.method ?? 'CASH';

    const key = (dto.idempotencyKey ?? headerKey)?.trim() || null;
    if (key && (key.length < 8 || key.length > 120)) throw new BadRequestException("Idempotency-Key 8-120 belgidan iborat bo'lishi kerak");
    const requestHash = key
      ? createHash('sha256')
          .update(JSON.stringify([dto.studentId, dto.amount, discount, method, status, dto.forMonth, dto.invoiceId ?? null, dto.paidAt ?? null]))
          .digest('hex')
      : null;
    const replay = async (db: Database | LedgerTx) => {
      if (!key) return null;
      const [prior] = await db
        .select({ id: payments.id, requestHash: payments.requestHash })
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, key)));
      if (!prior) return null;
      if (prior.requestHash !== requestHash) {
        throw new ConflictException("Bu Idempotency-Key boshqa to'lov uchun ishlatilgan");
      }
      return prior.id;
    };

    let created: { payment: typeof payments.$inferSelect; invoiceIds: string[] } | { replayOf: string };
    try {
      created = await this.db.transaction(async (tx) => {
        const student = await tx.query.students.findFirst({
          where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId), isNull(students.deletedAt)),
          columns: { id: true },
        });
        if (!student) throw new NotFoundException("O'quvchi topilmadi");

        await lockStudentLedger(tx, student.id);
        const replayOf = await replay(tx);
        if (replayOf) return { replayOf };

        let forMonth = dto.forMonth;
        let targets: Array<typeof invoices.$inferSelect> = [];
        if (dto.invoiceId) {
          const inv = await lockInvoice(tx, tenantId, student.id, dto.invoiceId);
          if (!inv) throw new NotFoundException('Hisob-faktura topilmadi');
          if (inv.status === 'CANCELLED') {
            throw new BadRequestException("Bekor qilingan hisob-faktura uchun to'lov qabul qilib bo'lmaydi");
          }
          if (inv.forMonth !== dto.forMonth) {
            throw new BadRequestException(`Hisob-faktura ${inv.forMonth} oyi uchun, to'lov esa ${dto.forMonth} oyi uchun kiritilgan`);
          }
          if (dto.amount + discount > inv.remainingAmount) {
            throw new BadRequestException(
              `To'lov summasi chegirma bilan (${dto.amount + discount}) hisob-fakturaning qoldiq summasidan (${inv.remainingAmount}) oshib ketishi mumkin emas`,
            );
          }
          forMonth = inv.forMonth;
          targets = [inv];
        } else if (status === 'PAID') {
          // No invoice named: the month's open invoices, oldest due first.
          targets = await lockOpenInvoices(tx, tenantId, student.id, forMonth);
        }

        const [payment] = await tx
          .insert(payments)
          .values({
            tenantId,
            studentId: student.id,
            invoiceId: targets[0]?.id ?? null,
            amount: dto.amount,
            discount,
            method: method as (typeof payments.$inferInsert)['method'],
            status: status as (typeof payments.$inferInsert)['status'],
            forMonth,
            receiptNumber: `RCP-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Math.floor(100000 + Math.random() * 900000)}`,
            idempotencyKey: key,
            requestHash,
            recordedById: userId ?? null,
            paidAt: paidAt ?? new Date(),
          })
          .returning();

        // Only money that has actually been received settles an invoice.
        const { invoiceIds } =
          status === 'PAID'
            ? await allocateToInvoices(tx, { tenantId, paymentId: payment.id, amount: dto.amount, discount }, targets)
            : { invoiceIds: [] as string[] };
        return { payment, invoiceIds };
      });
    } catch (err) {
      // The same key used at the same moment for another student: the
      // unique index stopped the second insert.
      if (key && isUniqueViolation(err, 'payments_tenant_idem_uniq')) {
        const replayOf = await replay(this.db);
        if (replayOf) return this.findOne(tenantId, replayOf);
      }
      throw err;
    }

    // A retry gets the first payment back; nothing is sent twice.
    if ('replayOf' in created) return this.findOne(tenantId, created.replayOf);
    const { payment, invoiceIds } = created;

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
        invoiceId: payment.invoiceId,
        invoiceIds,
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
    const { idempotencyKey: _k, requestHash: _h, ...publicPayment } = payment;
    void this.webhooks.dispatch(tenantId, 'payment.created', publicPayment);
    // With the student and groups, so the receipt shown right after saving
    // has a name and a course instead of an id.
    return this.findOne(tenantId, payment.id);
  }

  async summary(tenantId: string) {
    const all = await this.findAll(tenantId);
    const total = all.reduce((sum, p) => (p.status === 'PAID' ? sum + p.amount : sum), 0);
    const pending = all.filter((p) => p.status === 'PENDING').length;
    const failed = all.filter((p) => p.status === 'FAILED').length;
    return { totalPaid: total, pendingCount: pending, failedCount: failed, count: all.length };
  }

  // Who owes what for a month, from the shared ledger (see ledger/ledger.ts):
  // invoices of that month first, then enrollments that were in force then
  // at the price of that time. A student who has since paused, left or been
  // removed keeps what they owed.
  async getDebtors(tenantId: string, forMonth?: string, onlyDebtors = false): Promise<DebtorsResponse> {
    const month = forMonth || (await this.ledger.currentMonth(tenantId));
    if (!MONTH.test(month)) throw new BadRequestException("forMonth YYYY-MM formatida bo'lishi kerak");
    const ledger = await this.ledger.load(tenantId, [month]);

    const allDebtorItems: DebtorItem[] = [];
    let totalExpected = 0;
    let totalPaid = 0;
    let totalDebt = 0;
    let debtorCount = 0;
    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;
    let estimatedCount = 0;
    let totalUnverifiedDebt = 0;
    let unverifiedCount = 0;
    const unverifiedGroups = new Map<string, { id: string; name: string; assumedPrice: number }>();

    for (const student of ledger.students) {
      const due = ledger.due(student, month);
      // Nothing expected and nothing paid: not part of this month.
      if (due.expected === 0 && due.paid === 0 && due.unverified === 0) continue;
      const effectiveExpected = Math.max(0, due.expected - due.discount);
      if (due.unverifiedDebt > 0) {
        totalUnverifiedDebt += due.unverifiedDebt;
        unverifiedCount++;
        for (const g of due.groups) if (!g.verified) unverifiedGroups.set(g.id, { id: g.id, name: g.name, assumedPrice: g.monthlyPrice });
      }

      let status: DebtorItem['status'];
      if (due.debt === 0 && due.unverifiedDebt > 0) {
        // Not a debtor on record, and not "paid" either.
        status = 'UNVERIFIED';
      } else if (due.debt === 0) {
        status = 'PAID';
        paidCount++;
      } else if (due.paid > 0) {
        status = 'PARTIAL';
        partialCount++;
        debtorCount++;
      } else {
        status = 'UNPAID';
        unpaidCount++;
        debtorCount++;
      }

      totalExpected += effectiveExpected;
      totalPaid += due.paid;
      totalDebt += due.debt;
      if (due.estimated > 0) estimatedCount++;

      allDebtorItems.push({
        studentId: student.id,
        studentName: student.fullName,
        phone: student.phone,
        parentPhone: student.parentPhone,
        studentStatus: student.deleted ? 'REMOVED' : student.status,
        groups: due.groups,
        expectedAmount: due.expected,
        discountAmount: due.discount,
        paidAmount: due.paid,
        debtAmount: due.debt,
        unverifiedAmount: due.unverified,
        unverifiedDebt: due.unverifiedDebt,
        estimated: due.estimated > 0,
        status,
      });
    }

    // "Only debtors" keeps the estimates in view too: they need a decision.
    const debtors = onlyDebtors
      ? allDebtorItems.filter((d) => d.debtAmount > 0 || d.unverifiedDebt > 0)
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
      estimatedCount,
      totalUnverifiedDebt,
      unverifiedCount,
      unverifiedGroups: [...unverifiedGroups.values()],
      debtors,
    };
  }

  async getFinanceSummary(tenantId: string, forMonth?: string): Promise<FinanceSummaryResponse> {
    const month = forMonth || (await this.ledger.currentMonth(tenantId));
    if (!MONTH.test(month)) throw new BadRequestException("forMonth YYYY-MM formatida bo'lishi kerak");

    const monthPayments = await this.db.query.payments.findMany({
      where: and(eq(payments.tenantId, tenantId), eq(payments.forMonth, month)),
    });

    const monthExpenses = await this.db.query.expenses.findMany({
      where: and(eq(expenses.tenantId, tenantId), like(expenses.date, `${month}%`)),
    });

    const monthSalaries = await this.db.query.salaryPayments.findMany({
      where: and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.forMonth, month), isNull(salaryPayments.reversedAt)),
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

    // Payouts made since 0035 are expenses already (category SALARY); only
    // older salary rows with no linked expense are added here.
    let totalSalaries = 0;
    for (const s of monthSalaries) {
      if (!s.expenseId) totalSalaries += s.amount;
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
      unverifiedDebt: debtorsData.totalUnverifiedDebt,
      debtorCount,
      collectionRate,
      revenueByMethod,
      expensesByCategory,
    };
  }
}
