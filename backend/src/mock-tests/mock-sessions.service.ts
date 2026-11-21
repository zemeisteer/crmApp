import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { enrollments, groups, mockAttempts, mockSessions, mockTests, students, teachers } from '../db/schema';
import { SECTIONS } from './ielts';

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export interface Viewer { userId: string; role: string }

// Mock days: one published IELTS test for a whole group at a set time.
@Injectable()
export class MockSessionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // A teacher works with their own groups only; admins and managers with all.
  private async allowedGroupIds(tenantId: string, viewer: Viewer): Promise<string[] | null> {
    if (viewer.role !== 'TEACHER') return null;
    const own = await this.db.select({ id: groups.id }).from(groups)
      .innerJoin(teachers, eq(teachers.id, groups.teacherId))
      .where(and(eq(groups.tenantId, tenantId), eq(teachers.userId, viewer.userId), isNull(teachers.deletedAt)));
    return own.map((g) => g.id);
  }

  async create(tenantId: string, viewer: Viewer, dto: { testId: string; groupId: string; startsAt: string }) {
    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException("Vaqt noto'g'ri");
    const [test] = await this.db.select({ id: mockTests.id, status: mockTests.status, kind: mockTests.kind, ownerStudentId: mockTests.ownerStudentId })
      .from(mockTests).where(and(eq(mockTests.id, dto.testId), eq(mockTests.tenantId, tenantId)));
    if (!test || test.ownerStudentId) throw new NotFoundException('Test topilmadi');
    if (test.status !== 'PUBLISHED') throw new ConflictException({ code: 'NOT_PUBLISHED', message: "Avval testni e'lon qiling" });
    const [group] = await this.db.select({ id: groups.id, deletedAt: groups.deletedAt }).from(groups).where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId)));
    if (!group || group.deletedAt) throw new NotFoundException('Guruh topilmadi');
    const allowed = await this.allowedGroupIds(tenantId, viewer);
    if (allowed && !allowed.includes(group.id)) throw new ForbiddenException("Bu guruh sizniki emas");
    const [row] = await this.db.insert(mockSessions).values({ tenantId, testId: test.id, groupId: group.id, startsAt, createdBy: viewer.userId }).returning();
    return row;
  }

  async list(tenantId: string, viewer: Viewer) {
    const allowed = await this.allowedGroupIds(tenantId, viewer);
    if (allowed && allowed.length === 0) return [];
    const rows = await this.db.select({
      id: mockSessions.id, startsAt: mockSessions.startsAt, testId: mockSessions.testId, groupId: mockSessions.groupId,
      testTitle: mockTests.title, groupName: groups.name,
    }).from(mockSessions)
      .innerJoin(mockTests, eq(mockTests.id, mockSessions.testId))
      .innerJoin(groups, eq(groups.id, mockSessions.groupId))
      .where(and(eq(mockSessions.tenantId, tenantId), ...(allowed ? [inArray(mockSessions.groupId, allowed)] : [])))
      .orderBy(desc(mockSessions.startsAt)).limit(200);
    return rows;
  }

  async remove(tenantId: string, viewer: Viewer, id: string) {
    const s = await this.one(tenantId, viewer, id);
    await this.db.delete(mockSessions).where(eq(mockSessions.id, s.id));
    return { ok: true };
  }

  private async one(tenantId: string, viewer: Viewer, id: string) {
    const [s] = await this.db.select().from(mockSessions).where(and(eq(mockSessions.id, id), eq(mockSessions.tenantId, tenantId)));
    if (!s) throw new NotFoundException('Mock kuni topilmadi');
    const allowed = await this.allowedGroupIds(tenantId, viewer);
    if (allowed && !allowed.includes(s.groupId)) throw new NotFoundException('Mock kuni topilmadi');
    return s;
  }

  // The group's table: every student of the group, their sitting of the
  // test since the mock day began (or none), with a band per skill.
  async results(tenantId: string, viewer: Viewer, id: string) {
    const s = await this.one(tenantId, viewer, id);
    const [meta] = await this.db.select({ testTitle: mockTests.title, groupName: groups.name }).from(mockSessions)
      .innerJoin(mockTests, eq(mockTests.id, mockSessions.testId)).innerJoin(groups, eq(groups.id, mockSessions.groupId))
      .where(eq(mockSessions.id, s.id));
    const members = await this.db.select({ id: students.id, fullName: students.fullName }).from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.groupId, s.groupId), eq(enrollments.status, 'ACTIVE'), isNull(students.deletedAt)))
      .orderBy(students.fullName);
    const attempts = members.length === 0 ? [] : await this.db.select().from(mockAttempts)
      .where(and(eq(mockAttempts.testId, s.testId), inArray(mockAttempts.studentId, members.map((m) => m.id)), gt(mockAttempts.createdAt, new Date(s.startsAt.getTime() - 60 * 60_000))))
      .orderBy(desc(mockAttempts.createdAt));
    const rows = members.map((m) => {
      const a = attempts.find((x) => x.studentId === m.id);
      const results = parse<Record<string, { band?: number | null; status?: string } | number | null>>(a?.results, {});
      const done = parse<Record<string, string>>(a?.sectionDone, {});
      const band = (sec: string) => {
        const r = results[sec];
        return r && typeof r === 'object' ? { band: r.band ?? null, status: r.status ?? null, done: !!done[sec] } : { band: null, status: null, done: !!done[sec] };
      };
      return {
        studentId: m.id, fullName: m.fullName, attemptId: a?.id ?? null, status: a?.status ?? 'NOT_STARTED',
        sections: Object.fromEntries(SECTIONS.map((sec) => [sec, band(sec)])),
        overall: typeof results.overall === 'number' ? results.overall : null,
      };
    });
    return { id: s.id, startsAt: s.startsAt, testId: s.testId, groupId: s.groupId, ...meta, rows };
  }

  // For the student: mock days of their groups (from a week back), and
  // which tests may not be opened yet.
  async forStudent(studentId: string, tenantId: string) {
    const mine = await this.db.select({ groupId: enrollments.groupId }).from(enrollments)
      .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'ACTIVE')));
    if (mine.length === 0) return [];
    return this.db.select({ id: mockSessions.id, testId: mockSessions.testId, startsAt: mockSessions.startsAt, groupName: groups.name, testTitle: mockTests.title })
      .from(mockSessions)
      .innerJoin(groups, eq(groups.id, mockSessions.groupId))
      .innerJoin(mockTests, eq(mockTests.id, mockSessions.testId))
      .where(and(eq(mockSessions.tenantId, tenantId), inArray(mockSessions.groupId, mine.map((m) => m.groupId)), gt(mockSessions.startsAt, new Date(Date.now() - 7 * 86400_000))))
      .orderBy(mockSessions.startsAt);
  }

  // A test booked as a mock day for one of the student's groups opens at
  // its time: the nearest such time still to come, or null.
  async notYet(studentId: string, tenantId: string, testId: string): Promise<Date | null> {
    const list = await this.forStudent(studentId, tenantId);
    const now = Date.now();
    const forTest = list.filter((s) => s.testId === testId);
    // Already started for one of their groups: open.
    if (forTest.some((s) => s.startsAt.getTime() <= now)) return null;
    return forTest.find((s) => s.startsAt.getTime() > now)?.startsAt ?? null;
  }
}
