import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { leads, students } from '../db/schema';

export type ContactMatch =
  | { kind: 'LEAD'; leadId: string; studentId: string | null }
  | { kind: 'STUDENT'; leadId: string | null; studentId: string }
  | { kind: 'PARENT'; leadId: null; studentId: string }
  | { kind: 'UNKNOWN'; leadId: null; studentId: null };

/**
 * Who a (normalized) number belongs to in this center, in the order the
 * owner chose:
 *   1. an open lead with this number (not yet a student)
 *   2. a student with this number
 *   3. a student whose parent has this number (the call is kept on the
 *      child's card)
 *   4. a lead with this number that already became a student: that student
 *      (the call is on the student's card, and linked to the old lead)
 * Nothing found: UNKNOWN (an incoming call then opens a new lead).
 *
 * Every query is limited to tenantId: another center's people are never
 * looked at. Several matches of one kind (siblings with one parent phone):
 * an active student first, then the most recently added.
 */
export async function matchContact(db: Pick<Database, 'select'>, tenantId: string, phone: string): Promise<ContactMatch> {
  const leadRows = await db
    .select({ id: leads.id, convertedStudentId: leads.convertedStudentId })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.phoneNormalized, phone), isNull(leads.archivedAt), isNull(leads.duplicateOfLeadId)))
    .orderBy(desc(leads.createdAt))
    .limit(5);
  const open = leadRows.find((l) => !l.convertedStudentId);
  if (open) return { kind: 'LEAD', leadId: open.id, studentId: null };

  const student = async (column: typeof students.phoneNormalized | typeof students.parentPhoneNormalized) => {
    const [s] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.tenantId, tenantId), eq(column, phone), isNull(students.deletedAt)))
      .orderBy(sql`CASE WHEN ${students.status} = 'ACTIVE' THEN 0 ELSE 1 END`, desc(students.createdAt))
      .limit(1);
    return s?.id ?? null;
  };
  const own = await student(students.phoneNormalized);
  if (own) return { kind: 'STUDENT', leadId: null, studentId: own };
  const child = await student(students.parentPhoneNormalized);
  if (child) return { kind: 'PARENT', leadId: null, studentId: child };

  const converted = leadRows.find((l) => l.convertedStudentId);
  if (converted?.convertedStudentId) {
    const [s] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.tenantId, tenantId), eq(students.id, converted.convertedStudentId), isNull(students.deletedAt)));
    if (s) return { kind: 'STUDENT', leadId: converted.id, studentId: s.id };
  }
  return { kind: 'UNKNOWN', leadId: null, studentId: null };
}
