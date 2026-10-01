import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, ne, notExists, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { enrollments, invoices, paymentAllocations, payments, students } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { LedgerTx, lockStudentLedger } from '../payments/allocation';
import { CreateInvoiceDto, QueryInvoicesDto } from './dto/invoice.dto';

type InvoiceExecutor = LedgerTx;

// A payment taken before the month's invoice existed is not linked to any
// invoice. When the invoice is created, such payments of the same student
// and month count towards it, so paid students don't show up as debtors.
// Call inside a transaction that holds the student's ledger lock.
export async function applyUnallocatedPayments(db: InvoiceExecutor, invoice: typeof invoices.$inferSelect) {
  if (invoice.status === 'CANCELLED' || invoice.remainingAmount <= 0) return invoice;
  const loose = await db.select({ id: payments.id, amount: payments.amount, invoiceId: payments.invoiceId })
    .from(payments)
    .where(and(
      eq(payments.tenantId, invoice.tenantId),
      eq(payments.studentId, invoice.studentId),
      eq(payments.forMonth, invoice.forMonth),
      eq(payments.status, 'PAID'),
      notExists(db.select({ x: sql`1` }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, payments.id))),
    ))
    .orderBy(asc(payments.paidAt));
  let current = invoice;
  for (const p of loose) {
    if (current.remainingAmount <= 0) break;
    const amount = Math.min(p.amount, current.remainingAmount);
    await db.insert(paymentAllocations).values({ tenantId: invoice.tenantId, paymentId: p.id, invoiceId: invoice.id, amount });
    if (!p.invoiceId) await db.update(payments).set({ invoiceId: invoice.id }).where(eq(payments.id, p.id));
    const remaining = current.remainingAmount - amount;
    const [updated] = await db.update(invoices).set({
      amountPaid: current.amountPaid + amount,
      remainingAmount: remaining,
      status: remaining === 0 ? 'PAID' : 'PARTIALLY_PAID',
      paidAt: remaining === 0 ? new Date() : current.paidAt,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoice.id)).returning();
    current = updated;
  }
  return current;
}

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

  // `tx` lets another domain (admissions conversion) create the invoice inside
  // its own transaction so a later failure rolls the invoice back too. In
  // that case the caller writes the audit entry after its commit.
  async create(tenantId: string, dto: CreateInvoiceDto, userId?: string, tx?: InvoiceExecutor): Promise<typeof invoices.$inferSelect> {
    if (!tx) {
      const settled = await this.db.transaction((own) => this.create(tenantId, dto, userId, own));
      this.audit.log({
        tenantId,
        userId: userId || null,
        action: 'create',
        entityType: 'invoice',
        entityId: settled.id,
        meta: {
          studentId: settled.studentId,
          amount: settled.amount,
          forMonth: settled.forMonth,
        },
      });
      return settled;
    }
    const db = tx;
    const student = await db.query.students.findFirst({
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
      const enrollment = await db.query.enrollments.findFirst({
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

    // A payment being taken for this student right now finishes first.
    await lockStudentLedger(db, dto.studentId);
    const [invoice] = await db
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
    return applyUnallocatedPayments(db, invoice);
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

        // One invoice per enrollment and month. Checked and inserted under
        // the student's ledger lock, so pressing "generate" twice (or two
        // people at once) cannot issue it twice, and a payment being taken
        // at the same moment is seen.
        const inv = await this.db.transaction(async (tx) => {
          await lockStudentLedger(tx, student.id);
          const existing = await tx.query.invoices.findFirst({
            where: and(
              eq(invoices.tenantId, tenantId),
              eq(invoices.studentId, student.id),
              eq(invoices.enrollmentId, enrollment.id),
              eq(invoices.forMonth, month),
            ),
            columns: { id: true },
          });
          if (existing) return null;
          const [created] = await tx
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
          return applyUnallocatedPayments(tx, created);
        });
        if (inv) generated.push(inv);
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

    // Only while still unpaid: a payment that lands between the check above
    // and this update must not end up on a cancelled invoice.
    const [updated] = await this.db
      .update(invoices)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId), eq(invoices.amountPaid, 0), ne(invoices.status, 'PAID')))
      .returning();
    if (!updated) {
      throw new BadRequestException(
        "To'lov qilingan hisob-fakturani bekor qilib bo'lmaydi. Avval to'lovni bekor qiling yoki qaytaring.",
      );
    }

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
