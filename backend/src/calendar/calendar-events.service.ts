import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import {
  branches, centerEvents, groups, makeupBookings, organizationMemberships, rooms, studentGuardians, studentPortalPins, students, teachers, tenants,
} from '../db/schema';
import { DEFAULT_TIMEZONE, zonedParts, zonedTimeToUtc } from '../common/timezone';
import { addDays, lessonOccurrences } from '../lessons/occurrences';
import type { CalEvent } from './ics';
import { staysOf } from '../enrollments/membership';

export type CalendarScope = 'TEACHER' | 'PARENT' | 'CENTER' | 'STUDENT';
export interface CalendarOwner {
  tenantId: string;
  scope: CalendarScope;
  userId?: string | null;
  studentId?: string | null;
}

const MAKEUP: Record<string, string> = { UZ: 'Qoplash darsi', RU: 'Отработка', EN: 'Make-up lesson' };
const CENTER_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT']);

/** The scope a staff/parent account's own calendar has, from its role. */
export function scopeForRole(role: string | undefined): CalendarScope | null {
  if (role === 'TEACHER') return 'TEACHER';
  if (role === 'PARENT') return 'PARENT';
  if (role && CENTER_ROLES.has(role)) return 'CENTER';
  return null;
}

/**
 * The lessons one person's calendar shows - computed from the CRM every
 * time (CRMApp is the source of truth), with minimal text: group, room,
 * teacher. No other students, nothing about money.
 *  - TEACHER: lessons they teach, make-up sessions they run;
 *  - STUDENT: the student's groups while enrolled, and their make-ups;
 *  - PARENT: the same for each linked child (child's name in front);
 *  - CENTER: every lesson and make-up session of the center.
 * Cancelled lessons and make-ups stay in, marked cancelled.
 *
 * Center events (meetings, competitions...) by their audience, decided
 * here on the server: STAFF - the office's and teachers' calendars; STUDENTS
 * - students' and parents' (and the office's); ALL - everyone's. A staff
 * meeting never reaches a cabinet's feed. A deleted event leaves every feed
 * (and so Google). An event without an end time is given its start as its
 * end: a zero-length event, what RFC 5545 makes of a DTSTART without DTEND,
 * and what Google takes - its length is never guessed.
 */
@Injectable()
export class CalendarEventsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async tenantInfo(tenantId: string) {
    const [t] = await this.db.select({ name: tenants.name, timezone: tenants.timezone, language: tenants.language, subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId));
    return t ?? null;
  }

  async today(tenantId: string) {
    const t = await this.tenantInfo(tenantId);
    const p = zonedParts(new Date(), t?.timezone || DEFAULT_TIMEZONE);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  /**
   * Whether the owner may still have this calendar: an active membership
   * with the right role (staff, parents), a teacher record (teachers), a
   * student still on the books and a feed made after the last PIN (cabinets).
   */
  async stillAllowed(owner: CalendarOwner, createdAt?: Date): Promise<boolean> {
    if (owner.scope === 'STUDENT') {
      const [row] = await this.db.select({ id: students.id, pinUpdatedAt: studentPortalPins.updatedAt }).from(students)
        .leftJoin(studentPortalPins, eq(studentPortalPins.studentId, students.id))
        .where(and(eq(students.id, owner.studentId ?? ''), eq(students.tenantId, owner.tenantId), isNull(students.deletedAt)));
      if (!row) return false;
      // A new PIN signs every cabinet out; links made by those cabinets go too.
      return !(row.pinUpdatedAt && createdAt && createdAt.getTime() < row.pinUpdatedAt.getTime());
    }
    const [m] = await this.db.select({ role: organizationMemberships.role, status: organizationMemberships.status }).from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, owner.userId ?? ''), eq(organizationMemberships.tenantId, owner.tenantId)));
    if (!m || m.status !== 'ACTIVE') return false;
    return scopeForRole(m.role) === owner.scope;
  }

  async events(owner: CalendarOwner, from: string, to: string): Promise<CalEvent[]> {
    const t = await this.tenantInfo(owner.tenantId);
    if (!t) return [];
    const tz = t.timezone || DEFAULT_TIMEZONE;
    const lang = (t.language as string) in MAKEUP ? (t.language as string) : 'UZ';
    const at = (date: string, hhmm: string) => {
      const [y, m, d] = date.split('-').map(Number);
      const [h, mi] = hhmm.split(':').map(Number);
      return zonedTimeToUtc(y, m, d, h, mi, tz);
    };

    // Which lessons, and for whom.
    let groupFilter: string[] | undefined;
    let teacherId: string | null = null;
    // studentId -> { name, windows per group }
    const kids: { id: string; name: string }[] = [];
    if (owner.scope === 'TEACHER') {
      const [tch] = await this.db.select({ id: teachers.id }).from(teachers)
        .where(and(eq(teachers.tenantId, owner.tenantId), eq(teachers.userId, owner.userId ?? ''), isNull(teachers.deletedAt)));
      if (!tch) return [];
      teacherId = tch.id;
    } else if (owner.scope === 'STUDENT') {
      const [s] = await this.db.select({ id: students.id, name: students.fullName }).from(students).where(and(eq(students.id, owner.studentId ?? ''), eq(students.tenantId, owner.tenantId)));
      if (s) kids.push(s);
    } else if (owner.scope === 'PARENT') {
      kids.push(...(await this.db.select({ id: students.id, name: students.fullName }).from(studentGuardians)
        .innerJoin(students, eq(students.id, studentGuardians.studentId))
        .where(and(eq(studentGuardians.tenantId, owner.tenantId), eq(studentGuardians.userId, owner.userId ?? ''), isNull(students.deletedAt)))));
    }

    // Each student's stays in each group (enrollments/membership.ts): the
    // lessons that started while they were in it - not those of a break
    // between two stays, of a pause, or after they left.
    const windows = new Map<string, { studentId: string; from: Date; until: Date | null }[]>();
    if (kids.length) {
      for (const s of await staysOf(this.db, owner.tenantId, { studentIds: kids.map((k) => k.id) })) {
        const list = windows.get(s.groupId) ?? [];
        list.push({ studentId: s.studentId, from: s.startedAt, until: s.endedAt });
        windows.set(s.groupId, list);
      }
      groupFilter = [...windows.keys()];
    }

    const occurrences = owner.scope === 'CENTER' || owner.scope === 'TEACHER'
      ? await lessonOccurrences(this.db, owner.tenantId, from, to)
      : await lessonOccurrences(this.db, owner.tenantId, from, to, groupFilter ?? []);
    const groupIds = [...new Set(occurrences.map((o) => o.groupId))];
    const roomIds = [...new Set(occurrences.map((o) => o.roomId).filter(Boolean) as string[])];

    // Make-ups.
    const bookingWhere = and(
      eq(makeupBookings.tenantId, owner.tenantId), gte(makeupBookings.date, from), lte(makeupBookings.date, to),
      owner.scope === 'TEACHER' ? and(eq(makeupBookings.teacherId, teacherId!), eq(makeupBookings.mode, 'SESSION'))
        : owner.scope === 'CENTER' ? eq(makeupBookings.mode, 'SESSION')
          : inArray(makeupBookings.studentId, kids.length ? kids.map((k) => k.id) : ['']),
    );
    const bookings = await this.db.select().from(makeupBookings).where(bookingWhere);
    for (const b of bookings) {
      if (b.targetGroupId) groupIds.push(b.targetGroupId);
      if (b.roomId) roomIds.push(b.roomId);
    }

    // Center events this calendar may show (see above).
    const audiences = owner.scope === 'CENTER' ? ['STAFF', 'STUDENTS', 'ALL']
      : owner.scope === 'TEACHER' ? ['STAFF', 'ALL']
        : kids.length ? ['STUDENTS', 'ALL'] : [];
    const centerEventRows = audiences.length
      ? await this.db.select().from(centerEvents).where(and(
          eq(centerEvents.tenantId, owner.tenantId), isNull(centerEvents.deletedAt),
          gte(centerEvents.date, from), lte(centerEvents.date, to), inArray(centerEvents.audience, audiences),
        ))
      : [];
    for (const e of centerEventRows) if (e.roomId) roomIds.push(e.roomId);

    const [groupRows, roomRows, teacherRows, branchRows] = await Promise.all([
      groupIds.length ? this.db.select({ id: groups.id, name: groups.name, subject: groups.subject }).from(groups).where(inArray(groups.id, [...new Set(groupIds)])) : [],
      roomIds.length ? this.db.select({ id: rooms.id, name: rooms.name }).from(rooms).where(inArray(rooms.id, [...new Set(roomIds)])) : [],
      this.db.select({ id: teachers.id, name: teachers.fullName }).from(teachers).where(eq(teachers.tenantId, owner.tenantId)),
      this.db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, owner.tenantId)),
    ]);
    const gName = new Map(groupRows.map((g) => [g.id, g.subject && !g.name.toLowerCase().includes(g.subject.toLowerCase()) ? `${g.name} (${g.subject})` : g.name]));
    const rName = new Map(roomRows.map((r) => [r.id, r.name]));
    const tName = new Map(teacherRows.map((x) => [x.id, x.name]));
    const bName = new Map(branchRows.map((x) => [x.id, x.name]));
    const place = (roomId: string | null, branchId: string | null) => [roomId && rName.get(roomId), branchId && bName.get(branchId)].filter(Boolean).join(', ') || null;
    const kidName = new Map(kids.map((k) => [k.id, k.name]));
    const prefix = (studentId: string) => (owner.scope === 'PARENT' ? `${kidName.get(studentId)}: ` : '');

    const out: CalEvent[] = [];
    for (const o of occurrences) {
      if (owner.scope === 'TEACHER' && o.teacherId !== teacherId) continue;
      const base = { start: at(o.date, o.startTime), end: at(o.date, o.endTime), location: place(o.roomId, o.branchId), description: o.teacherId ? tName.get(o.teacherId) ?? null : null, cancelled: o.cancelled, date: o.date };
      if (owner.scope === 'STUDENT' || owner.scope === 'PARENT') {
        for (const w of windows.get(o.groupId) ?? []) {
          if (base.start < w.from || (w.until && base.start >= w.until)) continue;
          out.push({ ...base, uid: owner.scope === 'PARENT' ? `${o.uid}-${w.studentId}` : o.uid, title: `${prefix(w.studentId)}${gName.get(o.groupId) ?? ''}` });
        }
      } else {
        out.push({ ...base, uid: o.uid, title: gName.get(o.groupId) ?? '' });
      }
    }
    for (const b of bookings) {
      const what = b.targetGroupId ? `${MAKEUP[lang]}: ${gName.get(b.targetGroupId) ?? ''}` : MAKEUP[lang];
      // A teacher's own session names the one student it is for; nobody else's.
      const who = owner.scope === 'TEACHER' ? ` — ${(await this.studentName(b.studentId)) ?? ''}` : '';
      out.push({
        uid: `mk-${b.id}`, date: b.date, start: at(b.date, b.startTime), end: at(b.date, b.endTime),
        title: `${prefix(b.studentId)}${what}${who}`, location: place(b.roomId, b.branchId),
        description: b.teacherId ? tName.get(b.teacherId) ?? null : null, cancelled: b.status === 'CANCELLED',
      });
    }
    for (const e of centerEventRows) {
      const start = at(e.date, e.startTime);
      const online = e.format === 'ONLINE';
      out.push({
        // One per event: the same in every feed, through every edit.
        uid: `cev-${e.id}`, date: e.date, start, end: e.endTime ? at(e.date, e.endTime) : start,
        title: e.title,
        location: online ? e.meetingUrl : [e.roomId && rName.get(e.roomId), e.location].filter(Boolean).join(', ') || null,
        description: [e.description, online && e.meetingUrl].filter(Boolean).join('\n') || null,
        cancelled: false,
      });
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.uid.localeCompare(b.uid));
  }

  private async studentName(id: string) {
    const [s] = await this.db.select({ name: students.fullName }).from(students).where(eq(students.id, id));
    return s?.name ?? null;
  }

  /** The window a calendar shows: a month back, four months ahead (center days). */
  async window(tenantId: string, back = 30, ahead = 120) {
    const today = await this.today(tenantId);
    return { from: addDays(today, -back), to: addDays(today, ahead) };
  }
}
