import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { enrollments, groups, schedules } from '../db/schema';
import { isOverlapping } from '../schedule/schedule.service';

type Tx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

const DAY_NAMES = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

export interface StudentTimeClash {
  groupA: string;
  groupB: string;
  dayOfWeek: number;
  timeA: string;
  timeB: string;
}

// A student can't sit in two lessons at once. Compares the weekly lessons
// of the groups being added against each other and against the student's
// current active groups. Only clashes involving a new group are reported,
// so an old clash doesn't block unrelated enrollments.
export async function findStudentTimeClashes(
  db: Tx,
  tenantId: string,
  studentId: string | null,
  newGroupIds: string[],
): Promise<StudentTimeClash[]> {
  if (newGroupIds.length === 0) return [];
  const current = studentId
    ? (await db.select({ groupId: enrollments.groupId }).from(enrollments)
        .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'ACTIVE')))).map((r) => r.groupId)
    : [];
  const all = [...new Set([...current, ...newGroupIds])];
  if (all.length < 2) return [];

  const lessons = await db
    .select({ groupId: schedules.groupId, name: groups.name, dayOfWeek: schedules.dayOfWeek, start: schedules.startTime, end: schedules.endTime })
    .from(schedules)
    .innerJoin(groups, eq(groups.id, schedules.groupId))
    .where(and(
      eq(schedules.tenantId, tenantId),
      inArray(schedules.groupId, all),
      eq(schedules.isRecurring, true),
      isNull(schedules.date),
      ne(schedules.status, 'CANCELLED'),
      isNull(groups.deletedAt),
    ));

  const isNew = new Set(newGroupIds);
  const clashes: StudentTimeClash[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const a = lessons[i];
      const b = lessons[j];
      if (a.groupId === b.groupId || a.dayOfWeek !== b.dayOfWeek || a.dayOfWeek == null) continue;
      if (!isNew.has(a.groupId) && !isNew.has(b.groupId)) continue;
      if (!isOverlapping(a.start, a.end, b.start, b.end)) continue;
      const key = [a.groupId, b.groupId].sort().join('|') + a.dayOfWeek;
      if (seen.has(key)) continue;
      seen.add(key);
      clashes.push({ groupA: a.name, groupB: b.name, dayOfWeek: a.dayOfWeek, timeA: `${a.start}-${a.end}`, timeB: `${b.start}-${b.end}` });
    }
  }
  return clashes;
}

export async function assertNoStudentTimeClash(db: Tx, tenantId: string, studentId: string | null, newGroupIds: string[]) {
  const clashes = await findStudentTimeClashes(db, tenantId, studentId, newGroupIds);
  if (clashes.length === 0) return;
  const c = clashes[0];
  throw new ConflictException({
    code: 'STUDENT_SCHEDULE_CONFLICT',
    message: `Dars vaqtlari to'qnashadi: "${c.groupA}" (${c.timeA}) va "${c.groupB}" (${c.timeB}), ${DAY_NAMES[c.dayOfWeek]}`,
    conflicts: clashes,
  });
}
