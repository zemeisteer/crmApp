import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { TeacherAttendanceService } from '../teacher-attendance/teacher-attendance.service';
import {
  enrollments,
  expenses,
  groups,
  payments,
  salaryPayments,
  schedules,
  teachers,
} from '../db/schema';
import { CreateSalaryPaymentDto, DisburseSalaryDto } from './dto/salary.dto';

export interface TeacherPayrollItem {
  teacherId: string;
  teacherName: string;
  phone: string | null;
  subject: string | null;
  salaryType: 'FIXED' | 'PER_LESSON' | 'PERCENTAGE' | 'PER_STUDENT';
  salaryValue: number;
  calculatedSalary: number;
  paidAmount: number;
  netPayable: number;
  isPaid: boolean;
  paidAt: Date | null;
  details: {
    type: string;
    rate: number;
    lessonCount?: number;
    groupRevenue?: number;
    studentCount?: number;
    groupCount: number;
    // Teacher attendance for the month (see TeacherAttendanceService).
    plannedLessons: number;
    absentLessons: number;
    lateLessons: number;
    substitutedLessons: number;
    // Taken off for missed lessons (non per-lesson pay).
    deduction: number;
  };
}

export interface PayrollCalculationResponse {
  forMonth: string;
  totalCalculated: number;
  totalPaid: number;
  totalPending: number;
  teacherCount: number;
  teachers: TeacherPayrollItem[];
}

@Injectable()
export class SalaryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly teacherAttendance: TeacherAttendanceService,
  ) {}

  findAll(tenantId: string, teacherId?: string) {
    const conditions = [eq(salaryPayments.tenantId, tenantId)];
    if (teacherId) conditions.push(eq(salaryPayments.teacherId, teacherId));
    return this.db.query.salaryPayments.findMany({
      where: and(...conditions),
      orderBy: (s, { desc }) => desc(s.paidAt),
    });
  }

  async create(tenantId: string, dto: CreateSalaryPaymentDto) {
    const teacher = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId)),
    });
    if (!teacher) {
      throw new BadRequestException("O'qituvchi topilmadi yoki boshqa markazga tegishli");
    }

    const [row] = await this.db
      .insert(salaryPayments)
      .values({
        tenantId,
        teacherId: dto.teacherId,
        amount: dto.amount,
        forMonth: dto.forMonth,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      })
      .onConflictDoUpdate({
        target: [salaryPayments.teacherId, salaryPayments.forMonth],
        set: { amount: dto.amount, paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date() },
      })
      .returning();
    return row;
  }

  // One teacher's line of the payroll, looked up by their login.
  async forTeacherUser(tenantId: string, userId: string, forMonth?: string) {
    const me = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.tenantId, tenantId), eq(teachers.userId, userId), isNull(teachers.deletedAt)),
      columns: { id: true },
    });
    if (!me) return null;
    const payroll = await this.calculatePayroll(tenantId, forMonth);
    return payroll.teachers.find((t) => t.teacherId === me.id) ?? null;
  }

  async calculatePayroll(tenantId: string, forMonth?: string): Promise<PayrollCalculationResponse> {
    const month = forMonth || new Date().toISOString().slice(0, 7);

    // 1. Fetch active teachers
    const activeTeachers = await this.db.query.teachers.findMany({
      where: and(eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
    });

    if (activeTeachers.length === 0) {
      return {
        forMonth: month,
        totalCalculated: 0,
        totalPaid: 0,
        totalPending: 0,
        teacherCount: 0,
        teachers: [],
      };
    }

    // 2. Fetch existing salary payments for this month
    const existingPayments = await this.db.query.salaryPayments.findMany({
      where: and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.forMonth, month)),
    });
    const paymentMap = new Map<string, typeof existingPayments[0]>();
    for (const p of existingPayments) {
      paymentMap.set(p.teacherId, p);
    }

    // 3. Fetch groups for tenant
    const tenantGroups = await this.db.query.groups.findMany({
      where: and(eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
    });

    // 4. Fetch schedules for tenant
    const tenantSchedules = await this.db.query.schedules.findMany({
      where: and(eq(schedules.tenantId, tenantId)),
    });

    // 5. Fetch all paid tuition payments in this month
    const paidPayments = await this.db.query.payments.findMany({
      where: and(
        eq(payments.tenantId, tenantId),
        eq(payments.forMonth, month),
        eq(payments.status, 'PAID'),
      ),
    });

    // 6. Fetch enrollments of this center
    const allEnrollments = await this.db.query.enrollments.findMany({ where: eq(enrollments.tenantId, tenantId) });
    const attendanceStats = await this.teacherAttendance.monthStats(tenantId, month);

    const items: TeacherPayrollItem[] = [];

    for (const teacher of activeTeachers) {
      // The teacher form stores PERCENT; older rows PERCENTAGE.
      const raw = teacher.salaryType || 'FIXED';
      const type = (raw === 'PERCENT' ? 'PERCENTAGE' : raw) as TeacherPayrollItem['salaryType'];
      const rate = teacher.salaryValue || 0;
      const teacherGroups = tenantGroups.filter((g) => g.teacherId === teacher.id);
      const teacherGroupIds = new Set(teacherGroups.map((g) => g.id));
      const att = attendanceStats.get(teacher.id) ?? { planned: 0, absent: 0, late: 0, substituted: 0 };
      let calculatedSalary = 0;
      let lessonCount = 0;
      let groupRevenue = 0;
      let studentCount = 0;
      let deduction = 0;

      if (type === 'PER_LESSON') {
        // Lessons actually taught: planned, minus missed, plus covered for others.
        lessonCount = Math.max(0, att.planned - att.absent) + att.substituted;
        calculatedSalary = lessonCount * rate;
      } else {
        let base = 0;
        if (type === 'FIXED') {
          base = rate;
        } else if (type === 'PERCENTAGE') {
          const enrolledStudentIds = new Set(
            allEnrollments.filter((e) => teacherGroupIds.has(e.groupId)).map((e) => e.studentId),
          );
          groupRevenue = paidPayments.filter((p) => enrolledStudentIds.has(p.studentId)).reduce((sum, p) => sum + p.amount, 0);
          base = Math.round(groupRevenue * (rate / 100));
        } else if (type === 'PER_STUDENT') {
          studentCount = new Set(
            allEnrollments.filter((e) => teacherGroupIds.has(e.groupId) && e.status === 'ACTIVE').map((e) => e.studentId),
          ).size;
          base = studentCount * rate;
        }
        // A missed lesson costs its share of the month's pay.
        deduction = att.planned > 0 ? Math.round((base * Math.min(att.absent, att.planned)) / att.planned) : 0;
        calculatedSalary = Math.max(0, base - deduction);
      }

      const existing = paymentMap.get(teacher.id);
      const paidAmount = existing ? existing.amount : 0;
      const isPaid = paidAmount >= calculatedSalary && calculatedSalary > 0;
      const paidAt = existing ? existing.paidAt : null;
      const netPayable = Math.max(0, calculatedSalary - paidAmount);

      items.push({
        teacherId: teacher.id,
        teacherName: teacher.fullName,
        phone: teacher.phone,
        subject: teacher.subject,
        salaryType: type,
        salaryValue: rate,
        calculatedSalary,
        paidAmount,
        netPayable,
        isPaid,
        paidAt,
        details: {
          type,
          rate,
          lessonCount: type === 'PER_LESSON' ? lessonCount : undefined,
          groupRevenue: type === 'PERCENTAGE' ? groupRevenue : undefined,
          studentCount: type === 'PER_STUDENT' ? studentCount : undefined,
          groupCount: teacherGroups.length,
          plannedLessons: att.planned,
          absentLessons: att.absent,
          lateLessons: att.late,
          substitutedLessons: att.substituted,
          deduction,
        },
      });
    }

    const totalCalculated = items.reduce((sum, i) => sum + i.calculatedSalary, 0);
    const totalPaid = items.reduce((sum, i) => sum + i.paidAmount, 0);
    const totalPending = items.reduce((sum, i) => sum + i.netPayable, 0);

    return {
      forMonth: month,
      totalCalculated,
      totalPaid,
      totalPending,
      teacherCount: items.length,
      teachers: items,
    };
  }

  async disburse(tenantId: string, dto: DisburseSalaryDto, recordedById?: string) {
    const teacher = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId)),
    });
    if (!teacher) {
      throw new NotFoundException("O'qituvchi topilmadi yoki boshqa markazga tegishli");
    }

    const paidAtDate = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const [salaryPayment] = await this.db
      .insert(salaryPayments)
      .values({
        tenantId,
        teacherId: dto.teacherId,
        amount: dto.amount,
        forMonth: dto.forMonth,
        paidAt: paidAtDate,
      })
      .onConflictDoUpdate({
        target: [salaryPayments.teacherId, salaryPayments.forMonth],
        set: { amount: dto.amount, paidAt: paidAtDate },
      })
      .returning();

    const [expense] = await this.db
      .insert(expenses)
      .values({
        tenantId,
        title: `O'qituvchi maoshi: ${teacher.fullName} (${dto.forMonth})`,
        category: 'SALARY',
        amount: dto.amount,
        paymentMethod: dto.paymentMethod || 'CASH',
        date: paidAtDate.toISOString().slice(0, 10),
        notes: dto.notes || `Oylik maosh to'lovi (${dto.forMonth})`,
        recordedById: recordedById || null,
      })
      .returning();

    return { salaryPayment, expense };
  }
}
