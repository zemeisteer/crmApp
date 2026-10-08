/**
 * What a center owner can turn on or off for a staff member, one key per
 * thing people do, each tied to the routes that do it.
 *
 * - The roles that can be tailored are CONFIGURABLE_ROLES. The owner and
 *   admins always have everything; students and parents use the portal.
 * - A staff member with no own list (access = null) has their role's
 *   template, which is exactly what the role could do before lists existed
 *   (`template` below; a test checks it against the route guards, so it
 *   cannot drift from what the server does).
 * - A staff member with an own list can do exactly what is on it, on these
 *   routes. Everything not in the catalog stays as the role allows (sign-in,
 *   the portal, the platform, the center's own settings and staff: those
 *   stay with the owner and admins and cannot be handed out).
 * - Limits inside services still apply on top (a teacher sees only their own
 *   groups, pay is shown only to the roles that handle it).
 */
export const CONFIGURABLE_ROLES = ['MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const ACCESS_AREAS = ['students', 'teaching', 'admissions', 'finance', 'payroll', 'center'] as const;
export type AccessArea = (typeof ACCESS_AREAS)[number];

export interface AccessKey {
  key: string;
  area: AccessArea;
  /** Roles that have it by default. */
  template: ConfigurableRole[];
  /** "METHOD /api/path" exactly as the routes are declared. */
  routes: string[];
}

const M = 'MANAGER';
const R = 'RECEPTIONIST';
const A = 'ACCOUNTANT';
const T = 'TEACHER';
const ALL: ConfigurableRole[] = [M, R, A, T];

export const ACCESS_CATALOG: AccessKey[] = [
  // ---- Students and groups ----
  { key: 'students.view', area: 'students', template: ALL, routes: ['GET /api/students', 'GET /api/students/:id', 'GET /api/students/:id/guardians'] },
  {
    key: 'students.edit', area: 'students', template: [],
    routes: ['POST /api/students', 'PATCH /api/students/:id', 'POST /api/students/:id/enroll/:groupId', 'DELETE /api/students/:id/enroll/:groupId', 'POST /api/students/:id/guardians', 'DELETE /api/students/:id/guardians/:guardianId'],
  },
  { key: 'students.delete', area: 'students', template: [], routes: ['DELETE /api/students/:id', 'GET /api/students/trash', 'POST /api/students/:id/restore'] },
  { key: 'students.portalPin', area: 'students', template: [M, R], routes: ['GET /api/students/:id/portal-pin', 'POST /api/students/:id/portal-pin'] },
  { key: 'groups.view', area: 'students', template: ALL, routes: ['GET /api/groups', 'GET /api/groups/:id'] },
  { key: 'groups.edit', area: 'students', template: [], routes: ['POST /api/groups', 'PATCH /api/groups/:id', 'GET /api/groups/schedule-conflicts'] },
  { key: 'groups.delete', area: 'students', template: [], routes: ['DELETE /api/groups/:id', 'GET /api/groups/trash', 'POST /api/groups/:id/restore'] },
  { key: 'groups.priceHistory', area: 'students', template: [M, A], routes: ['GET /api/groups/:id/price-history'] },
  { key: 'groups.setPrice', area: 'students', template: [A], routes: ['POST /api/groups/:id/price-history'] },
  {
    key: 'subjects.manage', area: 'students', template: ALL,
    routes: [
      'POST /api/subjects', 'POST /api/subjects/bulk', 'PUT /api/subjects/:id', 'POST /api/subjects/:id/archive', 'DELETE /api/subjects/:id',
      'POST /api/subjects/courses', 'PUT /api/subjects/courses/:id', 'POST /api/subjects/courses/:id/archive', 'DELETE /api/subjects/courses/:id',
    ],
  },

  // ---- Teaching ----
  { key: 'teachers.view', area: 'teaching', template: ALL, routes: ['GET /api/teachers', 'GET /api/teachers/:id'] },
  { key: 'teachers.edit', area: 'teaching', template: [], routes: ['POST /api/teachers', 'PATCH /api/teachers/:id', 'POST /api/teachers/:id/account', 'DELETE /api/teachers/:id/account'] },
  { key: 'teachers.delete', area: 'teaching', template: [], routes: ['DELETE /api/teachers/:id', 'GET /api/teachers/trash', 'POST /api/teachers/:id/restore'] },
  { key: 'teacherAttendance.mark', area: 'teaching', template: [M, R], routes: ['GET /api/teacher-attendance', 'POST /api/teacher-attendance'] },
  { key: 'schedule.view', area: 'teaching', template: ALL, routes: ['GET /api/schedule', 'GET /api/schedule/:id', 'POST /api/schedule/check-conflict', 'GET /api/schedule/rooms', 'GET /api/schedule/rooms/:id', 'GET /api/lessons', 'GET /api/lessons/cancellations'] },
  { key: 'lessons.cancel', area: 'teaching', template: [M], routes: ['POST /api/lessons/cancellations', 'DELETE /api/lessons/cancellations/:id'] },
  { key: 'makeups.view', area: 'teaching', template: [M, R], routes: ['GET /api/makeups/eligible', 'GET /api/makeups/credits'] },
  {
    key: 'makeups.manage', area: 'teaching', template: [M, R],
    routes: ['POST /api/makeups/credits', 'POST /api/makeups/credits/:id/cancel', 'POST /api/makeups/credits/:id/reinstate', 'POST /api/makeups/credits/:id/book', 'POST /api/makeups/bookings/:id/cancel'],
  },
  { key: 'makeups.attend', area: 'teaching', template: [M, R, T], routes: ['GET /api/makeups/roster', 'POST /api/makeups/bookings/:id/attendance'] },
  { key: 'schedule.edit', area: 'teaching', template: [T], routes: ['POST /api/schedule', 'PATCH /api/schedule/:id'] },
  { key: 'schedule.delete', area: 'teaching', template: [], routes: ['DELETE /api/schedule/:id'] },
  { key: 'rooms.manage', area: 'teaching', template: [], routes: ['POST /api/schedule/rooms', 'PATCH /api/schedule/rooms/:id', 'DELETE /api/schedule/rooms/:id'] },
  { key: 'attendance.view', area: 'teaching', template: ALL, routes: ['GET /api/attendance', 'GET /api/attendance/topics'] },
  { key: 'attendance.mark', area: 'teaching', template: [M, R, T], routes: ['POST /api/attendance', 'POST /api/attendance/qr-checkin'] },
  {
    key: 'homework.view', area: 'teaching', template: ALL,
    routes: ['GET /api/homework', 'GET /api/homework/leaderboard', 'GET /api/homework/:id', 'GET /api/homework/:id/roster', 'POST /api/homework/:id/submit'],
  },
  {
    key: 'homework.manage', area: 'teaching', template: [T],
    routes: [
      'POST /api/homework', 'PATCH /api/homework/:id', 'DELETE /api/homework/:id', 'POST /api/homework/:id/attachment', 'POST /api/homework/:id/attachment-text',
      'POST /api/homework/:id/completions', 'POST /api/homework/:id/grade',
    ],
  },
  { key: 'exams.view', area: 'teaching', template: ALL, routes: ['GET /api/exams', 'GET /api/exams/:id', 'GET /api/exams/:id/start-attempt', 'POST /api/exams/:id/submit-attempt'] },
  {
    key: 'exams.manage', area: 'teaching', template: [T],
    routes: [
      'POST /api/exams', 'DELETE /api/exams/:id', 'POST /api/exams/:id/material', 'POST /api/exams/:id/results',
      'GET /api/exams/:id/questions', 'POST /api/exams/:id/questions', 'POST /api/exams/:id/questions/batch', 'DELETE /api/exams/:id/questions/:questionId',
      'POST /api/exams/:id/questions/parse-text', 'POST /api/exams/:id/questions/parse-pdf', 'POST /api/exams/:id/generate-questions',
      'GET /api/exams/:id/attempts', 'GET /api/exams/:id/attempts/:attemptId', 'POST /api/exams/:id/attempts/:attemptId/grade', 'POST /api/exams/:id/attempts/:attemptId/ai-review',
    ],
  },
  {
    key: 'mockTests.manage', area: 'teaching', template: [M, T],
    routes: [
      'GET /api/mock-tests', 'POST /api/mock-tests', 'GET /api/mock-tests/:id', 'PATCH /api/mock-tests/:id', 'POST /api/mock-tests/:id/asset', 'GET /api/mock-tests/:id/attempts',
      'POST /api/mock-tests/generate-questions', 'POST /api/mock-tests/import', 'GET /api/mock-tests/imports', 'GET /api/mock-tests/imports/:importId',
      'GET /api/mock-tests/attempts/:attemptId', 'POST /api/mock-tests/attempts/:attemptId/review', 'POST /api/mock-tests/attempts/:attemptId/review-practice', 'POST /api/mock-tests/attempts/:attemptId/regrade',
    ],
  },
  { key: 'mockTests.delete', area: 'teaching', template: [M], routes: ['DELETE /api/mock-tests/:id'] },
  {
    key: 'placement.manage', area: 'teaching', template: [M, R, T],
    routes: [
      'GET /api/placement-tests', 'POST /api/placement-tests', 'POST /api/placement-tests/parse-pdf', 'GET /api/placement-tests/:id', 'PATCH /api/placement-tests/:id',
      'GET /api/placement-tests/:id/attempts', 'GET /api/placement-tests/:id/attempts/:attemptId', 'POST /api/placement-tests/:id/attempts/:attemptId/grade', 'POST /api/placement-tests/:id/attempts/:attemptId/ai-review',
    ],
  },
  { key: 'certificates.manage', area: 'teaching', template: [T], routes: ['GET /api/certificates', 'GET /api/certificates/:id', 'POST /api/certificates'] },
  { key: 'certificates.delete', area: 'teaching', template: [], routes: ['DELETE /api/certificates/:id'] },
  {
    key: 'ai.use', area: 'teaching', template: ALL,
    routes: ['GET /api/ai/tutor-report', 'POST /api/ai/tutor-report/topics', 'POST /api/ai/insights', 'POST /api/ai/materials', 'POST /api/ai/suggest-homework', 'POST /api/ai/pdf'],
  },

  // ---- Admissions ----
  {
    key: 'leads.view', area: 'admissions', template: [M, R],
    routes: ['GET /api/leads', 'GET /api/leads/:id', 'GET /api/leads/:id/timeline', 'GET /api/leads/follow-ups/summary', 'GET /api/leads/duplicates', 'GET /api/leads/assignable-managers', 'GET /api/leads/trials'],
  },
  {
    key: 'leads.edit', area: 'admissions', template: [M, R],
    routes: [
      'POST /api/leads', 'PATCH /api/leads/:id', 'POST /api/leads/:id/transition', 'POST /api/leads/:id/lose', 'POST /api/leads/:id/follow-up', 'POST /api/leads/:id/activities',
      'POST /api/leads/:id/trials/check', 'POST /api/leads/:id/trials', 'POST /api/leads/:id/trials/:trialId/reschedule', 'POST /api/leads/:id/trials/:trialId/attend',
      'POST /api/leads/:id/trials/:trialId/miss', 'POST /api/leads/:id/trials/:trialId/cancel',
    ],
  },
  { key: 'leads.assign', area: 'admissions', template: [M], routes: ['POST /api/leads/:id/assign'] },
  { key: 'leads.convert', area: 'admissions', template: [M], routes: ['GET /api/leads/:id/student-match', 'POST /api/leads/:id/convert'] },
  { key: 'leads.manage', area: 'admissions', template: [M], routes: ['POST /api/leads/:id/reopen', 'POST /api/leads/:id/archive', 'POST /api/leads/:id/restore', 'DELETE /api/leads/:id'] },
  { key: 'leads.analytics', area: 'admissions', template: [M], routes: ['GET /api/leads/funnel', 'GET /api/leads/analytics'] },
  { key: 'leads.export', area: 'admissions', template: [M], routes: ['GET /api/leads/export'] },

  // ---- Finance ----
  {
    key: 'payments.view', area: 'finance', template: [M, R, A],
    routes: ['GET /api/payments', 'GET /api/payments/:id', 'GET /api/payments/summary', 'GET /api/payments/debtors', 'GET /api/payments/finance-summary'],
  },
  { key: 'payments.take', area: 'finance', template: [A], routes: ['POST /api/payments'] },
  { key: 'payments.onlineLink', area: 'finance', template: [M, R, A], routes: ['POST /api/billing/click/link', 'POST /api/billing/payme/link'] },
  {
    key: 'invoices.manage', area: 'finance', template: [A],
    routes: ['GET /api/invoices', 'GET /api/invoices/:id', 'POST /api/invoices', 'POST /api/invoices/generate-monthly', 'POST /api/invoices/:id/cancel'],
  },
  { key: 'debtors.remind', area: 'finance', template: [A], routes: ['GET /api/notifications/debtor-reminders/preview', 'POST /api/notifications/debtor-reminders'] },
  { key: 'cash.view', area: 'finance', template: [M, R, A], routes: ['GET /api/cash/day', 'GET /api/cash/closings'] },
  { key: 'cash.close', area: 'finance', template: [A], routes: ['POST /api/cash/day/close'] },
  { key: 'expenses.view', area: 'finance', template: [A], routes: ['GET /api/expenses', 'GET /api/expenses/:id', 'GET /api/expenses/summary'] },
  { key: 'expenses.edit', area: 'finance', template: [A], routes: ['POST /api/expenses', 'PATCH /api/expenses/:id'] },
  { key: 'expenses.delete', area: 'finance', template: [], routes: ['DELETE /api/expenses/:id'] },
  { key: 'reports.finance', area: 'finance', template: [M, A], routes: ['GET /api/reports/overview', 'GET /api/reports/director'] },
  { key: 'export.excel', area: 'finance', template: [A], routes: ['GET /api/export/students.xlsx', 'GET /api/export/payments.xlsx', 'GET /api/export/payments/:id/receipt.pdf'] },
  { key: 'notifications.logs', area: 'finance', template: [M], routes: ['GET /api/notifications/logs', 'GET /api/notifications/stats'] },

  // ---- Payroll ----
  { key: 'payroll.view', area: 'payroll', template: [A], routes: ['GET /api/salary-payments', 'GET /api/salary-payments/calculate', 'GET /api/salary-payments/reconciliation'] },
  { key: 'payroll.pay', area: 'payroll', template: [A], routes: ['POST /api/salary-payments/disburse', 'POST /api/salary-payments/:id/reverse', 'POST /api/salary-payments/:id/link-expense'] },
  { key: 'payroll.teacherMonth', area: 'payroll', template: [M, A], routes: ['GET /api/teacher-attendance/month'] },
  { key: 'payroll.own', area: 'payroll', template: [T], routes: ['GET /api/salary-payments/me'] },
  // Not a route: whether teachers' pay (type and rate) shows in the teacher
  // list and card (common/teacher-columns.ts).
  { key: 'payroll.rates', area: 'payroll', template: [A], routes: [] },

  // ---- Center ----
  { key: 'announcements.view', area: 'center', template: [T], routes: ['GET /api/announcements', 'GET /api/announcements/:id'] },
  { key: 'announcements.manage', area: 'center', template: [], routes: ['POST /api/announcements', 'DELETE /api/announcements/:id'] },
  { key: 'import.run', area: 'center', template: [], routes: ['GET /api/import/:kind/template.xlsx', 'POST /api/import/:kind'] },
];

export const ACCESS_KEYS = ACCESS_CATALOG.map((k) => k.key);

const byRoute = new Map<string, string>();
for (const k of ACCESS_CATALOG) for (const r of k.routes) byRoute.set(r, k.key);

/** The catalog key of a route ("GET /api/students"), or null when it is not configurable. */
export function accessKeyFor(route: string): string | null {
  return byRoute.get(route) ?? null;
}

export function isConfigurableRole(role: string | undefined | null): role is ConfigurableRole {
  return (CONFIGURABLE_ROLES as readonly string[]).includes(role ?? '');
}

export function templateFor(role: string): string[] {
  if (!isConfigurableRole(role)) return [];
  return ACCESS_CATALOG.filter((k) => k.template.includes(role)).map((k) => k.key);
}

/**
 * What this member can do among the catalog keys: everything for the owner,
 * admins and the platform; the own list (or the role's template) for the
 * configurable roles; nothing for others.
 */
export function effectiveAccess(role: string, access: string[] | null | undefined): string[] {
  if (role === 'OWNER' || role === 'ADMIN' || role === 'SUPERADMIN') return [...ACCESS_KEYS];
  if (!isConfigurableRole(role)) return [];
  return Array.isArray(access) ? ACCESS_KEYS.filter((k) => access.includes(k)) : templateFor(role);
}

/**
 * The guards' answer for a configurable member with their own list: true or
 * false for a catalog route, null when the list does not decide (no list,
 * another role, or a route outside the catalog) and the role rules apply.
 */
export function accessDecides(route: string, role: string | undefined, access: string[] | null | undefined): boolean | null {
  if (!isConfigurableRole(role) || !Array.isArray(access)) return null;
  const key = accessKeyFor(route);
  if (!key) return null;
  return access.includes(key);
}

// Admissions code checks its own permission names; a member's list maps onto them.
const ADMISSIONS_PERMISSIONS: Record<string, string[]> = {
  'leads.view': ['admissions.read'],
  'leads.edit': ['admissions.create', 'admissions.update'],
  'leads.assign': ['admissions.assign'],
  'leads.convert': ['admissions.convert'],
  'leads.manage': ['admissions.manage'],
  'leads.analytics': ['admissions.analytics'],
  'leads.export': ['admissions.export'],
};
export function admissionsPermissionsFor(access: string[]): string[] {
  return access.flatMap((k) => ADMISSIONS_PERMISSIONS[k] ?? []);
}
