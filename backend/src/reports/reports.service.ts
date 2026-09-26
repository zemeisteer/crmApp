import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { attendance, enrollments, groups, invoices, payments, students, teachers } from '../db/schema';
import { PaymentsService } from '../payments/payments.service';
import { LeadsService } from '../leads/leads.service';
import { DEFAULT_TIMEZONE, zonedParts, zonedTimeToUtc } from '../common/timezone';
import { seatHeldWhere } from '../common/seats';
import { studentIdsInGroups, teacherGroupIds } from '../common/teacher-scope';

// Who sees which part of the overview. Finance mirrors the payments/expenses
// read rules; admissions mirrors admissions.analytics.
export interface ReportViewer {
  role: string;
  permissions: string[];
}
const FINANCE_ROLES = ['SUPERADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT'];
// Same audience as the payments read endpoints.
const PAYMENT_READ_ROLES = ['SUPERADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST'];
// groups.scheduleDays holds Uzbek day names (the UI writes them); English
// codes are accepted too. Index = ISO weekday - 1.
const WEEKDAY_NAMES = [
  ['dushanba', 'mon'], ['seshanba', 'tue'], ['chorshanba', 'wed'], ['payshanba', 'thu'],
  ['juma', 'fri'], ['shanba', 'sat'], ['yakshanba', 'sun'],
];
function runsOn(scheduleDays: string | null, isoWeekday: number) {
  const names = WEEKDAY_NAMES[isoWeekday - 1];
  return (scheduleDays ?? '').split(',').map((d) => d.trim().toLowerCase()).some((d) => names.includes(d));
}
function ymd(p: { year: number; month: number; day: number }) {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
const PROFIT_ROLES = ['SUPERADMIN', 'OWNER', 'ADMIN', 'ACCOUNTANT'];

function pct(numerator: number, denominator: number) {
  // null, not 0 or 100, when there is nothing to measure.
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// One server-side report for a calendar month. Replaces the reports and
// dashboard pages downloading every student, payment and attendance row to
// the browser. Definitions are returned with the numbers.
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly paymentsService: PaymentsService,
    private readonly leadsService: LeadsService,
  ) {}

  async overview(tenantId: string, viewer: ReportViewer, monthParam?: string) {
    const tz = await this.leadsService.tenantTimezone(tenantId).catch(() => DEFAULT_TIMEZONE);
    const now = zonedParts(new Date(), tz);
    const month = monthParam ?? `${now.year}-${String(now.month).padStart(2, '0')}`;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException("month YYYY-MM formatida bo'lishi kerak");
    const [y, m] = month.split('-').map(Number);
    const monthStart = zonedTimeToUtc(y, m, 1, 0, 0, tz);
    const next = shiftMonth(month, 1).split('-').map(Number);
    const monthEnd = zonedTimeToUtc(next[0], next[1], 1, 0, 0, tz);

    const [studentsSection, groupsSection, attendanceSection, atRisk] = await Promise.all([
      this.studentsSection(tenantId, month, monthStart, monthEnd, tz),
      this.groupsSection(tenantId, month),
      this.attendanceSection(tenantId, month),
      this.atRiskStudents(tenantId, month),
    ]);

    const canFinance = FINANCE_ROLES.includes(viewer.role);
    const canProfit = PROFIT_ROLES.includes(viewer.role);
    const canAdmissions = viewer.permissions.includes('admissions.analytics');

    return {
      month,
      timezone: tz,
      definitions: {
        activeStudents: 'Students with status ACTIVE (not deleted) right now.',
        newStudents: 'Students registered during the month (center timezone).',
        attendanceRate: '(PRESENT + LATE) / all attendance marks dated in the month.',
        occupancy: 'Seats held (ACTIVE enrollments of students who have not left or graduated) / group maxStudents.',
        collectionRate: '(expected - outstanding debt) / expected, where expected comes from ACTIVE enrollments of ACTIVE students; null when nothing was expected.',
        atRisk: 'ACTIVE students with attendance below 60% this month (3+ marks) or an OVERDUE invoice.',
      },
      students: studentsSection,
      groups: groupsSection,
      attendance: attendanceSection,
      atRisk,
      finance: canFinance ? await this.financeSection(tenantId, month, canProfit) : null,
      admissions: canAdmissions
        ? await this.leadsService.getAnalytics(tenantId, { from: monthStart.toISOString(), to: monthEnd.toISOString() })
        : null,
    };
  }

  // Home dashboard for every staff role. Teachers get their own groups only;
  // money figures only for roles that may read payments.
  async dashboard(tenantId: string, viewer: { role: string; userId: string }) {
    const tz = await this.leadsService.tenantTimezone(tenantId).catch(() => DEFAULT_TIMEZONE);
    const now = zonedParts(new Date(), tz);
    const today = ymd(now);
    const month = today.slice(0, 7);
    const scope = await teacherGroupIds(this.db, tenantId, viewer.role, viewer.userId);

    const groupRows = await this.db.select({
      id: groups.id, name: groups.name, maxStudents: groups.maxStudents, scheduleDays: groups.scheduleDays, startTime: groups.startTime,
    }).from(groups).where(and(
      eq(groups.tenantId, tenantId), isNull(groups.deletedAt), eq(groups.status, 'ACTIVE'),
      ...(scope ? [scope.length ? inArray(groups.id, scope) : sql`false`] : []),
    ));
    const groupIds = groupRows.map((g) => g.id);

    let activeStudents: number;
    if (scope) {
      const ids = await studentIdsInGroups(this.db, scope);
      activeStudents = ids.length === 0 ? 0 : (await this.db.select({ n: sql<number>`count(*)::int` }).from(students)
        .where(and(inArray(students.id, ids), isNull(students.deletedAt), eq(students.status, 'ACTIVE'))))[0].n;
    } else {
      activeStudents = (await this.db.select({ n: sql<number>`count(*)::int` }).from(students)
        .where(and(eq(students.tenantId, tenantId), isNull(students.deletedAt), eq(students.status, 'ACTIVE'))))[0].n;
    }
    const [{ teacherCount }] = await this.db.select({ teacherCount: sql<number>`count(*)::int` }).from(teachers)
      .where(and(eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));

    // Attendance marks per date and group for roughly the last 6 months.
    const since = ymd(zonedParts(new Date(Date.now() - 190 * 86_400_000), tz));
    const attScope = and(
      eq(attendance.tenantId, tenantId),
      ...(scope ? [groupIds.length ? inArray(attendance.groupId, groupIds) : sql`false`] : []),
    );
    const byDate = await this.db.select({
      date: attendance.date,
      groupId: attendance.groupId,
      total: sql<number>`count(*)::int`,
      present: sql<number>`count(*) filter (where ${attendance.status} in ('PRESENT', 'LATE'))::int`,
    }).from(attendance)
      .where(and(attScope, gte(attendance.date, since)))
      .groupBy(attendance.date, attendance.groupId);
    const [{ allMarks }] = await this.db.select({ allMarks: sql<number>`count(*)::int` }).from(attendance).where(attScope);

    // Current week, Monday first, in the center's timezone.
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = ymd(zonedParts(new Date(Date.now() + (i - (now.weekday - 1)) * 86_400_000), tz));
      return { date, weekday: i + 1, marks: byDate.filter((r) => r.date === date).reduce((s, r) => s + r.total, 0) };
    });
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => ({
      month: m,
      marks: byDate.filter((r) => r.date.startsWith(m)).reduce((s, r) => s + r.total, 0),
    }));
    // Today's marks at each group's real lesson start time (the old page
    // spread today's total evenly over made-up time slots).
    const slots = new Map<string, number>();
    for (const r of byDate.filter((x) => x.date === today)) {
      const start = groupRows.find((g) => g.id === r.groupId)?.startTime || '—';
      slots.set(start, (slots.get(start) ?? 0) + r.total);
    }
    const rateOf = (rows: typeof byDate) => pct(rows.reduce((s, r) => s + r.present, 0), rows.reduce((s, r) => s + r.total, 0));
    const weekDates = new Set(week.map((w) => w.date));

    const seats = groupIds.length === 0 ? [] : await this.db.select({ groupId: enrollments.groupId, n: sql<number>`count(*)::int` })
      .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId))
      .where(seatHeldWhere(inArray(enrollments.groupId, groupIds))).groupBy(enrollments.groupId);

    let finance: null | { monthRevenue: number; debtorCount: number; paymentStatus: { paid: number; pending: number; failed: number; total: number } } = null;
    if (!scope && PAYMENT_READ_ROLES.includes(viewer.role)) {
      const rows = await this.db.select({ status: payments.status, n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${payments.amount}), 0)::int` })
        .from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.forMonth, month))).groupBy(payments.status);
      const get = (s: string) => rows.find((r) => r.status === s);
      const debtors = await this.paymentsService.getDebtors(tenantId, month, false);
      finance = {
        monthRevenue: get('PAID')?.amount ?? 0,
        debtorCount: debtors.debtorCount,
        paymentStatus: { paid: get('PAID')?.n ?? 0, pending: get('PENDING')?.n ?? 0, failed: get('FAILED')?.n ?? 0, total: rows.reduce((s, r) => s + r.n, 0) },
      };
    }

    return {
      today,
      timezone: tz,
      scopedToOwnGroups: Boolean(scope),
      counts: {
        activeStudents,
        activeGroups: groupRows.length,
        teachers: teacherCount,
        todaysLessons: groupRows.filter((g) => runsOn(g.scheduleDays, now.weekday)).length,
        attendanceMarks: allMarks,
      },
      attendance: {
        week,
        months,
        todayBySlot: [...slots.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([startTime, marks]) => ({ startTime, marks })),
        rates: {
          day: rateOf(byDate.filter((r) => r.date === today)),
          week: rateOf(byDate.filter((r) => weekDates.has(r.date))),
          month: rateOf(byDate.filter((r) => r.date.startsWith(month))),
        },
      },
      groupFill: groupRows
        .map((g) => ({ id: g.id, name: g.name, students: seats.find((s) => s.groupId === g.id)?.n ?? 0, maxStudents: g.maxStudents }))
        .sort((a, b) => b.students - a.students)
        .slice(0, 4),
      finance,
    };
  }

  private async studentsSection(tenantId: string, month: string, monthStart: Date, monthEnd: Date, tz: string) {
    const base = and(eq(students.tenantId, tenantId), isNull(students.deletedAt));
    const [{ active }] = await this.db.select({ active: sql<number>`count(*)::int` }).from(students)
      .where(and(base, eq(students.status, 'ACTIVE')));
    const [{ created }] = await this.db.select({ created: sql<number>`count(*)::int` }).from(students)
      .where(and(base, gte(students.createdAt, monthStart), lt(students.createdAt, monthEnd)));
    const byStatus = await this.db.select({ status: students.status, n: sql<number>`count(*)::int` }).from(students)
      .where(base).groupBy(students.status);

    // Registrations per month for the 6 months ending with `month`.
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
    const [fy, fm] = months[0].split('-').map(Number);
    const from = zonedTimeToUtc(fy, fm, 1, 0, 0, tz);
    const rows = await this.db.select({ createdAt: students.createdAt }).from(students)
      .where(and(eq(students.tenantId, tenantId), gte(students.createdAt, from), lt(students.createdAt, monthEnd)));
    const counts = new Map(months.map((mm) => [mm, 0]));
    for (const r of rows) {
      const p = zonedParts(r.createdAt, tz);
      const key = `${p.year}-${String(p.month).padStart(2, '0')}`;
      if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
    }
    return {
      active,
      newThisMonth: created,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
      registrationsByMonth: months.map((mm) => ({ month: mm, count: counts.get(mm)! })),
    };
  }

  private async groupsSection(tenantId: string, month: string) {
    const groupRows = await this.db.select({
      id: groups.id, name: groups.name, maxStudents: groups.maxStudents, monthlyPrice: groups.monthlyPrice, status: groups.status,
    }).from(groups).where(and(eq(groups.tenantId, tenantId), isNull(groups.deletedAt), eq(groups.status, 'ACTIVE')));
    if (groupRows.length === 0) return { active: 0, averageOccupancy: null, items: [] };
    const ids = groupRows.map((g) => g.id);

    const enrolled = await this.db.select({ groupId: enrollments.groupId, n: sql<number>`count(*)::int` }).from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(seatHeldWhere(inArray(enrollments.groupId, ids)))
      .groupBy(enrollments.groupId);
    const att = await this.db.select({
      groupId: attendance.groupId,
      total: sql<number>`count(*)::int`,
      present: sql<number>`count(*) filter (where ${attendance.status} in ('PRESENT', 'LATE'))::int`,
    }).from(attendance)
      .where(and(eq(attendance.tenantId, tenantId), inArray(attendance.groupId, ids), sql`${attendance.date} like ${month + '%'}`))
      .groupBy(attendance.groupId);
    // Money collected against this month's invoices, attributed to a group
    // through the invoice's enrollment.
    const revenue = await this.db.select({ groupId: enrollments.groupId, collected: sql<number>`coalesce(sum(${invoices.amountPaid}), 0)::int` })
      .from(invoices)
      .innerJoin(enrollments, eq(enrollments.id, invoices.enrollmentId))
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.forMonth, month), inArray(enrollments.groupId, ids)))
      .groupBy(enrollments.groupId);

    const items = groupRows.map((g) => {
      const students = enrolled.find((e) => e.groupId === g.id)?.n ?? 0;
      const a = att.find((x) => x.groupId === g.id);
      return {
        id: g.id,
        name: g.name,
        students,
        maxStudents: g.maxStudents,
        occupancy: pct(students, g.maxStudents),
        attendanceRate: a ? pct(a.present, a.total) : null,
        collected: revenue.find((r) => r.groupId === g.id)?.collected ?? 0,
      };
    }).sort((a, b) => b.collected - a.collected || b.students - a.students);

    const totalSeats = items.reduce((s, g) => s + g.maxStudents, 0);
    const totalStudents = items.reduce((s, g) => s + g.students, 0);
    return { active: items.length, averageOccupancy: pct(totalStudents, totalSeats), items };
  }

  private async attendanceSection(tenantId: string, month: string) {
    const rows = await this.db.select({ status: attendance.status, n: sql<number>`count(*)::int` }).from(attendance)
      .where(and(eq(attendance.tenantId, tenantId), sql`${attendance.date} like ${month + '%'}`))
      .groupBy(attendance.status);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
    const total = rows.reduce((s, r) => s + r.n, 0);
    return { marks: total, byStatus, rate: pct((byStatus.PRESENT ?? 0) + (byStatus.LATE ?? 0), total) };
  }

  private async atRiskStudents(tenantId: string, month: string) {
    const lowAttendance = await this.db.select({
      studentId: attendance.studentId,
      total: sql<number>`count(*)::int`,
      present: sql<number>`count(*) filter (where ${attendance.status} in ('PRESENT', 'LATE'))::int`,
    }).from(attendance)
      .where(and(eq(attendance.tenantId, tenantId), sql`${attendance.date} like ${month + '%'}`))
      .groupBy(attendance.studentId)
      .having(sql`count(*) >= 3 and count(*) filter (where ${attendance.status} in ('PRESENT', 'LATE')) < 0.6 * count(*)`);
    const overdue = await this.db.select({ studentId: invoices.studentId, amount: sql<number>`sum(${invoices.remainingAmount})::int` })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'OVERDUE')))
      .groupBy(invoices.studentId);

    const ids = [...new Set([...lowAttendance.map((r) => r.studentId), ...overdue.map((r) => r.studentId)])];
    if (ids.length === 0) return [];
    // Phone is included for the quick SMS action; this report is staff-only.
    const people = await this.db.select({ id: students.id, fullName: students.fullName, phone: students.phone }).from(students)
      .where(and(eq(students.tenantId, tenantId), inArray(students.id, ids), isNull(students.deletedAt), eq(students.status, 'ACTIVE')));
    return people.map((p) => {
      const a = lowAttendance.find((r) => r.studentId === p.id);
      const o = overdue.find((r) => r.studentId === p.id);
      return {
        studentId: p.id,
        fullName: p.fullName,
        phone: p.phone,
        attendanceRate: a ? pct(a.present, a.total) : null,
        overdueAmount: o?.amount ?? 0,
        risk: a && o ? 'HIGH' : 'MEDIUM',
      };
    }).sort((x, y) => (x.risk === y.risk ? y.overdueAmount - x.overdueAmount : x.risk === 'HIGH' ? -1 : 1)).slice(0, 25);
  }

  private async financeSection(tenantId: string, month: string, includeProfit: boolean) {
    const summary = await this.paymentsService.getFinanceSummary(tenantId, month);
    // Year to date vs the same months of last year, so a partial year is
    // never compared with a full one.
    const [y, m] = month.split('-').map(Number);
    const ytd = async (year: number) => {
      const [{ total }] = await this.db.select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)::int` }).from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.status, 'PAID'),
          gte(payments.forMonth, `${year}-01`), sql`${payments.forMonth} <= ${`${year}-${String(m).padStart(2, '0')}`}`));
      return total;
    };
    const [thisYear, lastYear] = await Promise.all([ytd(y), ytd(y - 1)]);
    return {
      collected: summary.totalRevenue,
      expected: summary.totalExpectedRevenue,
      outstandingDebt: summary.totalOutstandingDebt,
      debtorCount: summary.debtorCount,
      // Share of what was expected that is covered. Using collected / expected
      // gave >100% when leavers or overpayments added to collected.
      collectionRate: pct(summary.totalExpectedRevenue - summary.totalOutstandingDebt, summary.totalExpectedRevenue),
      revenueByMethod: summary.revenueByMethod,
      yearToDate: { thisYear, lastYear, growth: lastYear > 0 ? pct(thisYear - lastYear, lastYear) : null },
      ...(includeProfit
        ? { expenses: summary.totalExpenses, salaries: summary.totalSalaries, netProfit: summary.netProfit, expensesByCategory: summary.expensesByCategory }
        : {}),
    };
  }
}
