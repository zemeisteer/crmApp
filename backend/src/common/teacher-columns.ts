import { isConfigurableRole } from '../access/catalog';

/**
 * A teacher's pay (salary type and rate) is finance data: the owner, admins
 * and accountants see it; other staff (managers, reception, teachers) do
 * not - a teacher sees their own pay through /salary-payments/me. A member
 * whose access the owner set sees it when "payroll.rates" is on their list.
 * Retry keys are internal and never leave the server.
 */
export const PAY_ROLES = ['SUPERADMIN', 'OWNER', 'ADMIN', 'ACCOUNTANT'];

/** Who is looking: a role, or the signed-in member (role and own access list). */
export type PayViewer = string | { role?: string | null; access?: string[] | null } | undefined | null;

export function canSeePay(viewer: PayViewer): boolean {
  const role = typeof viewer === 'string' ? viewer : viewer?.role;
  const access = typeof viewer === 'object' && viewer ? viewer.access : undefined;
  if (isConfigurableRole(role) && Array.isArray(access)) return access.includes('payroll.rates');
  return !!role && PAY_ROLES.includes(role);
}

/** Columns of a teacher embedded in other answers (groups, timetable): no pay, no keys. */
export const TEACHER_PUBLIC_COLUMNS = { salaryType: false, salaryValue: false, idempotencyKey: false, requestHash: false } as const;

/** A teacher row as the viewer may see it. */
export function teacherView<T extends Record<string, unknown>>(row: T, viewer: PayViewer) {
  const { idempotencyKey: _k, requestHash: _h, salaryType, salaryValue, ...rest } = row as T & {
    idempotencyKey?: unknown;
    requestHash?: unknown;
    salaryType?: unknown;
    salaryValue?: unknown;
  };
  return canSeePay(viewer) ? { ...rest, salaryType, salaryValue } : rest;
}
