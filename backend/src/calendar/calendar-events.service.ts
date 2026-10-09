import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import {
  branches, enrollments, groups, makeupBookings, organizationMemberships, rooms, studentGuardians, studentPortalPins, students, teachers, tenants,
} from '../db/schema';
import { DEFAULT_TIMEZONE, zonedParts, zonedTimeToUtc } from '../common/timezone';
import { addDays, lessonOccurrences } from '../lessons/occurrences';
import type { CalEvent } from './ics';

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

    // Enrollment windows of each student: the lessons while they were in the group.
    const windows = new Map<string, { studentId: string; from: string; until: string | null }[]>();
    if (kids.length) {
      const rows = await this.db.select().from(enrollments).where(inArray(enrollments.studentId, kids.map((k) => k.id)));
      for (const e of rows) {
        const joined = e.joinedAt.toISOString().slice(0, 10);
        const left = e.leftAt ? e.leftAt.toISOString().slice(0, 10) : null;
        if (e.status !== 'ACTIVE' && !left) continue; // paused: not attending
        const list = windows.get(e.groupId) ?? [];
        list.push({ studentId: e.studentId, from: joined, until: e.status === 'ACTIVE' ? null : left });
        windows.set(e.groupId, list);
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
          if (o.date < w.from || (w.until && o.date >= w.until)) continue;
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
