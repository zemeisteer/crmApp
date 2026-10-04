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
    const month = forMonth || new Date().toISOString().slice(0, 7);
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
      where: and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.forMonth, month)),
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

    try {
      return await this.db.transaction(async (tx) => {
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
          .where(and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.teacherId, dto.teacherId), eq(salaryPayments.forMonth, dto.forMonth)));
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

function publicRow<T extends { idempotencyKey?: string | null; requestHash?: string | null }>(row: T) {
  const { idempotencyKey: _k, requestHash: _h, ...rest } = row;
  return rest;
}
