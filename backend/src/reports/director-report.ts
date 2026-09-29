// The director's month-by-month picture: money in vs expected, debt that
// builds up over months, and who leaves (and why). Pure functions over
// already-loaded rows, so the rules are easy to test.
//
// Expected tuition of a past month is rebuilt from enrollment dates with the
// group's current price (prices are not versioned): an enrollment counts in
// a month if it started before the month ended and had not ended before the
// month began. The current month uses the live state, exactly like the
// payments page, so both show the same debt.

export interface DrEnrollment {
  status: string; // ACTIVE | PAUSED | COMPLETED | CANCELLED
  joinedMonth: string; // YYYY-MM in the center's time zone
  leftMonth: string | null;
  price: number;
  groupName: string;
}

export interface DrStudent {
  id: string;
  fullName: string;
  phone: string | null;
  parentPhone: string | null;
  status: string; // ACTIVE | PAUSED | GRADUATED | LEFT
  createdMonth: string;
  leftMonth: string | null;
  leftAt: Date | null;
  leftReason: string | null;
  enrollments: DrEnrollment[];
}

export interface DrPayment {
  studentId: string;
  forMonth: string;
  amount: number;
  discount: number;
  paidAt: Date | null;
}

export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const monthsEnding = (month: string, n: number) => Array.from({ length: n }, (_, i) => shiftMonth(month, i - (n - 1)));

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Tuition a student was expected to pay for `month` (before discounts). */
export function expectedFor(s: DrStudent, month: string, currentMonth: string): number {
  if (month > currentMonth) return 0;
  if (month === currentMonth) {
    // Live state, as on the payments page.
    if (s.status !== 'ACTIVE') return 0;
    return s.enrollments.filter((e) => e.status === 'ACTIVE').reduce((sum, e) => sum + e.price, 0);
  }
  if (s.leftMonth && s.leftMonth < month) return 0;
  return s.enrollments
    .filter((e) => e.status !== 'PAUSED')
    // An ended enrollment without an end date is left out: no invented debt.
    .filter((e) => e.status === 'ACTIVE' || e.leftMonth)
    .filter((e) => e.joinedMonth <= month && (!e.leftMonth || e.leftMonth >= month))
    .reduce((sum, e) => sum + e.price, 0);
}

export function directorReport(input: {
  month: string;
  currentMonth: string;
  students: DrStudent[];
  payments: DrPayment[];
  expensesByMonth: Record<string, number>;
  salariesByMonth: Record<string, number>;
  includeProfit: boolean;
  trendMonths?: number;
  debtWindow?: number;
}) {
  const { month, currentMonth, students, payments } = input;
  const trendMonths = monthsEnding(month, input.trendMonths ?? 12);
  const debtMonths = monthsEnding(month, input.debtWindow ?? 6);

  // student -> month -> { paid, discount }
  const paid = new Map<string, Map<string, { paid: number; discount: number }>>();
  const collectedByMonth: Record<string, number> = {};
  const lastPaid = new Map<string, Date>();
  for (const p of payments) {
    const m = paid.get(p.studentId) ?? new Map();
    const cur = m.get(p.forMonth) ?? { paid: 0, discount: 0 };
    cur.paid += p.amount;
    cur.discount += p.discount;
    m.set(p.forMonth, cur);
    paid.set(p.studentId, m);
    collectedByMonth[p.forMonth] = (collectedByMonth[p.forMonth] ?? 0) + p.amount;
    if (p.paidAt && (!lastPaid.get(p.studentId) || lastPaid.get(p.studentId)! < p.paidAt)) lastPaid.set(p.studentId, p.paidAt);
  }
  const debtOf = (s: DrStudent, mm: string) => {
    const exp = expectedFor(s, mm, currentMonth);
    if (exp === 0) return { expected: 0, debt: 0 };
    const pm = paid.get(s.id)?.get(mm) ?? { paid: 0, discount: 0 };
    const effective = Math.max(0, exp - pm.discount);
    return { expected: effective, debt: Math.max(0, effective - pm.paid) };
  };

  // ---- trend
  const trend = trendMonths.map((mm) => {
    let expected = 0;
    let debt = 0;
    let activeAtStart = 0;
    let newStudents = 0;
    let left = 0;
    for (const s of students) {
      const d = debtOf(s, mm);
      expected += d.expected;
      debt += d.debt;
      if (s.createdMonth < mm && (!s.leftMonth || s.leftMonth >= mm)) activeAtStart++;
      if (s.createdMonth === mm) newStudents++;
      if (s.leftMonth === mm && s.status === 'LEFT') left++;
    }
    const collected = collectedByMonth[mm] ?? 0;
    const expenses = input.expensesByMonth[mm] ?? 0;
    const salaries = input.salariesByMonth[mm] ?? 0;
    return {
      month: mm,
      expected,
      collected,
      debt,
      collectionRate: pct(expected - debt, expected),
      newStudents,
      left,
      activeAtStart,
      churnRate: pct(left, activeAtStart),
      ...(input.includeProfit ? { expenses, salaries, net: collected - expenses - salaries } : {}),
    };
  });

  // ---- debtors (debt that has built up over the last months)
  const debtors = students
    .map((s) => {
      const perMonth = debtMonths.map((mm) => ({ month: mm, debt: debtOf(s, mm).debt })).filter((x) => x.debt > 0);
      const total = perMonth.reduce((sum, x) => sum + x.debt, 0);
      return {
        studentId: s.id,
        fullName: s.fullName,
        phone: s.phone,
        parentPhone: s.parentPhone,
        status: s.status,
        groups: [...new Set(s.enrollments.filter((e) => e.status === 'ACTIVE').map((e) => e.groupName))],
        totalDebt: total,
        monthsBehind: perMonth.length,
        oldestMonth: perMonth[0]?.month ?? null,
        currentMonthDebt: perMonth.find((x) => x.month === month)?.debt ?? 0,
        lastPaymentAt: lastPaid.get(s.id) ?? null,
      };
    })
    .filter((d) => d.totalDebt > 0)
    .sort((a, b) => b.totalDebt - a.totalDebt || b.monthsBehind - a.monthsBehind);

  // ---- churn in the month, with reasons over the last 3 months
  const leavers = students
    .filter((s) => s.status === 'LEFT' && s.leftMonth === month)
    .map((s) => ({
      studentId: s.id,
      fullName: s.fullName,
      leftAt: s.leftAt,
      reason: s.leftReason,
      groups: [...new Set(s.enrollments.map((e) => e.groupName))],
      monthsStudied: s.leftMonth ? monthsBetween(s.createdMonth, s.leftMonth) : null,
    }));
  const recent = new Set(monthsEnding(month, 3));
  const reasons: Record<string, number> = {};
  for (const s of students) {
    if (s.status === 'LEFT' && s.leftMonth && recent.has(s.leftMonth)) {
      const r = s.leftReason ?? 'UNKNOWN';
      reasons[r] = (reasons[r] ?? 0) + 1;
    }
  }
  const thisMonth = trend[trend.length - 1];

  return {
    month,
    trend,
    debtors: {
      window: debtMonths,
      totalDebt: debtors.reduce((s, d) => s + d.totalDebt, 0),
      count: debtors.length,
      multiMonth: debtors.filter((d) => d.monthsBehind >= 2).length,
      items: debtors,
    },
    churn: {
      left: thisMonth.left,
      activeAtStart: thisMonth.activeAtStart,
      rate: thisMonth.churnRate,
      reasonsLast3Months: reasons,
      leavers,
    },
  };
}

function monthsBetween(from: string, to: string) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}
