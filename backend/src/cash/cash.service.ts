import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lt } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { cashClosings, expenses, payments, students, users } from '../db/schema';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
import { formatZoned, zonedTimeToUtc } from '../common/timezone';
import { isUniqueViolation } from '../common/db-errors';
import { cashDay } from './cash-day';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

@Injectable()
export class CashService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // The center's calendar day: its UTC bounds, and "today" on its clock.
  private async day(tenantId: string, date?: string) {
    const tz = await this.ledger.timezone(tenantId);
    const today = formatZoned(new Date(), tz).slice(0, 10);
    const d = date ?? today;
    const m = DATE.exec(d);
    if (!m) throw new BadRequestException("date YYYY-MM-DD formatida bo'lishi kerak");
    const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(y, mo - 1, da));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da) throw new BadRequestException("Bunday sana yo'q");
    if (d > today) throw new BadRequestException("Kelajakdagi kun uchun kassa yo'q");
    const start = zonedTimeToUtc(y, mo, da, 0, 0, tz);
    const next = new Date(Date.UTC(y, mo - 1, da + 1));
    const end = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
    return { date: d, tz, start, end, today };
  }

  private async figures(tenantId: string, date?: string) {
    const { date: d, tz, start, end } = await this.day(tenantId, date);
    const [closing] = await this.db.select().from(cashClosings).where(and(eq(cashClosings.tenantId, tenantId), eq(cashClosings.date, d)));
    const paid = await this.db
      .select({
        id: payments.id,
        amount: payments.amount,
        method: payments.method,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
        studentName: students.fullName,
        recordedById: payments.recordedById,
        recordedByName: users.fullName,
      })
      .from(payments)
      .innerJoin(students, eq(students.id, payments.studentId))
      .leftJoin(users, eq(users.id, payments.recordedById))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.status, 'PAID'), gte(payments.paidAt, start), lt(payments.paidAt, end)));
    const spent = await this.db
      .select({ id: expenses.id, title: expenses.title, amount: expenses.amount, paymentMethod: expenses.paymentMethod, category: expenses.category, createdAt: expenses.createdAt })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), eq(expenses.date, d)));
    const figures = cashDay(d, tz, paid, spent, closing?.closedAt ?? null);
    return { figures, closing: closing ?? null };
  }

  async get(tenantId: string, date?: string) {
    const { figures, closing } = await this.figures(tenantId, date);
    let closed = null;
    if (closing) {
      const [by] = closing.closedById ? await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, closing.closedById)) : [];
      // Recorded for that day after it was closed: not in the counted cash.
      const lateCash =
        figures.payments.filter((p) => p.afterClosing && p.method === 'CASH').reduce((s, p) => s + p.amount, 0) -
        figures.expenses.filter((e) => e.afterClosing && e.paymentMethod === 'CASH').reduce((s, e) => s + e.amount, 0);
      closed = {
        closedAt: closing.closedAt,
        closedBy: by?.fullName ?? null,
        expectedCash: closing.expectedCash,
        countedCash: closing.countedCash,
        difference: closing.difference,
        note: closing.note,
        changedAfterClosing: lateCash,
      };
    }
    return { ...figures, closed };
  }

  /**
   * Closes the day once: the counted cash is stored with what the records
   * say should be in the drawer at this moment, and the difference. A day
   * cannot be closed twice (409); closing a future day is refused.
   */
  async close(tenantId: string, userId: string, date: string, countedCash: number, note?: string) {
    const { figures, closing } = await this.figures(tenantId, date);
    if (closing) throw new ConflictException(`${figures.date} kuni kassasi allaqachon yopilgan`);
    const difference = countedCash - figures.expectedCash;
    const totals = { in: figures.in, out: figures.out, totalIn: figures.totalIn, totalOut: figures.totalOut, byCashier: figures.byCashier, payments: figures.payments.length, expenses: figures.expenses.length };
    let row;
    try {
      [row] = await this.db
        .insert(cashClosings)
        .values({ tenantId, date: figures.date, expectedCash: figures.expectedCash, countedCash, difference, totals: JSON.stringify(totals), note: note?.trim() || null, closedById: userId })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'cash_closings_tenant_date_uniq')) throw new ConflictException(`${figures.date} kuni kassasi allaqachon yopilgan`);
      throw err;
    }
    this.audit.log({ tenantId, userId, action: 'cash.close', entityType: 'cash_closing', entityId: row.id, meta: { date: figures.date, expectedCash: figures.expectedCash, countedCash, difference } });
    return this.get(tenantId, figures.date);
  }

  // Closings of a month, newest first (for the history list).
  async history(tenantId: string, month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException("month YYYY-MM formatida bo'lishi kerak");
    const rows = await this.db
      .select({ date: cashClosings.date, expectedCash: cashClosings.expectedCash, countedCash: cashClosings.countedCash, difference: cashClosings.difference, closedAt: cashClosings.closedAt, closedBy: users.fullName, note: cashClosings.note })
      .from(cashClosings)
      .leftJoin(users, eq(users.id, cashClosings.closedById))
      .where(and(eq(cashClosings.tenantId, tenantId), gte(cashClosings.date, `${month}-01`), lt(cashClosings.date, `${month}-99`)));
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }
}
