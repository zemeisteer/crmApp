import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { idempotencyKey, lockIdempotencyKey, requestHash } from '../common/create-idempotency';
import { isUniqueViolation } from '../common/db-errors';
import { TeacherAttendanceService } from '../teacher-attendance/teacher-attendance.service';
import {
  enrollments,
  expenses,
  groups,
  payments,
  salaryPayments,
  teachers,
} from '../db/schema';
import { DisburseSalaryDto } from './dto/salary.dto';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
import { reconcileLegacyPayroll, salaryExpenseTitle, type PayrollReconciliation } from './payroll-reconciliation';

export interface TeacherPayrollItem {
  teacherId: string;
  teacherName: string;
  phone: string | null;
  subject: string | null;
  salaryType: 'FIXED' | 'PER_LESSON' | 'PERCENTAGE' | 'PER_STUDENT';
  salaryValue: number;
  calculatedSalary: number;
  paidAmount: number;
  netPayable: number;
  isPaid: boolean;
  // Last payout of the month, and how many payouts there were.
  paidAt: Date | null;
  installments: number;
  details: {
    type: string;
    rate: number;
    lessonCount?: number;
    groupRevenue?: number;
    studentCount?: number;
    groupCount: number;
    // Teacher attendance for the month (see TeacherAttendanceService).
    plannedLessons: number;
    absentLessons: number;
    lateLessons: number;
    substitutedLessons: number;
    // Taken off for missed lessons (non per-lesson pay).
    deduction: number;
  };
}

export interface PayrollCalculationResponse {
  forMonth: string;
  totalCalculated: number;
  totalPaid: number;
  totalPending: number;
  teacherCount: number;
  teachers: TeacherPayrollItem[];
}

@Injectable()
export class SalaryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly teacherAttendance: TeacherAttendanceService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // Every payout (installment), newest first.
  async findAll(tenantId: string, teacherId?: string, forMonth?: string) {
    if (forMonth !== undefined && !MONTH.test(forMonth)) throw new BadRequestException("forMonth YYYY-MM formatida bo'lishi kerak");
    const conditions = [eq(salaryPayments.tenantId, tenantId)];
    if (teacherId) conditions.push(eq(salaryPayments.teacherId, teacherId));
    if (forMonth) conditions.push(eq(salaryPayments.forMonth, forMonth));
    const rows = await this.db.query.salaryPayments.findMany({
      where: and(...conditions),
      orderBy: (s, { desc }) => [desc(s.paidAt), desc(s.createdAt)],
    });
    return rows.map(publicRow);
  }

  // One teacher's line of the payroll, looked up by their login.
  async forTeacherUser(tenantId: string, userId: string, forMonth?: string) {
    const me = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.tenantId, tenantId), eq(teachers.userId, userId), isNull(teachers.deletedAt)),
      columns: { id: true },
    });
    if (!me) return null;
    const payroll = await this.calculatePayroll(tenantId, forMonth);
    return payroll.teachers.find((t) => t.teacherId === me.id) ?? null;
  }

  async calculatePayroll(tenantId: string, forMonth?: string): Promise<PayrollCalculationResponse> {
    // No month given: the center's current month, on its own clock.
    const month = forMonth || (await this.ledger.currentMonth(tenantId));
    if (!MONTH.test(month)) throw new BadRequestException("forMonth YYYY-MM formatida bo'lishi kerak");

    // 1. Fetch active teachers
    const activeTeachers = await this.db.query.teachers.findMany({
      where: and(eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
    });

    if (activeTeachers.length === 0) {
      return {
        forMonth: month,
        totalCalculated: 0,
        totalPaid: 0,
        totalPending: 0,
        teacherCount: 0,
        teachers: [],
      };
    }

    // 2. Payouts already made for this month: a month can be paid in parts.
    const existingPayments = await this.db.query.salaryPayments.findMany({
      where: and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.forMonth, month), isNull(salaryPayments.reversedAt)),
    });
    const paymentMap = new Map<string, { amount: number; paidAt: Date; count: number }>();
    for (const p of existingPayments) {
      const prev = paymentMap.get(p.teacherId);
      paymentMap.set(p.teacherId, {
        amount: (prev?.amount ?? 0) + p.amount,
        paidAt: prev && prev.paidAt > p.paidAt ? prev.paidAt : p.paidAt,
        count: (prev?.count ?? 0) + 1,
      });
    }

    // 3. Fetch groups for tenant
    const tenantGroups = await this.db.query.groups.findMany({
      where: and(eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
    });

    // 4. Fetch all paid tuition payments in this month
    const paidPayments = await this.db.query.payments.findMany({
      where: and(
        eq(payments.tenantId, tenantId),
        eq(payments.forMonth, month),
        eq(payments.status, 'PAID'),
      ),
    });

    // 5. Fetch enrollments of this center
    const allEnrollments = await this.db.query.enrollments.findMany({ where: eq(enrollments.tenantId, tenantId) });
    const attendanceStats = await this.teacherAttendance.monthStats(tenantId, month);

    const items: TeacherPayrollItem[] = [];

    for (const teacher of activeTeachers) {
      // The teacher form stores PERCENT; older rows PERCENTAGE.
      const raw = teacher.salaryType || 'FIXED';
      const type = (raw === 'PERCENT' ? 'PERCENTAGE' : raw) as TeacherPayrollItem['salaryType'];
      const rate = teacher.salaryValue || 0;
      const teacherGroups = tenantGroups.filter((g) => g.teacherId === teacher.id);
      const teacherGroupIds = new Set(teacherGroups.map((g) => g.id));
      const att = attendanceStats.get(teacher.id) ?? { planned: 0, absent: 0, late: 0, substituted: 0 };
      let calculatedSalary = 0;
      let lessonCount = 0;
      let groupRevenue = 0;
      let studentCount = 0;
      let deduction = 0;

      if (type === 'PER_LESSON') {
        // Lessons actually taught: planned, minus missed, plus covered for others.
        lessonCount = Math.max(0, att.planned - att.absent) + att.substituted;
        calculatedSalary = lessonCount * rate;
      } else {
        let base = 0;
        if (type === 'FIXED') {
          base = rate;
        } else if (type === 'PERCENTAGE') {
          const enrolledStudentIds = new Set(
            allEnrollments.filter((e) => teacherGroupIds.has(e.groupId)).map((e) => e.studentId),
          );
          groupRevenue = paidPayments.filter((p) => enrolledStudentIds.has(p.studentId)).reduce((sum, p) => sum + p.amount, 0);
          base = Math.round(groupRevenue * (rate / 100));
        } else if (type === 'PER_STUDENT') {
          studentCount = new Set(
            allEnrollments.filter((e) => teacherGroupIds.has(e.groupId) && e.status === 'ACTIVE').map((e) => e.studentId),
          ).size;
          base = studentCount * rate;
        }
        // A missed lesson costs its share of the month's pay.
        deduction = att.planned > 0 ? Math.round((base * Math.min(att.absent, att.planned)) / att.planned) : 0;
        calculatedSalary = Math.max(0, base - deduction);
      }

      const existing = paymentMap.get(teacher.id);
      const paidAmount = existing ? existing.amount : 0;
      const isPaid = paidAmount >= calculatedSalary && calculatedSalary > 0;
      const paidAt = existing ? existing.paidAt : null;
      const installments = existing ? existing.count : 0;
      const netPayable = Math.max(0, calculatedSalary - paidAmount);

      items.push({
        teacherId: teacher.id,
        teacherName: teacher.fullName,
        phone: teacher.phone,
        subject: teacher.subject,
        salaryType: type,
        salaryValue: rate,
        calculatedSalary,
        paidAmount,
        netPayable,
        isPaid,
        paidAt,
        installments,
        details: {
          type,
          rate,
          lessonCount: type === 'PER_LESSON' ? lessonCount : undefined,
          groupRevenue: type === 'PERCENTAGE' ? groupRevenue : undefined,
          studentCount: type === 'PER_STUDENT' ? studentCount : undefined,
          groupCount: teacherGroups.length,
          plannedLessons: att.planned,
          absentLessons: att.absent,
          lateLessons: att.late,
          substitutedLessons: att.substituted,
          deduction,
        },
      });
    }

    const totalCalculated = items.reduce((sum, i) => sum + i.calculatedSalary, 0);
    const totalPaid = items.reduce((sum, i) => sum + i.paidAmount, 0);
    const totalPending = items.reduce((sum, i) => sum + i.netPayable, 0);

    return {
      forMonth: month,
      totalCalculated,
      totalPaid,
      totalPending,
      teacherCount: items.length,
      teachers: items,
    };
  }

  /**
   * Pays (part of) a teacher's month. One transaction writes the payout and
   * its expense, or neither. Payouts for the same teacher and month are
   * serialized, and together they never exceed the month's calculated pay,
   * so two clicks or two accountants cannot pay a month twice. With an
   * Idempotency-Key, a retry returns the first payout (same key, other
   * request -> 409), as for payments.
   */
  async disburse(tenantId: string, dto: DisburseSalaryDto, recordedById?: string, rawKey?: string) {
    if (!MONTH.test(dto.forMonth)) throw new BadRequestException("forMonth YYYY-MM formatida bo'lishi kerak");
    const key = idempotencyKey(rawKey);
    const hash = key ? requestHash('salary.disburse', dto) : null;
    const replay = async (db: Pick<Database, 'select'>) => {
      if (!key) return null;
      const [prior] = await db
        .select()
        .from(salaryPayments)
        .where(and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.idempotencyKey, key)));
      if (!prior) return null;
      if (prior.requestHash !== hash) throw new ConflictException("Bu Idempotency-Key boshqa maosh to'lovi uchun ishlatilgan");
      const [expense] = prior.expenseId ? await db.select().from(expenses).where(eq(expenses.id, prior.expenseId)) : [];
      return { salaryPayment: publicRow(prior), expense: expense ?? null, replayed: true };
    };

    const teacher = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId)),
    });
    if (!teacher) {
      throw new NotFoundException("O'qituvchi topilmadi yoki boshqa markazga tegishli");
    }
    const paidAtDate = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (Number.isNaN(paidAtDate.getTime())) throw new BadRequestException("paidAt sanasi noto'g'ri");

    // The month's pay does not depend on payouts; worked out before the
    // transaction so that it does not hold a second pool connection.
    const line = (await this.calculatePayroll(tenantId, dto.forMonth)).teachers.find((t) => t.teacherId === dto.teacherId);
    const calculated = line?.calculatedSalary ?? 0;

    let result: DisburseResult;
    try {
      result = await this.db.transaction(async (tx) => {
        if (key) {
          await lockIdempotencyKey(tx, 'salary.disburse', tenantId, key);
          const prior = await replay(tx);
          if (prior) return prior;
        }
        // One payout at a time for this teacher and month.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`salary:${tenantId}:${dto.teacherId}:${dto.forMonth}`}, 0))`);
        const [{ paid }] = await tx
          .select({ paid: sql<number>`coalesce(sum(${salaryPayments.amount}), 0)::int` })
          .from(salaryPayments)
          .where(and(
            eq(salaryPayments.tenantId, tenantId),
            eq(salaryPayments.teacherId, dto.teacherId),
            eq(salaryPayments.forMonth, dto.forMonth),
            isNull(salaryPayments.reversedAt),
          ));
        const remaining = Math.max(0, calculated - paid);
        if (dto.amount > remaining) {
          throw new BadRequestException(
            remaining === 0
              ? `${dto.forMonth} oyi uchun to'lanadigan maosh qolmagan (hisoblangan: ${calculated}, to'langan: ${paid})`
              : `Summa qoldiqdan katta: ${dto.forMonth} oyi uchun ko'pi bilan ${remaining} to'lash mumkin`,
          );
        }

        const [expense] = await tx
          .insert(expenses)
          .values({
            tenantId,
            title: salaryExpenseTitle(teacher.fullName, dto.forMonth),
            category: 'SALARY',
            amount: dto.amount,
            paymentMethod: dto.paymentMethod || 'CASH',
            date: paidAtDate.toISOString().slice(0, 10),
            notes: dto.notes?.trim() || `Oylik maosh to'lovi (${dto.forMonth})`,
            recordedById: recordedById || null,
          })
          .returning();
        const [salaryPayment] = await tx
          .insert(salaryPayments)
          .values({
            tenantId,
            teacherId: dto.teacherId,
            amount: dto.amount,
            forMonth: dto.forMonth,
            paidAt: paidAtDate,
            expenseId: expense.id,
            paymentMethod: dto.paymentMethod || 'CASH',
            notes: dto.notes?.trim() || null,
            recordedById: recordedById || null,
            idempotencyKey: key,
            requestHash: hash,
          })
          .returning();
        return { salaryPayment: publicRow(salaryPayment), expense, replayed: false };
      });
    } catch (err) {
      if (key && isUniqueViolation(err, 'salary_payments_tenant_idem_uniq')) {
        const prior = await replay(this.db);
        if (prior) return prior;
      }
      throw err;
    }
    if (!result.replayed) {
      this.audit.log({
        tenantId,
        userId: recordedById ?? null,
        action: 'salary.disburse',
        entityType: 'salary_payment',
        entityId: result.salaryPayment.id,
        meta: { teacherId: dto.teacherId, teacherName: teacher.fullName, forMonth: dto.forMonth, amount: dto.amount, paymentMethod: dto.paymentMethod || 'CASH', expenseId: result.expense?.id },
      });
    }
    return result;
  }

  /**
   * Reverses a payout made by mistake: in one transaction the row is marked
   * reversed (who, when, why) and its expense is deleted, so the month's
   * paid amount, the expenses and the finance totals drop it. The row is
   * kept. Reversing a reversed payout again changes nothing.
   */
  async reverse(tenantId: string, id: string, reason: string, userId: string) {
    const why = reason?.trim();
    if (!why || why.length < 3) throw new BadRequestException("Bekor qilish sababini yozing (kamida 3 belgi)");
    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(salaryPayments)
        .where(and(eq(salaryPayments.id, id), eq(salaryPayments.tenantId, tenantId)))
        .for('update');
      if (!row) throw new NotFoundException("Maosh to'lovi topilmadi");
      if (row.reversedAt) return { row, changed: false, expense: null as ExpenseRow | null };
      if (!row.expenseId) {
        // An older record (before 0035): there is no expense of its own to
        // remove; link it first (or correct the expenses by hand).
        throw new ConflictException("Bu eski yozuv: unga bog'langan xarajat yo'q. Avval solishtirish hisobotida xarajatga bog'lang");
      }
      const [expense] = await tx.select().from(expenses).where(eq(expenses.id, row.expenseId));
      const [updated] = await tx
        .update(salaryPayments)
        .set({ reversedAt: new Date(), reversedById: userId, reversalReason: why, expenseId: null })
        .where(eq(salaryPayments.id, id))
        .returning();
      await tx.delete(expenses).where(and(eq(expenses.id, row.expenseId), eq(expenses.tenantId, tenantId)));
      return { row: updated, changed: true, expense: expense ?? null };
    });
    if (outcome.changed) {
      this.audit.log({
        tenantId,
        userId,
        action: 'salary.reverse',
        entityType: 'salary_payment',
        entityId: id,
        meta: {
          teacherId: outcome.row.teacherId,
          forMonth: outcome.row.forMonth,
          amount: outcome.row.amount,
          reason: why,
          deletedExpense: outcome.expense ? { id: outcome.expense.id, title: outcome.expense.title, amount: outcome.expense.amount, date: outcome.expense.date } : null,
        },
      });
    }
    return publicRow(outcome.row);
  }

  /**
   * Links an older salary record (before 0035, no expense) to the SALARY
   * expense that is the same money - the reconciliation report's
   * "likely counted twice". Only an exact match is accepted: same center,
   * category SALARY, not linked to any payout, same amount. Afterwards the
   * money counts once, from the expense.
   */
  async linkExpense(tenantId: string, id: string, expenseId: string, userId: string) {
    let linked: { row: SalaryRow; changed: boolean };
    try {
      linked = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(salaryPayments)
        .where(and(eq(salaryPayments.id, id), eq(salaryPayments.tenantId, tenantId)))
        .for('update');
      if (!row) throw new NotFoundException("Maosh to'lovi topilmadi");
      if (row.reversedAt) throw new ConflictException("Bekor qilingan to'lovni bog'lab bo'lmaydi");
      if (row.expenseId === expenseId) return { row, changed: false };
      if (row.expenseId) throw new ConflictException("Bu to'lov allaqachon boshqa xarajatga bog'langan");
      const [expense] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, tenantId)))
        .for('update');
      if (!expense) throw new NotFoundException('Xarajat topilmadi');
      const [taken] = await tx.select({ id: salaryPayments.id }).from(salaryPayments).where(eq(salaryPayments.expenseId, expenseId));
      if (taken) throw new ConflictException("Bu xarajat boshqa maosh to'loviga bog'langan");
      if (expense.category !== 'SALARY') throw new BadRequestException("Faqat SALARY turidagi xarajatni bog'lash mumkin");
      if (expense.amount !== row.amount) {
        throw new BadRequestException(`Summalar farq qiladi (maosh yozuvi ${row.amount}, xarajat ${expense.amount}): bog'lab bo'lmaydi`);
      }
      const [updated] = await tx.update(salaryPayments).set({ expenseId }).where(eq(salaryPayments.id, id)).returning();
      return { row: updated, changed: true };
      });
    } catch (err) {
      // Two links of one expense at the same moment: the unique index decides.
      if (isUniqueViolation(err, 'salary_payments_expense_uniq')) throw new ConflictException("Bu xarajat boshqa maosh to'loviga bog'langan");
      throw err;
    }
    if (linked.changed) {
      this.audit.log({
        tenantId,
        userId,
        action: 'salary.link_expense',
        entityType: 'salary_payment',
        entityId: id,
        meta: { expenseId, amount: linked.row.amount, forMonth: linked.row.forMonth, teacherId: linked.row.teacherId },
      });
    }
    return publicRow(linked.row);
  }

  /**
   * Read-only: salary records written before payouts were linked to
   * expenses (migration 0035), set against the SALARY expenses that may be
   * the same money. Nothing is changed; see payroll-reconciliation.ts.
   */
  async reconciliation(tenantId: string, forMonth?: string): Promise<PayrollReconciliation> {
    if (forMonth !== undefined && !MONTH.test(forMonth)) throw new BadRequestException("forMonth YYYY-MM formatida bo'lishi kerak");
    const legacy = await this.db
      .select({
        id: salaryPayments.id,
        teacherId: salaryPayments.teacherId,
        teacherName: teachers.fullName,
        forMonth: salaryPayments.forMonth,
        amount: salaryPayments.amount,
        paidAt: salaryPayments.paidAt,
      })
      .from(salaryPayments)
      .innerJoin(teachers, eq(teachers.id, salaryPayments.teacherId))
      .where(and(
        eq(salaryPayments.tenantId, tenantId),
        isNull(salaryPayments.expenseId),
        isNull(salaryPayments.reversedAt),
        forMonth ? eq(salaryPayments.forMonth, forMonth) : undefined,
      ));
    // SALARY expenses that no payout points to.
    const unlinked = await this.db
      .select({ id: expenses.id, title: expenses.title, amount: expenses.amount, date: expenses.date })
      .from(expenses)
      .where(and(
        eq(expenses.tenantId, tenantId),
        eq(expenses.category, 'SALARY'),
        sql`not exists (select 1 from ${salaryPayments} sp where sp.expense_id = ${expenses.id})`,
      ));
    return reconcileLegacyPayroll(legacy, unlinked, forMonth);
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type SalaryRow = typeof salaryPayments.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
interface DisburseResult {
  salaryPayment: Omit<SalaryRow, 'idempotencyKey' | 'requestHash'>;
  expense: ExpenseRow | null;
  replayed: boolean;
}

function publicRow(row: SalaryRow): Omit<SalaryRow, 'idempotencyKey' | 'requestHash'> {
  const { idempotencyKey: _k, requestHash: _h, ...rest } = row;
  return rest;
}
