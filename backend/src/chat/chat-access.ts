import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { chatConversations, enrollments, groups, students, teachers } from '../db/schema';
import { effectiveAccess } from '../access/catalog';

type Executor = Pick<Database, 'select'>;
export type Conversation = typeof chatConversations.$inferSelect;

/**
 * Who is talking. Staff (and their access list) by their account; a
 * student's cabinet by the student - a student or a parent looking at that
 * student's cabinet. A cabinet opened with a PIN does not identify a single
 * person: messages from it say "from <student>'s cabinet (student/parent)".
 * A cabinet opened from a parent account carries that parent's user id.
 */
export type ChatActor =
  | { kind: 'staff'; tenantId: string; userId: string; role: string; access?: string[] | null; name?: string }
  | { kind: 'cabinet'; tenantId: string; studentId: string; viewer: 'student' | 'parent'; parentUserId?: string | null };

export const participantKey = (a: ChatActor) => (a.kind === 'staff' ? `u:${a.userId}` : `c:${a.studentId}`);

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

/** Staff who answer the center's inbox: owner and admins always; others when their access list has chat.center. */
export function answersCenter(a: ChatActor) {
  if (a.kind !== 'staff') return false;
  if (ADMIN_ROLES.has(a.role)) return true;
  return effectiveAccess(a.role, a.access).includes('chat.center');
}

/** The teachers (user ids) currently teaching a student: ACTIVE enrollment in a group whose teacher has an account. */
export async function currentTeacherUserIds(db: Executor, tenantId: string, studentId: string): Promise<Set<string>> {
  const rows = await db.select({ userId: teachers.userId }).from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .innerJoin(teachers, eq(teachers.id, groups.teacherId))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'ACTIVE'), eq(groups.tenantId, tenantId), isNull(groups.deletedAt), isNull(teachers.deletedAt)));
  return new Set(rows.map((r) => r.userId).filter((x): x is string => !!x));
}

/** The user id of a group's teacher (null when the group has none or it has no account). */
export async function groupTeacherUserId(db: Executor, tenantId: string, groupId: string) {
  const [g] = await db.select({ userId: teachers.userId }).from(groups)
    .innerJoin(teachers, eq(teachers.id, groups.teacherId))
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt), isNull(teachers.deletedAt)));
  return g?.userId ?? null;
}

export async function activeInGroup(db: Executor, studentId: string, groupId: string) {
  const [e] = await db.select({ id: enrollments.id }).from(enrollments)
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.groupId, groupId), eq(enrollments.status, 'ACTIVE')));
  return !!e;
}

export interface Access {
  read: boolean;
  write: boolean;
  /** Read for safeguarding (owner/admin in a teacher's or a group's conversation). */
  oversight?: boolean;
}
const NONE: Access = { read: false, write: false };

/**
 * What an actor may do in a conversation, decided from live data every
 * time (enrollments, teacher assignments, access lists) - knowing a
 * conversation id grants nothing:
 *  - STUDENT_CENTER: the center's inbox staff and the student's cabinet;
 *  - STUDENT_TEACHER: that teacher while they teach the student (owner and
 *    admins may read it); the cabinet reads it, and writes while the
 *    teacher still teaches the student;
 *  - GROUP: the group's teacher, and the cabinets of students actively in
 *    the group (a parent viewing reads; the student writes); owner and
 *    admins may read it.
 */
export async function accessTo(db: Executor, actor: ChatActor, c: Conversation): Promise<Access> {
  if (c.tenantId !== actor.tenantId) return NONE;
  if (actor.kind === 'cabinet') {
    const [s] = await db.select({ id: students.id }).from(students).where(and(eq(students.id, actor.studentId), eq(students.tenantId, actor.tenantId), isNull(students.deletedAt)));
    if (!s) return NONE;
    if (c.kind === 'STUDENT_CENTER') return { read: c.studentId === actor.studentId, write: c.studentId === actor.studentId };
    if (c.kind === 'STUDENT_TEACHER') {
      if (c.studentId !== actor.studentId) return NONE;
      const teaching = (await currentTeacherUserIds(db, actor.tenantId, actor.studentId)).has(c.teacherUserId ?? '');
      return { read: true, write: teaching };
    }
    if (c.kind === 'GROUP' && c.groupId && (await activeInGroup(db, actor.studentId, c.groupId))) {
      return { read: true, write: actor.viewer === 'student' };
    }
    return NONE;
  }
  // Staff.
  if (c.kind === 'STUDENT_CENTER') return answersCenter(actor) ? { read: true, write: true } : NONE;
  if (c.kind === 'STUDENT_TEACHER') {
    if (actor.userId === c.teacherUserId && c.studentId && (await currentTeacherUserIds(db, actor.tenantId, c.studentId)).has(actor.userId)) return { read: true, write: true };
    return ADMIN_ROLES.has(actor.role) ? { read: true, write: false, oversight: true } : NONE;
  }
  if (c.kind === 'GROUP' && c.groupId) {
    if ((await groupTeacherUserId(db, actor.tenantId, c.groupId)) === actor.userId) return { read: true, write: true };
    return ADMIN_ROLES.has(actor.role) ? { read: true, write: false, oversight: true } : NONE;
  }
  return NONE;
}

/** The conversations an actor could possibly see (then each is checked with accessTo). */
export async function candidateConversations(db: Executor, actor: ChatActor): Promise<Conversation[]> {
  if (actor.kind === 'cabinet') {
    const own = await db.select().from(chatConversations)
      .where(and(eq(chatConversations.tenantId, actor.tenantId), eq(chatConversations.studentId, actor.studentId)));
    const myGroups = (await db.select({ groupId: enrollments.groupId }).from(enrollments)
      .where(and(eq(enrollments.studentId, actor.studentId), eq(enrollments.status, 'ACTIVE')))).map((e) => e.groupId);
    const grp = myGroups.length
      ? await db.select().from(chatConversations).where(and(eq(chatConversations.tenantId, actor.tenantId), eq(chatConversations.kind, 'GROUP'), inArray(chatConversations.groupId, myGroups)))
      : [];
    return [...own, ...grp];
  }
  if (ADMIN_ROLES.has(actor.role)) {
    return db.select().from(chatConversations).where(eq(chatConversations.tenantId, actor.tenantId));
  }
  const out: Conversation[] = [];
  if (answersCenter(actor)) {
    out.push(...(await db.select().from(chatConversations).where(and(eq(chatConversations.tenantId, actor.tenantId), eq(chatConversations.kind, 'STUDENT_CENTER')))));
  }
  out.push(...(await db.select().from(chatConversations).where(and(eq(chatConversations.tenantId, actor.tenantId), eq(chatConversations.teacherUserId, actor.userId)))));
  const [t] = await db.select({ id: teachers.id }).from(teachers).where(and(eq(teachers.tenantId, actor.tenantId), eq(teachers.userId, actor.userId), isNull(teachers.deletedAt)));
  if (t) {
    const mine = (await db.select({ id: groups.id }).from(groups).where(and(eq(groups.tenantId, actor.tenantId), eq(groups.teacherId, t.id), isNull(groups.deletedAt)))).map((g) => g.id);
    if (mine.length) out.push(...(await db.select().from(chatConversations).where(and(eq(chatConversations.tenantId, actor.tenantId), eq(chatConversations.kind, 'GROUP'), inArray(chatConversations.groupId, mine)))));
  }
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
