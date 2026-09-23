export enum Permission {
  STUDENTS_READ = 'students.read',
  STUDENTS_CREATE = 'students.create',
  STUDENTS_UPDATE = 'students.update',
  STUDENTS_DELETE = 'students.delete',

  PAYMENTS_READ = 'payments.read',
  PAYMENTS_CREATE = 'payments.create',
  EXPENSES_MANAGE = 'expenses.manage',

  ATTENDANCE_READ = 'attendance.read',
  ATTENDANCE_MARK = 'attendance.mark',

  GROUPS_MANAGE = 'groups.manage',
  HOMEWORK_MANAGE = 'homework.manage',
  EXAMS_MANAGE = 'exams.manage',
  CERTIFICATES_MANAGE = 'certificates.manage',

  STAFF_MANAGE = 'staff.manage',
  SETTINGS_MANAGE = 'settings.manage',
  REPORTS_EXPORT = 'reports.export',
  NOTIFICATIONS_SEND = 'notifications.send',
}

export const ALL_PERMISSIONS = Object.values(Permission);

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPERADMIN: ALL_PERMISSIONS,
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
  MANAGER: [
    Permission.STUDENTS_READ,
    Permission.STUDENTS_CREATE,
    Permission.STUDENTS_UPDATE,
    Permission.ATTENDANCE_READ,
    Permission.ATTENDANCE_MARK,
    Permission.GROUPS_MANAGE,
    Permission.HOMEWORK_MANAGE,
    Permission.EXAMS_MANAGE,
    Permission.CERTIFICATES_MANAGE,
    Permission.REPORTS_EXPORT,
  ],
  RECEPTIONIST: [
    Permission.STUDENTS_READ,
    Permission.STUDENTS_CREATE,
    Permission.STUDENTS_UPDATE,
    Permission.ATTENDANCE_READ,
    Permission.PAYMENTS_READ,
    Permission.PAYMENTS_CREATE,
    Permission.NOTIFICATIONS_SEND,
  ],
  ACCOUNTANT: [
    Permission.PAYMENTS_READ,
    Permission.PAYMENTS_CREATE,
    Permission.EXPENSES_MANAGE,
    Permission.REPORTS_EXPORT,
    Permission.NOTIFICATIONS_SEND,
  ],
  TEACHER: [
    Permission.STUDENTS_READ,
    Permission.ATTENDANCE_READ,
    Permission.ATTENDANCE_MARK,
    Permission.HOMEWORK_MANAGE,
    Permission.EXAMS_MANAGE,
  ],
  STUDENT: [
    Permission.STUDENTS_READ,
    Permission.ATTENDANCE_READ,
    Permission.PAYMENTS_READ,
  ],
  PARENT: [
    Permission.STUDENTS_READ,
    Permission.ATTENDANCE_READ,
    Permission.PAYMENTS_READ,
  ],
};

export function getEffectivePermissions(
  role: string,
  customPermissions?: string[] | null,
): string[] {
  if (role === 'SUPERADMIN' || role === 'ADMIN' || role === 'OWNER') {
    return ALL_PERMISSIONS;
  }
  const base = DEFAULT_ROLE_PERMISSIONS[role] || [];
  if (!customPermissions || customPermissions.length === 0) {
    return base;
  }
  const merged = new Set([...base, ...customPermissions]);
  return Array.from(merged);
}
