/**
 * A teacher's pay (salary type and rate) is finance data: the owner, admins
 * and accountants see it; other staff (managers, reception, teachers) do
 * not - a teacher sees their own pay through /salary-payments/me. Retry keys
 * are internal and never leave the server.
 */
export const PAY_ROLES = ['SUPERADMIN', 'OWNER', 'ADMIN', 'ACCOUNTANT'];

export const canSeePay = (role: string | undefined | null) => !!role && PAY_ROLES.includes(role);

/** Columns of a teacher embedded in other answers (groups, timetable): no pay, no keys. */
export const TEACHER_PUBLIC_COLUMNS = { salaryType: false, salaryValue: false, idempotencyKey: false, requestHash: false } as const;

/** A teacher row as `role` may see it. */
export function teacherView<T extends Record<string, unknown>>(row: T, role: string | undefined | null) {
  const { idempotencyKey: _k, requestHash: _h, salaryType, salaryValue, ...rest } = row as T & {
    idempotencyKey?: unknown;
    requestHash?: unknown;
    salaryType?: unknown;
    salaryValue?: unknown;
  };
  return canSeePay(role) ? { ...rest, salaryType, salaryValue } : rest;
}
