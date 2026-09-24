import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { enrollments, invoices, students } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { CreateInvoiceDto, QueryInvoicesDto } from './dto/invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async markOverdueInvoices(tenantId: string) {
    const now = new Date();
    await this.db
      .update(invoices)
      .set({ status: 'OVERDUE', updatedAt: now })
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          lt(invoices.dueDate, now),
          inArray(invoices.status, ['OPEN', 'PARTIALLY_PAID']),
        ),
      );
  }

  async findAll(tenantId: string, query?: QueryInvoicesDto) {
    await this.markOverdueInvoices(tenantId);

    const conditions = [eq(invoices.tenantId, tenantId)];

    if (query?.studentId) {
      conditions.push(eq(invoices.studentId, query.studentId));
    }
    if (query?.forMonth) {
      conditions.push(eq(invoices.forMonth, query.forMonth));
    }
    if (query?.status) {
      conditions.push(eq(invoices.status, query.status));
    }
    if (query?.overdueOnly === 'true') {
      conditions.push(eq(invoices.status, 'OVERDUE'));
    }

    return this.db.query.invoices.findMany({
      where: and(...conditions),
      with: {
        student: true,
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

  async findOne(tenantId: string, id: string) {
    const invoice = await this.db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)),
      with: {
        student: true,
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
    });

    if (!invoice) {
      throw new NotFoundException("Hisob-faktura topilmadi");
    }

    return invoice;
  }

  async create(tenantId: string, dto: CreateInvoiceDto, userId?: string) {
    const student = await this.db.query.students.findFirst({
      where: and(
        eq(students.id, dto.studentId),
        eq(students.tenantId, tenantId),
        isNull(students.deletedAt),
      ),
    });
    if (!student) {
      throw new NotFoundException("O'quvchi topilmadi");
    }

    if (dto.enrollmentId) {
      const enrollment = await this.db.query.enrollments.findFirst({
        where: and(
          eq(enrollments.id, dto.enrollmentId),
          eq(enrollments.studentId, dto.studentId),
          eq(enrollments.tenantId, tenantId),
        ),
      });
      if (!enrollment) {
        throw new NotFoundException("Guruhga a'zolik topilmadi");
      }
    }

    const [invoice] = await this.db
      .insert(invoices)
      .values({
        tenantId,
        studentId: dto.studentId,
        enrollmentId: dto.enrollmentId || null,
        amount: dto.amount,
        amountPaid: 0,
        remainingAmount: dto.amount,
        currency: 'UZS',
        dueDate: new Date(dto.dueDate),
        forMonth: dto.forMonth,
        description: dto.description || null,
        status: 'OPEN',
      })
      .returning();

    this.audit.log({
      tenantId,
      userId: userId || null,
      action: 'create',
      entityType: 'invoice',
      entityId: invoice.id,
      meta: {
        studentId: invoice.studentId,
        amount: invoice.amount,
        forMonth: invoice.forMonth,
      },
    });

    return invoice;
  }

  async generateMonthly(tenantId: string, forMonth?: string, userId?: string) {
    const month = forMonth || new Date().toISOString().slice(0, 7);
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    // Due date: 10th of the target month
    const dueDate = new Date(Date.UTC(year, monthNum - 1, 10, 18, 0, 0));

    const activeStudents = await this.db.query.students.findMany({
      where: and(
        eq(students.tenantId, tenantId),
        eq(students.status, 'ACTIVE'),
        isNull(students.deletedAt),
      ),
      with: {
        enrollments: {
          where: eq(enrollments.status, 'ACTIVE'),
          with: {
            group: true,
          },
        },
      },
    });

    const generated: typeof invoices.$inferSelect[] = [];

    for (const student of activeStudents) {
      for (const enrollment of student.enrollments || []) {
        const group = enrollment.group;
        if (!group || group.deletedAt || (group.monthlyPrice || 0) <= 0) {
          continue;
        }

        // Check if invoice already exists for this enrollment & month
        const existing = await this.db.query.invoices.findFirst({
          where: and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.studentId, student.id),
            eq(invoices.enrollmentId, enrollment.id),
            eq(invoices.forMonth, month),
          ),
        });

        if (existing) {
          continue;
        }

        const [inv] = await this.db
          .insert(invoices)
          .values({
            tenantId,
            studentId: student.id,
            enrollmentId: enrollment.id,
            amount: group.monthlyPrice,
            amountPaid: 0,
            remainingAmount: group.monthlyPrice,
            currency: 'UZS',
            dueDate,
            forMonth: month,
            description: `${group.name} - ${month} oylik to'lov`,
            status: 'OPEN',
          })
          .returning();

        generated.push(inv);
      }
    }

    if (generated.length > 0) {
      this.audit.log({
        tenantId,
        userId: userId || null,
        action: 'create',
        entityType: 'invoices_batch',
        entityId: month,
        meta: { count: generated.length, forMonth: month },
      });
    }

    return {
      forMonth: month,
      generatedCount: generated.length,
      invoices: generated,
    };
  }

  async cancel(tenantId: string, id: string, userId?: string) {
    const invoice = await this.findOne(tenantId, id);

    if (invoice.status === 'CANCELLED') {
      return invoice;
    }

    if (invoice.amountPaid > 0 || invoice.status === 'PAID') {
      throw new BadRequestException(
        "To'lov qilingan hisob-fakturani bekor qilib bo'lmaydi. Avval to'lovni bekor qiling yoki qaytaring.",
      );
    }

    const [updated] = await this.db
      .update(invoices)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
      .returning();

    this.audit.log({
      tenantId,
      userId: userId || null,
      action: 'cancel',
      entityType: 'invoice',
      entityId: id,
      meta: { previousStatus: invoice.status },
    });

    return updated;
  }
}
