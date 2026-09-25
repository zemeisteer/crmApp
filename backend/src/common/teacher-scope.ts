import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { enrollments, groups, teachers } from '../db/schema';

// Teachers only work with their own groups: their attendance lists, QR
// check-ins and student rosters are limited to groups where they are the
// assigned teacher. Returns null for every other role (no restriction) and
// an empty list for a teacher account with no teacher record or no groups.
export async function teacherGroupIds(
  db: Database,
  tenantId: string,
  role: string | undefined,
  userId: string | undefined,
): Promise<string[] | null> {
  if (role !== 'TEACHER') return null;
  if (!userId) return [];
  const teacher = await db.query.teachers.findFirst({
    where: and(eq(teachers.userId, userId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
    columns: { id: true },
  });
  if (!teacher) return [];
  const rows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.tenantId, tenantId), eq(groups.teacherId, teacher.id), isNull(groups.deletedAt)));
  return rows.map((r) => r.id);
}

// Students with an ACTIVE enrollment in any of the given groups.
export async function studentIdsInGroups(db: Database, groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ id: enrollments.studentId })
    .from(enrollments)
    .where(and(inArray(enrollments.groupId, groupIds), eq(enrollments.status, 'ACTIVE')));
  return rows.map((r) => r.id);
}
