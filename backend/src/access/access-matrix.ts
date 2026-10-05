import { canSeePay } from '../common/teacher-columns';
import { RouteAccessService, type RouteAccess } from './route-access';

export const MATRIX_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER'] as const;

/**
 * What staff can do, each tied to the route that does it. The matrix is the
 * route guards' own answer for each role (RouteAccessService), never a list
 * written by hand that could drift from the code. `note` marks a limit the
 * service adds on top (the frontend translates keys and notes).
 */
export interface Capability {
  key: string;
  area: 'students' | 'teaching' | 'admissions' | 'finance' | 'payroll' | 'center';
  method?: string;
  path?: string;
  /** Not a route: a rule applied inside answers (e.g. who sees pay). */
  rule?: (role: string) => boolean;
  note?: string;
}

export const CAPABILITIES: Capability[] = [
  { key: 'students.view', area: 'students', method: 'GET', path: '/api/students', note: 'teacherOwnGroups' },
  { key: 'students.create', area: 'students', method: 'POST', path: '/api/students' },
  { key: 'students.delete', area: 'students', method: 'DELETE', path: '/api/students/:id' },
  { key: 'groups.view', area: 'students', method: 'GET', path: '/api/groups', note: 'teacherOwnGroups' },
  { key: 'groups.create', area: 'students', method: 'POST', path: '/api/groups' },
  { key: 'teachers.view', area: 'teaching', method: 'GET', path: '/api/teachers' },
  { key: 'teachers.create', area: 'teaching', method: 'POST', path: '/api/teachers' },
  { key: 'attendance.mark', area: 'teaching', method: 'POST', path: '/api/attendance', note: 'teacherOwnGroups' },
  { key: 'homework.create', area: 'teaching', method: 'POST', path: '/api/homework' },
  { key: 'exams.create', area: 'teaching', method: 'POST', path: '/api/exams' },
  { key: 'leads.view', area: 'admissions', method: 'GET', path: '/api/leads' },
  { key: 'leads.create', area: 'admissions', method: 'POST', path: '/api/leads' },
  { key: 'payments.view', area: 'finance', method: 'GET', path: '/api/payments' },
  { key: 'payments.take', area: 'finance', method: 'POST', path: '/api/payments' },
  { key: 'invoices.generate', area: 'finance', method: 'POST', path: '/api/invoices/generate-monthly' },
  { key: 'debtors.remind', area: 'finance', method: 'POST', path: '/api/notifications/debtor-reminders' },
  { key: 'expenses.view', area: 'finance', method: 'GET', path: '/api/expenses' },
  { key: 'expenses.create', area: 'finance', method: 'POST', path: '/api/expenses' },
  { key: 'cash.view', area: 'finance', method: 'GET', path: '/api/cash/day' },
  { key: 'cash.close', area: 'finance', method: 'POST', path: '/api/cash/day/close' },
  { key: 'reports.director', area: 'finance', method: 'GET', path: '/api/reports/director' },
  { key: 'export.excel', area: 'finance', method: 'GET', path: '/api/export/students.xlsx' },
  { key: 'payroll.view', area: 'payroll', method: 'GET', path: '/api/salary-payments/calculate' },
  { key: 'payroll.pay', area: 'payroll', method: 'POST', path: '/api/salary-payments/disburse' },
  { key: 'payroll.rates', area: 'payroll', rule: canSeePay },
  { key: 'payroll.own', area: 'payroll', method: 'GET', path: '/api/salary-payments/me' },
  { key: 'staff.manage', area: 'center', method: 'POST', path: '/api/staff' },
  { key: 'settings.manage', area: 'center', method: 'PATCH', path: '/api/tenants/me' },
  { key: 'import.run', area: 'center', method: 'POST', path: '/api/import/:kind' },
  { key: 'announcements.create', area: 'center', method: 'POST', path: '/api/announcements' },
  { key: 'audit.view', area: 'center', method: 'GET', path: '/api/audit-logs' },
];

export interface AccessMatrix {
  roles: string[];
  capabilities: Array<{ key: string; area: Capability['area']; note?: string; route: string | null; allowed: Record<string, boolean> }>;
  /** Capabilities whose route no longer exists (a catalog to fix, never hidden). */
  missing: string[];
}

export function buildMatrix(find: (method: string, path: string) => RouteAccess | null): AccessMatrix {
  const missing: string[] = [];
  const capabilities = CAPABILITIES.map((c) => {
    const route = c.method && c.path ? find(c.method, c.path) : null;
    if (c.method && !route) missing.push(c.key);
    const allowed = Object.fromEntries(
      MATRIX_ROLES.map((role) => [role, c.rule ? c.rule(role) : route ? RouteAccessService.allows(route, role) : false]),
    );
    return { key: c.key, area: c.area, note: c.note, route: c.method ? `${c.method} ${c.path}` : null, allowed };
  });
  return { roles: [...MATRIX_ROLES], capabilities, missing };
}
