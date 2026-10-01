import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { groupPriceHistory, invoices, payments, students, tenants } from '../db/schema';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';
import { LedgerInvoice, LedgerPayment, LedgerStudent, MonthDue, monthDue, monthKey } from './ledger';

export interface LedgerStudentRow extends LedgerStudent {
  fullName: string;
  phone: string | null;
  parentPhone: string | null;
  telegramChatId: string | null;
  createdMonth: string;
  leftAt: Date | null;
  leftReason: string | null;
  deleted: boolean;
}

export interface LoadedLedger {
  timezone: string;
  /** The month it is now at the center. */
  currentMonth: string;
  students: LedgerStudentRow[];
  due(student: LedgerStudentRow, month: string): MonthDue;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async timezone(tenantId: string) {
    const [row] = await this.db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    return isValidTimeZone(row?.timezone) ? row.timezone : DEFAULT_TIMEZONE;
  }

  async currentMonth(tenantId: string, now = new Date()) {
    const p = zonedParts(now, await this.timezone(tenantId));
    return monthKey(p.year, p.month);
  }

  /**
   * Everything needed to say what each student owes for the given months.
   * Students are loaded whatever their status, removed ones included: what
   * they owed for a past month does not change when they leave.
   */
  async load(tenantId: string, months: string[], opts: { studentId?: string } = {}): Promise<LoadedLedger> {
    const tz = await this.timezone(tenantId);
    const monthOf = (d: Date | null | undefined) => {
      if (!d) return null;
      const p = zonedParts(d, tz);
      return monthKey(p.year, p.month);
    };
    const now = zonedParts(new Date(), tz);
    const one = opts.studentId;

    const rows = await this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId), ...(one ? [eq(students.id, one)] : [])),
      columns: {
        id: true, fullName: true, phone: true, parentPhone: true, telegramChatId: true, status: true,
        createdAt: true, leftAt: true, leftReason: true, pausedAt: true, deletedAt: true,
      },
      with: {
        enrollments: {
          columns: { id: true, status: true, joinedAt: true, leftAt: true, groupId: true },
          with: { group: { columns: { id: true, name: true, monthlyPrice: true, deletedAt: true } } },
        },
      },
      orderBy: (s, { desc }) => desc(s.createdAt),
    });

    const history = await this.db
      .select({ groupId: groupPriceHistory.groupId, price: groupPriceHistory.monthlyPrice, from: groupPriceHistory.effectiveFrom })
      .from(groupPriceHistory)
      .where(eq(groupPriceHistory.tenantId, tenantId))
      .orderBy(asc(groupPriceHistory.effectiveFrom), asc(groupPriceHistory.createdAt));
    const prices = new Map<string, Array<{ from: string; price: number }>>();
    for (const h of history) {
      const list = prices.get(h.groupId) ?? [];
      list.push({ from: monthOf(h.from)!, price: h.price });
      prices.set(h.groupId, list);
    }

    const list: LedgerStudentRow[] = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      phone: r.phone,
      parentPhone: r.parentPhone,
      telegramChatId: r.telegramChatId,
      status: r.status,
      createdMonth: monthOf(r.createdAt)!,
      leftAt: r.leftAt,
      leftReason: r.leftReason,
      leftMonth: r.status === 'LEFT' || r.status === 'GRADUATED' ? monthOf(r.leftAt) : null,
      pausedMonth: r.status === 'PAUSED' ? monthOf(r.pausedAt) : null,
      deletedMonth: monthOf(r.deletedAt),
      deleted: Boolean(r.deletedAt),
      enrollments: r.enrollments.map((e) => ({
        id: e.id,
        groupId: e.groupId,
        groupName: e.group?.name ?? '—',
        status: e.status,
        joinedMonth: monthOf(e.joinedAt)!,
        leftMonth: monthOf(e.leftAt),
        groupDeletedMonth: monthOf(e.group?.deletedAt),
        // A group with no recorded history has had one price: today's.
        prices: prices.get(e.groupId) ?? [{ from: '0000-00', price: e.group?.monthlyPrice ?? 0 }],
      })),
    }));

    const invByKey = new Map<string, LedgerInvoice[]>();
    const payByKey = new Map<string, LedgerPayment[]>();
    if (months.length > 0) {
      const inv = await this.db
        .select({
          studentId: invoices.studentId, forMonth: invoices.forMonth, enrollmentId: invoices.enrollmentId,
          amount: invoices.amount, amountPaid: invoices.amountPaid, remainingAmount: invoices.remainingAmount,
        })
        .from(invoices)
        .where(and(
          eq(invoices.tenantId, tenantId),
          inArray(invoices.forMonth, months),
          sql`${invoices.status} <> 'CANCELLED'`,
          ...(one ? [eq(invoices.studentId, one)] : []),
        ));
      for (const i of inv) {
        const k = `${i.studentId}|${i.forMonth}`;
        invByKey.set(k, [...(invByKey.get(k) ?? []), i]);
      }
      const pay = await this.db
        .select({
          studentId: payments.studentId, forMonth: payments.forMonth, amount: payments.amount, discount: payments.discount,
          // Spelled out: inside a single-table select drizzle writes column
          // names without their table, which a subquery would misread.
          allocated: sql<number | null>`(select sum(pa.amount)::int from payment_allocations pa where pa.payment_id = "payments"."id")`,
        })
        .from(payments)
        .where(and(
          eq(payments.tenantId, tenantId),
          eq(payments.status, 'PAID'),
          inArray(payments.forMonth, months),
          ...(one ? [eq(payments.studentId, one)] : []),
        ));
      for (const p of pay) {
        const k = `${p.studentId}|${p.forMonth}`;
        payByKey.set(k, [...(payByKey.get(k) ?? []), { amount: p.amount, discount: p.discount ?? 0, allocated: p.allocated }]);
      }
    }

    return {
      timezone: tz,
      currentMonth: monthKey(now.year, now.month),
      students: list,
      due: (s, month) => monthDue(s, month, invByKey.get(`${s.id}|${month}`) ?? [], payByKey.get(`${s.id}|${month}`) ?? []),
    };
  }
}
