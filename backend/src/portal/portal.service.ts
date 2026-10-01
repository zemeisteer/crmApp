import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gt, inArray, isNull, or, sql, type AnyColumn } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { LedgerService } from '../ledger/ledger.service';
import {
  announcementReads,
  announcements,
  attendance,
  certificates,
  enrollments,
  examAttempts,
  portalLoginCodes,
  studentPortalPins,
  exams as examsTable,
  examResults,
  homework,
  homeworkCompletions,
  invoices,
  payments,
  schedules,
  studentGuardians,
  students,
  telegramLinkTokens,
  tenants,
  lessonTopics,
} from '../db/schema';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';
import { buildPastLessons } from './past-lessons';
import { BillingService } from '../billing/billing.service';
import { ExamsService } from '../exams/exams.service';
import { TelegramService } from '../telegram/telegram.service';
import { normalizePhone } from '../leads/phone';
import { createHash, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';

export type PortalViewer = 'student' | 'parent';

// Same number regardless of formatting (+998 90 123-45-67 vs 901234567).
function samePhone(a: string | null | undefined, normalized: string) {
  const x = (a ?? '').replace(/\D/g, '');
  const y = normalized.replace(/\D/g, '');
  return x.length >= 9 && (x === y || x.slice(-9) === y.slice(-9));
}

@Injectable()
export class PortalService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly billing: BillingService,
    private readonly exams: ExamsService,
    private readonly telegram: TelegramService,
    private readonly ledger: LedgerService,
  ) {}

  private async signPortalToken(student: { id: string; tenantId: string; fullName: string }, viewer: PortalViewer = 'student') {
    return this.jwt.signAsync(
      {
        sub: student.id,
        studentId: student.id,
        tenantId: student.tenantId,
        fullName: student.fullName,
        role: 'STUDENT',
        viewer,
      },
      {
        expiresIn: '30d',
      },
    );
  }

  async loginWithToken(token: string) {
    const cleanToken = token.trim().replace('link_', '');

    const record = await this.db.query.telegramLinkTokens.findFirst({
      where: and(
        eq(telegramLinkTokens.token, cleanToken),
        isNull(telegramLinkTokens.usedAt),
        gt(telegramLinkTokens.expiresAt, new Date()),
      ),
      with: {
        student: true,
        tenant: true,
      },
    });

    if (!record || !record.student || !record.tenant) {
      throw new UnauthorizedException("Havola muddati o'tgan yoki noto'g'ri");
    }

    // Mark as used
    await this.db
      .update(telegramLinkTokens)
      .set({ usedAt: new Date() })
      .where(eq(telegramLinkTokens.id, record.id));

    const accessToken = await this.signPortalToken(record.student);

    return {
      accessToken,
      student: {
        id: record.student.id,
        fullName: record.student.fullName,
        phone: record.student.phone,
      },
      tenant: {
        id: record.tenant.id,
        name: record.tenant.name,
        subdomain: record.tenant.subdomain,
        logoUrl: record.tenant.logoUrl,
        phone: record.tenant.phone,
        address: record.tenant.address,
      },
    };
  }

  // ---- Phone login, step 1: send a one-time code to the student's
  // Telegram (when linked) and say whether a center-issued PIN can be used.
  // Knowing a phone number alone never logs anyone in.

  private hashCode(phone: string, code: string) {
    return createHash('sha256').update(`${phone}:${code}:${this.config.get<string>('JWT_SECRET') ?? ''}`).digest('hex');
  }

  // Students whose own or parent phone is this number (exact match on the
  // normalized number; older records may lack the 998 prefix).
  // On a center's own subdomain (<sub>.<ROOT_DOMAIN>/portal) only that
  // center's students count; on the main site every center does.
  private async studentsByPhone(phone: string, subdomain?: string) {
    const digits = phone.replace(/\D/g, '');
    const local = digits.slice(-9);
    const clean = (col: AnyColumn) => sql`regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')`;
    const center = subdomain?.trim().toLowerCase();
    const rows = await this.db.query.students.findMany({
      where: and(
        isNull(students.deletedAt),
        or(
          sql`${clean(students.phone)} in (${digits}, ${local})`,
          sql`${clean(students.parentPhone)} in (${digits}, ${local})`,
        ),
      ),
      with: { tenant: true },
    });
    return center ? rows.filter((s) => s.tenant?.subdomain?.toLowerCase() === center) : rows;
  }

  private async pinsFor(studentIds: string[]) {
    if (studentIds.length === 0) return new Map<string, string>();
    const rows = await this.db.select().from(studentPortalPins).where(inArray(studentPortalPins.studentId, studentIds));
    return new Map(rows.map((r) => [r.studentId, r.pinHash]));
  }

  async startPhoneLogin(rawPhone: string, subdomain?: string) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new BadRequestException("Telefon raqami noto'g'ri");
    const matched = await this.studentsByPhone(phone, subdomain);
    const chats = [...new Set(matched.map((s) => s.telegramChatId).filter((c): c is string => Boolean(c)))];
    const pins = await this.pinsFor(matched.map((s) => s.id));
    const pinAvailable = pins.size > 0;
    let telegramSent = false;
    if (chats.length > 0) {
      // One live code per phone per minute; a repeat press re-uses it.
      const [recent] = await this.db.select({ id: portalLoginCodes.id }).from(portalLoginCodes)
        .where(and(eq(portalLoginCodes.phone, phone), isNull(portalLoginCodes.usedAt), gt(portalLoginCodes.createdAt, new Date(Date.now() - 60_000))));
      if (!recent) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        await this.db.insert(portalLoginCodes).values({ phone, codeHash: this.hashCode(phone, code), expiresAt: new Date(Date.now() + 5 * 60_000) });
        for (const chat of chats) {
          await this.telegram.sendMessage(chat, `🔐 Portalga kirish kodi: <b>${code}</b>\n\n5 daqiqa amal qiladi. Kodni hech kimga bermang.`);
        }
      }
      telegramSent = true;
    }
    return { telegramSent, pinAvailable };
  }

  // Step 2: check the Telegram code or the PIN. When the number belongs to
  // several students (siblings), the caller picks one from `choose`.
  async verifyPhoneLogin(rawPhone: string, body: { code?: string; pin?: string; studentId?: string; subdomain?: string }) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new BadRequestException("Telefon raqami noto'g'ri");
    const matched = await this.studentsByPhone(phone, body.subdomain);
    let allowed: typeof matched = [];
    let codeRowId: string | null = null;

    if (body.code) {
      const [row] = await this.db.select().from(portalLoginCodes)
        .where(and(eq(portalLoginCodes.phone, phone), isNull(portalLoginCodes.usedAt), gt(portalLoginCodes.expiresAt, new Date())))
        .orderBy(desc(portalLoginCodes.createdAt)).limit(1);
      if (!row || row.attempts >= 5) throw new UnauthorizedException("Kod eskirgan. Yangi kod so'rang.");
      if (row.codeHash !== this.hashCode(phone, body.code.trim())) {
        await this.db.update(portalLoginCodes).set({ attempts: row.attempts + 1 }).where(eq(portalLoginCodes.id, row.id));
        throw new UnauthorizedException("Kod noto'g'ri");
      }
      codeRowId = row.id;
      allowed = matched.filter((s) => s.telegramChatId);
    } else if (body.pin) {
      const pins = await this.pinsFor(matched.map((s) => s.id));
      for (const s of matched) {
        const hash = pins.get(s.id);
        if (hash && (await bcrypt.compare(body.pin.trim(), hash))) allowed.push(s);
      }
      if (allowed.length === 0) throw new UnauthorizedException("PIN noto'g'ri");
    } else {
      throw new BadRequestException('Kod yoki PIN kiriting');
    }

    const active = allowed.filter((s) => s.tenant);
    if (active.length === 0) throw new UnauthorizedException("Kod noto'g'ri");
    // A number that is not the student's own is the parent's.
    const viewerOf = (s: { phone: string | null }): PortalViewer => (samePhone(s.phone, phone) ? 'student' : 'parent');
    const student = body.studentId ? active.find((s) => s.id === body.studentId) : active.length === 1 ? active[0] : null;
    if (!student) {
      // Siblings: one session per child (the caller keeps them and switches
      // without signing in again). The code is used up here.
      if (codeRowId) await this.db.update(portalLoginCodes).set({ usedAt: new Date() }).where(eq(portalLoginCodes.id, codeRowId));
      const sessions = await Promise.all(active.map((s) => this.portalSession(s as typeof s & { tenant: NonNullable<typeof s.tenant> }, viewerOf(s))));
      return { choose: active.map((s) => ({ id: s.id, fullName: s.fullName, centerName: s.tenant!.name })), sessions };
    }
    if (codeRowId) await this.db.update(portalLoginCodes).set({ usedAt: new Date() }).where(eq(portalLoginCodes.id, codeRowId));
    return this.portalSession(student as typeof student & { tenant: NonNullable<typeof student.tenant> }, viewerOf(student));
  }

  // A parent's own account (role PARENT, linked as guardian): a portal
  // session for each of their children.
  async parentAccountSessions(tenantId: string, parentUserId: string) {
    const links = await this.db.query.studentGuardians.findMany({
      where: and(eq(studentGuardians.tenantId, tenantId), eq(studentGuardians.userId, parentUserId)),
      with: { student: { with: { tenant: true } } },
    });
    const kids = links.map((l) => l.student).filter((s) => s && !s.deletedAt && s.tenant);
    if (kids.length === 0) throw new NotFoundException("Sizga biriktirilgan o'quvchi topilmadi. Markaz bilan bog'laning.");
    return { sessions: await Promise.all(kids.map((s) => this.portalSession(s as typeof s & { tenant: NonNullable<typeof s.tenant> }, 'parent'))) };
  }

  private async portalSession(student: { id: string; tenantId: string; fullName: string; phone: string | null; tenant: { id: string; name: string; subdomain: string; logoUrl: string | null; phone: string | null; address: string | null } }, viewer: PortalViewer = 'student') {
    const accessToken = await this.signPortalToken(student, viewer);
    return {
      accessToken,
      viewer,
      student: { id: student.id, fullName: student.fullName, phone: student.phone },
      tenant: {
        id: student.tenant.id,
        name: student.tenant.name,
        subdomain: student.tenant.subdomain,
        logoUrl: student.tenant.logoUrl,
        phone: student.tenant.phone,
        address: student.tenant.address,
      },
    };
  }

  async getMe(studentId: string, tenantId: string) {
    const student = await this.db.query.students.findFirst({
      where: and(
        eq(students.id, studentId),
        eq(students.tenantId, tenantId),
        isNull(students.deletedAt),
      ),
      with: {
        tenant: true,
        enrollments: {
          with: {
            group: {
              with: {
                teacher: true,
                branch: true,
              },
            },
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException("O'quvchi profili topilmadi");
    }

    return student;
  }

  async getSchedule(studentId: string, tenantId: string) {
    const enrolls = await this.db.query.enrollments.findMany({
      where: eq(enrollments.studentId, studentId),
      with: {
        group: {
          with: {
            teacher: true,
            branch: true,
          },
        },
      },
    });

    const activeGroupIds = enrolls.map((e) => e.groupId);
    if (activeGroupIds.length === 0) {
      return { timetable: [], fallbackGroups: [] };
    }

    const timetable = await this.db.query.schedules.findMany({
      where: and(
        eq(schedules.tenantId, tenantId),
        inArray(schedules.groupId, activeGroupIds),
        eq(schedules.status, 'SCHEDULED'),
      ),
      with: {
        group: true,
        teacher: true,
        room: true,
      },
      orderBy: [desc(schedules.dayOfWeek), desc(schedules.startTime)],
    });

    const fallbackGroups = enrolls.map((e) => ({
      id: e.group.id,
      name: e.group.name,
      subject: e.group.subject,
      schedule: e.group.schedule,
      scheduleDays: e.group.scheduleDays,
      startTime: e.group.startTime,
      teacher: e.group.teacher?.fullName,
      branch: e.group.branch?.name,
    }));

    return { timetable, fallbackGroups };
  }

  // Past lessons of the student's groups over the last `days` days, each with
  // the student's attendance mark, homework given that day and results of
  // tests/exams held that day. Dates are the center's local calendar days.
  async getPastLessons(studentId: string, tenantId: string, days = 30) {
    const span = Math.min(90, Math.max(1, Math.floor(days) || 30));
    const [tenant] = await this.db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const tz = isValidTimeZone(tenant?.timezone) ? tenant!.timezone : DEFAULT_TIMEZONE;
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDate = (d: Date) => { const p = zonedParts(d, tz); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
    const now = new Date();
    const today = localDate(now);
    const fromInstant = new Date(now.getTime() - span * 86_400_000);
    const from = localDate(fromInstant);

    const enrolls = await this.db.query.enrollments.findMany({
      where: and(eq(enrollments.studentId, studentId), or(eq(enrollments.tenantId, tenantId), isNull(enrollments.tenantId))),
      with: { group: { with: { teacher: true } } },
    });
    const own = enrolls.filter((e) => e.group && e.group.tenantId === tenantId && !e.group.deletedAt);
    if (own.length === 0) return { from, today, lessons: [] };
    const groupIds = own.map((e) => e.groupId);
    // Look one day further back so a timezone shift never drops the first day.
    const since = new Date(fromInstant.getTime() - 86_400_000);

    const [slots, marks, hw, examRows, topicRows] = await Promise.all([
      this.db.select({
        groupId: schedules.groupId, dayOfWeek: schedules.dayOfWeek, date: schedules.date,
        startTime: schedules.startTime, endTime: schedules.endTime, topic: schedules.topic, status: schedules.status,
      }).from(schedules).where(and(eq(schedules.tenantId, tenantId), inArray(schedules.groupId, groupIds))),
      this.db.select({ groupId: attendance.groupId, date: attendance.date, status: attendance.status }).from(attendance)
        .where(and(eq(attendance.tenantId, tenantId), eq(attendance.studentId, studentId), inArray(attendance.groupId, groupIds), sql`${attendance.date} >= ${from}`)),
      this.db.query.homework.findMany({
        where: and(eq(homework.tenantId, tenantId), inArray(homework.groupId, groupIds), gt(homework.createdAt, since)),
        with: { completions: { where: eq(homeworkCompletions.studentId, studentId) } },
      }),
      this.db.query.exams.findMany({
        where: and(eq(examsTable.tenantId, tenantId), inArray(examsTable.groupId, groupIds), gt(examsTable.examDate, since)),
      }),
      this.db.select({ groupId: lessonTopics.groupId, date: lessonTopics.date, topic: lessonTopics.topic }).from(lessonTopics)
        .where(and(eq(lessonTopics.tenantId, tenantId), inArray(lessonTopics.groupId, groupIds), sql`${lessonTopics.date} >= ${from}`)),
    ]);
    const examIds = examRows.map((e) => e.id);
    const [results, attempts] = examIds.length === 0 ? [[], []] : await Promise.all([
      this.db.select({ examId: examResults.examId, score: examResults.score }).from(examResults)
        .where(and(eq(examResults.studentId, studentId), inArray(examResults.examId, examIds))),
      this.db.select({ examId: examAttempts.examId, score: examAttempts.score, completedAt: examAttempts.completedAt }).from(examAttempts)
        .where(and(eq(examAttempts.tenantId, tenantId), eq(examAttempts.studentId, studentId), inArray(examAttempts.examId, examIds))),
    ]);
    // A teacher-entered result wins; otherwise the best finished online attempt.
    const scoreOf = (examId: string) => {
      const r = results.find((x) => x.examId === examId);
      if (r) return r.score;
      const done = attempts.filter((a) => a.examId === examId && a.completedAt);
      return done.length ? Math.max(...done.map((a) => a.score)) : null;
    };

    const lessons = buildPastLessons({
      from,
      today,
      groups: own.map((e) => ({
        id: e.group.id,
        name: e.group.name,
        subject: e.group.subject,
        scheduleDays: e.group.scheduleDays,
        startTime: e.group.startTime,
        endTime: e.group.endTime ?? null,
        teacher: e.group.teacher?.fullName ?? null,
        joinedOn: localDate(e.joinedAt),
        leftOn: e.leftAt ? localDate(e.leftAt) : null,
      })),
      slots,
      attendance: marks,
      topics: topicRows,
      homework: hw.map((h) => {
        const c = h.completions[0];
        return {
          id: h.id, groupId: h.groupId, givenOn: localDate(h.createdAt), title: h.title, description: h.description,
          dueDate: h.dueDate, attachmentPath: h.attachmentPath, attachmentName: h.attachmentName,
          status: c ? (c.completed && c.status === 'PENDING' ? 'SUBMITTED' : c.status) : null, score: c?.score ?? null, maxScore: h.maxScore,
          feedback: c?.feedback ?? null,
        };
      }),
      exams: examRows.filter((e) => e.examDate).map((e) => ({
        id: e.id, groupId: e.groupId, heldOn: localDate(e.examDate!), title: e.title,
        maxScore: e.maxScore, passingScore: e.passingScore, score: scoreOf(e.id),
      })),
    });
    return { from, today, lessons };
  }

  async getAttendance(studentId: string, tenantId: string) {
    const rows = await this.db.query.attendance.findMany({
      where: and(eq(attendance.studentId, studentId), eq(attendance.tenantId, tenantId)),
      with: { group: { columns: { id: true, name: true, subject: true } } },
      orderBy: [desc(attendance.date), desc(attendance.createdAt)],
      // About a school year of lessons, enough for the month calendar.
      limit: 250,
    });
    const records = rows.map(({ group, ...r }) => ({ ...r, groupName: group?.name ?? null, subject: group?.subject ?? null }));

    const tally = (list: typeof records) => {
      const total = list.length;
      const present = list.filter((r) => r.status === 'PRESENT').length;
      const absent = list.filter((r) => r.status === 'ABSENT').length;
      const late = list.filter((r) => r.status === 'LATE').length;
      const rate = total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 100;
      return { rate, total, present, absent, late };
    };

    // Per group, for students in several directions.
    const byGroupMap = new Map<string, typeof records>();
    for (const r of records) byGroupMap.set(r.groupId, [...(byGroupMap.get(r.groupId) ?? []), r]);
    const byGroup = [...byGroupMap.entries()]
      .map(([groupId, list]) => ({ groupId, groupName: list[0].groupName, subject: list[0].subject, lastDate: list[0].date, ...tally(list) }))
      .sort((a, b) => b.total - a.total);

    // Lessons attended in a row, counting back from the latest one.
    let streak = 0;
    for (const r of records) {
      if (r.status === 'ABSENT') break;
      streak++;
    }

    return { ...tally(records), streak, byGroup, records };
  }


  async getHomework(studentId: string, tenantId: string) {
    const enrolls = await this.db.query.enrollments.findMany({
      where: eq(enrollments.studentId, studentId),
    });
    const groupIds = enrolls.map((e) => e.groupId);
    if (groupIds.length === 0) return [];

    const hwList = await this.db.query.homework.findMany({
      where: and(eq(homework.tenantId, tenantId), inArray(homework.groupId, groupIds)),
      with: {
        group: true,
        completions: {
          where: eq(homeworkCompletions.studentId, studentId),
        },
      },
      orderBy: [desc(homework.createdAt)],
      limit: 30,
    });

    return hwList.map((h) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      dueDate: h.dueDate,
      groupName: h.group?.name,
      completed: h.completions.some((c) => c.completed),
      completedAt: h.completions[0]?.updatedAt,
      attachmentPath: h.attachmentPath,
      attachmentName: h.attachmentName,
      maxScore: h.maxScore,
      submission: h.completions[0]
        ? {
            status: h.completions[0].status,
            text: h.completions[0].submissionText,
            file: h.completions[0].submissionAttachmentUrl,
            submittedAt: h.completions[0].submittedAt,
            score: h.completions[0].score,
            feedback: h.completions[0].feedback,
          }
        : null,
    }));
  }

  async submitHomework(studentId: string, tenantId: string, homeworkId: string, body: { text?: string; fileName?: string } = {}) {
    const hw = await this.db.query.homework.findFirst({
      where: and(eq(homework.id, homeworkId), eq(homework.tenantId, tenantId)),
    });
    if (!hw) throw new NotFoundException('Vazifa topilmadi');
    // Only homework of the student's own groups.
    const [member] = await this.db.select({ id: enrollments.id }).from(enrollments)
      .where(and(eq(enrollments.studentId, studentId), eq(enrollments.groupId, hw.groupId)));
    if (!member) throw new NotFoundException('Vazifa topilmadi');

    const text = body.text?.trim().slice(0, 5000) || null;
    const now = new Date();
    // A new submission replaces the text and, when a file came, the file;
    // an earlier photo stays if only text is sent again.
    const values = {
      completed: true,
      status: 'SUBMITTED',
      submittedAt: now,
      updatedAt: now,
      ...(text !== null ? { submissionText: text } : {}),
      ...(body.fileName ? { submissionAttachmentUrl: body.fileName } : {}),
    };
    const [record] = await this.db
      .insert(homeworkCompletions)
      .values({ homeworkId, studentId, ...values })
      .onConflictDoUpdate({ target: [homeworkCompletions.homeworkId, homeworkCompletions.studentId], set: values })
      .returning();
    return { success: true, record };
  }

  async getExams(studentId: string, tenantId: string) {
    const attempts = await this.db.query.examAttempts.findMany({
      where: and(eq(examAttempts.studentId, studentId), eq(examAttempts.tenantId, tenantId)),
      with: {
        exam: true,
      },
      orderBy: [desc(examAttempts.createdAt)],
    });

    const results = await this.db.query.examResults.findMany({
      where: eq(examResults.studentId, studentId),
      with: {
        exam: true,
      },
      orderBy: [desc(examResults.createdAt)],
    });

    const certs = await this.db.query.certificates.findMany({
      where: and(eq(certificates.studentId, studentId), eq(certificates.tenantId, tenantId)),
      orderBy: [desc(certificates.issueDate)],
    });

    return {
      attempts: attempts.map((a) => ({
        id: a.id,
        examTitle: a.exam?.title,
        score: a.score,
        maxScore: a.maxScore,
        passed: a.passed,
        date: a.createdAt,
      })),
      results: results.map((r) => ({
        id: r.id,
        examTitle: r.exam?.title,
        score: r.score,
        note: r.note,
        date: r.createdAt,
      })),
      certificates: certs.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        grade: c.grade,
        issueDate: c.issueDate,
        verifyUrl: `/verify/${c.code}`,
      })),
    };
  }

  async getPayments(studentId: string, tenantId: string) {
    // The same figures the center sees on its payments page.
    const currentMonth = await this.ledger.currentMonth(tenantId);
    const ledger = await this.ledger.load(tenantId, [currentMonth], { studentId });
    const me = ledger.students[0];
    const due = me ? ledger.due(me, currentMonth) : { expected: 0, discount: 0, paid: 0, debt: 0 };

    const history = await this.db.query.payments.findMany({
      where: and(eq(payments.studentId, studentId), eq(payments.tenantId, tenantId)),
      columns: { idempotencyKey: false, requestHash: false },
      orderBy: [desc(payments.paidAt), desc(payments.createdAt)],
    });

    const expectedTuition = due.expected;
    const monthPaid = due.paid;
    const effectiveExpected = Math.max(0, due.expected - due.discount);
    const debtAmount = due.debt;

    return {
      forMonth: currentMonth,
      expectedTuition,
      monthPaid,
      debtAmount,
      status: effectiveExpected === 0 || debtAmount === 0 ? 'PAID' : monthPaid > 0 ? 'PARTIAL' : 'UNPAID',
      history,
      // Only configured providers get a "pay online" button.
      online: { click: this.billing.getConfig().clickEnabled, payme: this.billing.getConfig().paymeEnabled },
    };
  }

  async getInvoices(studentId: string, tenantId: string) {
    return this.db.query.invoices.findMany({
      where: and(
        eq(invoices.studentId, studentId),
        eq(invoices.tenantId, tenantId),
      ),
      with: {
        enrollment: {
          with: {
            group: true,
          },
        },
        allocations: {
          with: {
            payment: true,
          },
        },
      },
      orderBy: [desc(invoices.createdAt)],
    });
  }

  async createCheckoutLink(
    studentId: string,
    tenantId: string,
    body: { provider: 'CLICK' | 'PAYME'; amount?: number; forMonth?: string; invoiceId?: string },
  ) {
    let currentMonth = body.forMonth || new Date().toISOString().slice(0, 7);
    let amount = body.amount;

    if (body.invoiceId) {
      const inv = await this.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, body.invoiceId),
          eq(invoices.tenantId, tenantId),
          eq(invoices.studentId, studentId),
        ),
      });
      if (!inv) {
        throw new NotFoundException('Hisob-faktura topilmadi');
      }
      if (inv.status === 'CANCELLED') {
        throw new BadRequestException("Bekor qilingan hisob-faktura uchun to'lov qabul qilib bo'lmaydi");
      }
      if (inv.remainingAmount <= 0) {
        throw new BadRequestException("Ushbu hisob-faktura to'liq to'langan");
      }
      amount = amount && amount > 0 ? Math.min(amount, inv.remainingAmount) : inv.remainingAmount;
      currentMonth = inv.forMonth;
    } else if (!amount || amount <= 0) {
      const summary = await this.getPayments(studentId, tenantId);
      amount = summary.debtAmount;
      if (amount <= 0) {
        throw new BadRequestException("To'lanishi kerak bo'lgan qarzdorlik mavjud emas");
      }
    }

    if (body.provider === 'CLICK') {
      return this.billing.generateClickLink(tenantId, {
        studentId,
        invoiceId: body.invoiceId,
        amount,
        forMonth: currentMonth,
      });
    } else {
      return this.billing.generatePaymeLink(tenantId, {
        studentId,
        invoiceId: body.invoiceId,
        amount,
        forMonth: currentMonth,
      });
    }
  }

  // Announcements for the student (everyone's and their groups', never the
  // teachers-only ones), newest first, each with its read state.
  private async announcementsFor(studentId: string, tenantId: string) {
    const enrolls = await this.db.query.enrollments.findMany({
      where: eq(enrollments.studentId, studentId),
    });
    const groupIds = enrolls.map((e) => e.groupId);
    return this.db.query.announcements.findMany({
      where: and(
        eq(announcements.tenantId, tenantId),
        sql`${announcements.targetAudience} <> 'TEACHERS'`,
        or(
          isNull(announcements.targetGroupId),
          groupIds.length > 0 ? inArray(announcements.targetGroupId, groupIds) : undefined,
        ),
      ),
      orderBy: [desc(announcements.createdAt)],
      limit: 30,
    });
  }

  async getAnnouncements(studentId: string, tenantId: string) {
    const list = await this.announcementsFor(studentId, tenantId);
    const read = list.length === 0 ? [] : await this.db.select({ id: announcementReads.announcementId }).from(announcementReads)
      .where(and(eq(announcementReads.studentId, studentId), inArray(announcementReads.announcementId, list.map((a) => a.id))));
    const readIds = new Set(read.map((r) => r.id));
    return list.map((a) => ({ ...a, read: readIds.has(a.id) }));
  }

  // Marks one announcement (id) or all of the student's (no id) as read.
  async markAnnouncementsRead(studentId: string, tenantId: string, id?: string) {
    const list = await this.announcementsFor(studentId, tenantId);
    const ids = id ? list.filter((a) => a.id === id).map((a) => a.id) : list.map((a) => a.id);
    if (id && ids.length === 0) throw new NotFoundException("E'lon topilmadi");
    if (ids.length > 0) {
      await this.db.insert(announcementReads)
        .values(ids.map((announcementId) => ({ announcementId, studentId })))
        .onConflictDoNothing();
    }
    return { marked: ids.length, unread: 0 };
  }


  // ==================== PARENT PORTAL ====================

  async getParentStudents(tenantId: string, parentUserId: string) {
    const links = await this.db.query.studentGuardians.findMany({
      where: and(
        eq(studentGuardians.tenantId, tenantId),
        eq(studentGuardians.userId, parentUserId),
      ),
      with: {
        student: {
          with: {
            enrollments: {
              with: {
                group: {
                  with: {
                    teacher: true,
                    branch: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return links
      .filter((l) => l.student && !l.student.deletedAt)
      .map((l) => ({
        guardianshipId: l.id,
        relationship: l.relationship,
        isPrimary: l.isPrimary,
        ...l.student,
      }));
  }

  async verifyParentAccess(tenantId: string, parentUserId: string, studentId: string) {
    const link = await this.db.query.studentGuardians.findFirst({
      where: and(
        eq(studentGuardians.tenantId, tenantId),
        eq(studentGuardians.userId, parentUserId),
        eq(studentGuardians.studentId, studentId),
      ),
      with: {
        student: true,
      },
    });

    if (!link || !link.student || link.student.deletedAt) {
      throw new ForbiddenException("Siz faqat o'zingizga biriktirilgan farzandingiz ma'lumotlarini ko'rishingiz mumkin");
    }

    return link;
  }

  async getParentStudentOverview(tenantId: string, parentUserId: string, studentId: string) {
    await this.verifyParentAccess(tenantId, parentUserId, studentId);
    const student = await this.getMe(studentId, tenantId);
    const schedule = await this.getSchedule(studentId, tenantId);
    const attendance = await this.getAttendance(studentId, tenantId);
    const payments = await this.getPayments(studentId, tenantId);
    return {
      student,
      schedule,
      attendance,
      payments,
    };
  }

  async getParentStudentSchedule(tenantId: string, parentUserId: string, studentId: string) {
    await this.verifyParentAccess(tenantId, parentUserId, studentId);
    return this.getSchedule(studentId, tenantId);
  }

  async getParentStudentAttendance(tenantId: string, parentUserId: string, studentId: string) {
    await this.verifyParentAccess(tenantId, parentUserId, studentId);
    return this.getAttendance(studentId, tenantId);
  }

  async getParentStudentPayments(tenantId: string, parentUserId: string, studentId: string) {
    await this.verifyParentAccess(tenantId, parentUserId, studentId);
    return this.getPayments(studentId, tenantId);
  }

  async getParentStudentInvoices(tenantId: string, parentUserId: string, studentId: string) {
    await this.verifyParentAccess(tenantId, parentUserId, studentId);
    return this.getInvoices(studentId, tenantId);
  }

  async createParentCheckoutLink(
    tenantId: string,
    parentUserId: string,
    studentId: string,
    body: { provider: 'CLICK' | 'PAYME'; amount?: number; forMonth?: string; invoiceId?: string },
  ) {
    await this.verifyParentAccess(tenantId, parentUserId, studentId);
    return this.createCheckoutLink(studentId, tenantId, body);
  }

  // ---- Online exams taken by the student on their own device ----

  // Exams of the student's active groups that have questions, with whether
  // the student already took them (one attempt each).
  async getAvailableExams(studentId: string, tenantId: string) {
    const groupIds = (await this.db.select({ groupId: enrollments.groupId }).from(enrollments)
      .where(and(eq(enrollments.studentId, studentId), eq(enrollments.status, 'ACTIVE')))).map((r) => r.groupId);
    if (groupIds.length === 0) return [];
    const list = await this.db.query.exams.findMany({
      where: and(eq(examsTable.tenantId, tenantId), inArray(examsTable.groupId, groupIds)),
      with: { questions: { columns: { id: true } }, group: { columns: { name: true } } },
      orderBy: [desc(examsTable.createdAt)],
    });
    const done = await this.db.select({ examId: examAttempts.examId, score: examAttempts.score, maxScore: examAttempts.maxScore })
      .from(examAttempts).where(and(eq(examAttempts.studentId, studentId), eq(examAttempts.tenantId, tenantId)));
    return list
      .filter((e) => (e.questions?.length ?? 0) > 0)
      .map((e) => {
        const attempt = done.find((d) => d.examId === e.id);
        return {
          id: e.id,
          title: e.title,
          groupName: e.group?.name ?? null,
          questionCount: e.questions.length,
          durationMinutes: e.durationMinutes,
          examDate: e.examDate,
          taken: Boolean(attempt),
          score: attempt?.score ?? null,
          maxScore: attempt?.maxScore ?? e.maxScore,
        };
      });
  }

  private async assertCanTake(studentId: string, tenantId: string, examId: string) {
    const available = await this.getAvailableExams(studentId, tenantId);
    const exam = available.find((e) => e.id === examId);
    if (!exam) throw new NotFoundException('Imtihon topilmadi');
    if (exam.taken) throw new BadRequestException('Siz bu imtihonni topshirgansiz');
  }

  async startExam(studentId: string, tenantId: string, examId: string) {
    await this.assertCanTake(studentId, tenantId, examId);
    return this.exams.startAttempt(tenantId, examId, studentId);
  }

  async submitExam(studentId: string, tenantId: string, examId: string, answers: Record<string, string>) {
    await this.assertCanTake(studentId, tenantId, examId);
    return this.exams.submitAttempt(tenantId, examId, { studentId, answers });
  }
}
