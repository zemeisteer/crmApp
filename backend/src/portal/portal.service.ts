import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import {
  announcements,
  attendance,
  certificates,
  enrollments,
  examAttempts,
  examResults,
  homework,
  homeworkCompletions,
  payments,
  schedules,
  students,
  telegramLinkTokens,
} from '../db/schema';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class PortalService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly billing: BillingService,
  ) {}

  private async signPortalToken(student: { id: string; tenantId: string; fullName: string }) {
    return this.jwt.signAsync(
      {
        sub: student.id,
        studentId: student.id,
        tenantId: student.tenantId,
        fullName: student.fullName,
        role: 'STUDENT',
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

  async loginWithPhone(phone: string, studentCode?: string) {
    const rawDigits = phone.replace(/\D/g, '');
    if (rawDigits.length < 9) {
      throw new BadRequestException("Telefon raqami noto'g'ri");
    }

    const matchedStudents = await this.db.query.students.findMany({
      where: isNull(students.deletedAt),
      with: {
        tenant: true,
      },
    });

    // Find student whose phone ends with rawDigits
    const student = matchedStudents.find((s) => {
      const sDigits = (s.phone || '').replace(/\D/g, '');
      const pDigits = (s.parentPhone || '').replace(/\D/g, '');
      const phoneMatch = sDigits.endsWith(rawDigits) || pDigits.endsWith(rawDigits);
      if (!phoneMatch) return false;
      if (studentCode) {
        return s.id === studentCode || s.id.slice(-4) === studentCode;
      }
      return true;
    });

    if (!student || !student.tenant) {
      throw new NotFoundException("Ushbu telefon raqamiga biriktirilgan o'quvchi topilmadi");
    }

    const accessToken = await this.signPortalToken(student);

    return {
      accessToken,
      student: {
        id: student.id,
        fullName: student.fullName,
        phone: student.phone,
      },
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

  async loginWithTelegram(chatId: string) {
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.telegramChatId, chatId), isNull(students.deletedAt)),
      with: {
        tenant: true,
      },
    });

    if (!student || !student.tenant) {
      throw new NotFoundException("Telegram orqali ulangan o'quvchi topilmadi");
    }

    const accessToken = await this.signPortalToken(student);

    return {
      accessToken,
      student: {
        id: student.id,
        fullName: student.fullName,
        phone: student.phone,
      },
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

  async getAttendance(studentId: string, tenantId: string) {
    const records = await this.db.query.attendance.findMany({
      where: and(eq(attendance.studentId, studentId), eq(attendance.tenantId, tenantId)),
      orderBy: [desc(attendance.date), desc(attendance.createdAt)],
      limit: 60,
    });

    const total = records.length;
    const present = records.filter((r) => r.status === 'PRESENT').length;
    const absent = records.filter((r) => r.status === 'ABSENT').length;
    const late = records.filter((r) => r.status === 'LATE').length;
    const rate = total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 100;

    return {
      rate,
      total,
      present,
      absent,
      late,
      records,
    };
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
    }));
  }

  async submitHomework(studentId: string, tenantId: string, homeworkId: string) {
    const hw = await this.db.query.homework.findFirst({
      where: and(eq(homework.id, homeworkId), eq(homework.tenantId, tenantId)),
    });
    if (!hw) throw new NotFoundException('Vazifa topilmadi');

    // Upsert completion
    const existing = await this.db.query.homeworkCompletions.findFirst({
      where: and(
        eq(homeworkCompletions.homeworkId, homeworkId),
        eq(homeworkCompletions.studentId, studentId),
      ),
    });

    if (existing) {
      const [updated] = await this.db
        .update(homeworkCompletions)
        .set({ completed: true, updatedAt: new Date() })
        .where(eq(homeworkCompletions.id, existing.id))
        .returning();
      return { success: true, record: updated };
    }

    const [created] = await this.db
      .insert(homeworkCompletions)
      .values({
        homeworkId,
        studentId,
        completed: true,
      })
      .returning();

    return { success: true, record: created };
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
    const currentMonth = new Date().toISOString().slice(0, 7);

    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
      with: {
        enrollments: {
          with: {
            group: true,
          },
        },
      },
    });

    const history = await this.db.query.payments.findMany({
      where: and(eq(payments.studentId, studentId), eq(payments.tenantId, tenantId)),
      orderBy: [desc(payments.paidAt), desc(payments.createdAt)],
    });

    const activeGroups = (student?.enrollments || [])
      .map((e) => e.group)
      .filter((g): g is NonNullable<typeof g> => Boolean(g && !g.deletedAt));

    const expectedTuition = activeGroups.reduce((sum, g) => sum + (g.monthlyPrice || 0), 0);
    const monthPayments = history.filter((p) => p.forMonth === currentMonth && p.status === 'PAID');
    const monthPaid = monthPayments.reduce((sum, p) => sum + p.amount, 0);
    const monthDiscount = monthPayments.reduce((sum, p) => sum + (p.discount || 0), 0);
    const effectiveExpected = Math.max(0, expectedTuition - monthDiscount);
    const debtAmount = Math.max(0, effectiveExpected - monthPaid);

    return {
      forMonth: currentMonth,
      expectedTuition,
      monthPaid,
      debtAmount,
      status: effectiveExpected === 0 || debtAmount === 0 ? 'PAID' : monthPaid > 0 ? 'PARTIAL' : 'UNPAID',
      history,
    };
  }

  async createCheckoutLink(
    studentId: string,
    tenantId: string,
    body: { provider: 'CLICK' | 'PAYME'; amount?: number; forMonth?: string },
  ) {
    const currentMonth = body.forMonth || new Date().toISOString().slice(0, 7);
    let amount = body.amount;

    if (!amount || amount <= 0) {
      const summary = await this.getPayments(studentId, tenantId);
      amount = summary.debtAmount;
      if (amount <= 0) {
        throw new BadRequestException("To'lanishi kerak bo'lgan qarzdorlik mavjud emas");
      }
    }

    if (body.provider === 'CLICK') {
      return this.billing.generateClickLink(tenantId, {
        studentId,
        amount,
        forMonth: currentMonth,
      });
    } else {
      return this.billing.generatePaymeLink(tenantId, {
        studentId,
        amount,
        forMonth: currentMonth,
      });
    }
  }

  async getAnnouncements(studentId: string, tenantId: string) {
    const enrolls = await this.db.query.enrollments.findMany({
      where: eq(enrollments.studentId, studentId),
    });
    const groupIds = enrolls.map((e) => e.groupId);

    const list = await this.db.query.announcements.findMany({
      where: and(
        eq(announcements.tenantId, tenantId),
        or(
          isNull(announcements.targetGroupId),
          groupIds.length > 0 ? inArray(announcements.targetGroupId, groupIds) : undefined,
        ),
      ),
      orderBy: [desc(announcements.createdAt)],
      limit: 15,
    });

    return list;
  }
}
