import { BadRequestException } from '@nestjs/common';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

// Building blocks for list filters that run in SQL (students, payments).
//
// The subqueries name other tables by plain SQL aliases, never by drizzle
// column objects: a relational query (db.query.x.findMany) rewrites every
// column object in its `where` to its own table's alias.

/**
 * One optional text query parameter, trimmed: undefined when absent or
 * blank. Anything but a single string (`?a=1&a=2` arrives as an array), or
 * longer than `max`, is a 400.
 */
export function queryText(value: unknown, name: string, max = 100): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${name} noto'g'ri`);
  const v = value.trim();
  if (v.length > max) throw new BadRequestException(`${name} juda uzun`);
  return v || undefined;
}

/** `%term%` for ILIKE, with %, _ and \ taken literally. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The student (`studentId`, a column of the outer query) has an enrollment,
 * of any status, in group `groupId` of this center. A group of another
 * center matches nothing. EXISTS, so a student is never counted twice.
 */
export function enrolledInGroup(studentId: SQLWrapper, tenantId: string, groupId: string): SQL {
  return sql`exists (select 1 from enrollments fe join groups fg on fg.id = fe.group_id
    where fe.student_id = ${studentId} and fe.group_id = ${groupId} and fg.tenant_id = ${tenantId})`;
}

/**
 * The student has an enrollment, of any status, in a group of this center
 * whose name or subject contains `like` (an ILIKE pattern).
 */
export function enrolledInGroupNamed(studentId: SQLWrapper, tenantId: string, like: string): SQL {
  return sql`exists (select 1 from enrollments se join groups sg on sg.id = se.group_id
    where se.student_id = ${studentId} and sg.tenant_id = ${tenantId}
      and (sg.name ilike ${like} or sg.subject ilike ${like}))`;
}

// What JavaScript's trim() removes, as far as group subjects go.
const WS = sql.raw('chr(32) || chr(9) || chr(10) || chr(13)');

/**
 * The student has an enrollment, of any status, in a group of this center
 * whose subject matches the direction `direction` - the same rule as the
 * page's matchesSubject (frontend/lib/subject.ts), case-insensitive:
 * the subject contains the direction, or the direction contains the whole
 * subject or one of its parts (subjects like "Matematika, Ingliz tili" or
 * "IELTS / CEFR" are split on , / ; | &). An empty subject matches nothing.
 */
export function enrolledInDirection(studentId: SQLWrapper, tenantId: string, direction: string): SQL {
  const target = direction.trim().toLowerCase();
  const subject = sql`lower(btrim(dg.subject, ${WS}))`;
  return sql`exists (select 1 from enrollments de join groups dg on dg.id = de.group_id
    where de.student_id = ${studentId} and dg.tenant_id = ${tenantId} and ${subject} <> ''
      and (strpos(${subject}, ${target}) > 0
        or strpos(${target}, ${subject}) > 0
        or exists (select 1 from regexp_split_to_table(${subject}, '[,/;|&]+') as part(p)
          where btrim(part.p, ${WS}) <> '' and strpos(${target}, btrim(part.p, ${WS})) > 0)))`;
}
