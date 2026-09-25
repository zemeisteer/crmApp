import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, enrollments, groups, leadTrials, students } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { countOccupiedSeats } from '../common/seats';
import { InvoicesService } from '../invoices/invoices.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { AdmissionsEventsService } from './admissions-events.service';
import { Actor, LeadsService, Tx } from './leads.service';
import { normalizePhone } from './phone';
import { ConvertLeadDto } from './dto/lead.dto';

type StudentRow = typeof students.$inferSelect;

function sameName(a: string, b: string) {
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return n(a) === n(b);
}

// Lead -> Student conversion. Everything (student, enrollments, optional
// first invoice, lead status, timeline entry) happens in ONE transaction
// holding a row lock on the lead:
//  - any failure rolls the whole conversion back, leaving no partial state;
//  - a concurrent or repeated request waits on the lock, then sees the lead
//    already ENROLLED and returns the original result (idempotent).
// Audit entries and events are written only after the commit.
@Injectable()
export class LeadConversionService {
  private readonly logger = new Logger('Admissions');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly leadsService: LeadsService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
    private readonly events: AdmissionsEventsService,
  ) {}

  // Students in the tenant whose own phone or parent phone is the same
  // number as the lead's (compared in normalized form).
  async findStudentCandidates(exec: Tx | Database, tenantId: string, phoneNormalized: string | null) {
    if (!phoneNormalized) return [];
    const tail = phoneNormalized.replace(/\D/g, '').slice(-9);
    const rows = await exec
      .select()
      .from(students)
      .where(
        and(
          eq(students.tenantId, tenantId),
          isNull(students.deletedAt),
          or(
            sql`regexp_replace(coalesce(${students.phone}, ''), '\\D', '', 'g') like ${'%' + tail}`,
            sql`regexp_replace(coalesce(${students.parentPhone}, ''), '\\D', '', 'g') like ${'%' + tail}`,
          ),
        ),
      )
      .limit(20);
    return rows
      .map((s) => ({
        student: s,
        phoneMatch: normalizePhone(s.phone) === phoneNormalized,
        parentPhoneMatch: normalizePhone(s.parentPhone) === phoneNormalized,
      }))
      .filter((c) => c.phoneMatch || c.parentPhoneMatch);
  }

  async previewStudentMatch(tenantId: string, leadId: string) {
    const lead = await this.leadsService.getLeadRow(this.db, tenantId, leadId);
    const candidates = await this.findStudentCandidates(this.db, tenantId, lead.phoneNormalized);
    return {
      candidates: candidates.map((c) => ({
        id: c.student.id,
        fullName: c.student.fullName,
        matchedOn: c.phoneMatch ? 'phone' : 'parentPhone',
        exact: c.phoneMatch && sameName(c.student.fullName, lead.fullName),
      })),
    };
  }

  async convert(tenantId: string, actor: Actor, leadId: string, dto: ConvertLeadDto) {
    const groupIds = [...new Set(dto.groupIds ?? [])];
    if (dto.createInvoice && groupIds.length === 0) {
      throw new BadRequestException("Hisob-faktura uchun kamida bitta guruh tanlanishi kerak");
    }

    const result = await this.db.transaction(async (tx) => {
      const lead = await this.leadsService.getLeadRow(tx, tenantId, leadId, { lock: true });

      if (lead.status === 'ENROLLED' && lead.convertedStudentId) {
        const [student] = await tx.select().from(students).where(and(eq(students.id, lead.convertedStudentId), eq(students.tenantId, tenantId)));
        return { alreadyConverted: true, studentCreated: false, lead, student: student ?? null, enrollments: [], invoice: null };
      }
      if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Lid arxivlangan' });
      this.leadsService.assertTransition(lead.status, 'ENROLLED');

      // ---- 1. resolve the student ----
      const resolution = dto.studentResolution ?? 'AUTO';
      let student: StudentRow | undefined;
      let studentCreated = false;

      if (resolution === 'LINK_EXISTING') {
        [student] = await tx.select().from(students).where(
          and(eq(students.id, dto.existingStudentId!), eq(students.tenantId, tenantId), isNull(students.deletedAt)),
        );
        if (!student) throw new NotFoundException("O'quvchi topilmadi");
      } else if (resolution === 'AUTO') {
        const candidates = await this.findStudentCandidates(tx, tenantId, lead.phoneNormalized);
        const exact = candidates.filter((c) => c.phoneMatch && sameName(c.student.fullName, dto.fullName ?? lead.fullName));
        if (candidates.length === 1 && exact.length === 1) {
          student = exact[0].student;
        } else if (candidates.length > 0) {
          throw new ConflictException({
            code: 'STUDENT_MATCH_AMBIGUOUS',
            message: "Bu telefon raqamiga bog'liq o'quvchi(lar) bor. Mavjud o'quvchini tanlang yoki yangi yaratishni aniq tasdiqlang.",
            candidates: candidates.map((c) => ({ id: c.student.id, fullName: c.student.fullName, matchedOn: c.phoneMatch ? 'phone' : 'parentPhone' })),
          });
        }
      }

      if (!student) {
        const branchId = dto.branchId || lead.preferredBranchId || null;
        if (branchId) {
          const [b] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)));
          if (!b) throw new NotFoundException('Filial topilmadi');
        }
        [student] = await tx.insert(students).values({
          tenantId,
          branchId,
          fullName: (dto.fullName ?? lead.fullName).trim(),
          phone: lead.phone,
          parentPhone: dto.guardianPhone?.trim() || lead.secondaryPhone || null,
          gender: dto.gender ?? null,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          address: dto.address?.trim() || null,
          status: 'ACTIVE',
        }).returning();
        studentCreated = true;
      }

      // ---- 2. enrollments (existing Enrollment model, capacity enforced) ----
      const createdEnrollments: (typeof enrollments.$inferSelect)[] = [];
      const lockedGroups: (typeof groups.$inferSelect)[] = [];
      for (const groupId of groupIds) {
        // Row lock serializes concurrent enrollments into the same group so
        // the capacity check below cannot be raced past maxStudents.
        const [group] = await tx.select().from(groups)
          .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)))
          .for('update');
        if (!group) throw new NotFoundException('Guruh topilmadi');
        if (group.status === 'ARCHIVED' || group.status === 'COMPLETED') {
          throw new BadRequestException(`"${group.name}" guruhi yopilgan`);
        }
        const [existing] = await tx.select().from(enrollments)
          .where(and(eq(enrollments.studentId, student.id), eq(enrollments.groupId, groupId)));
        if (existing?.status === 'ACTIVE') {
          throw new ConflictException({ code: 'ALREADY_ENROLLED', message: `O'quvchi "${group.name}" guruhida allaqachon faol` });
        }
        const active = await countOccupiedSeats(tx, groupId);
        if (active >= group.maxStudents) {
          throw new ConflictException({ code: 'GROUP_FULL', message: `"${group.name}" guruhida bo'sh joy yo'q (${active}/${group.maxStudents})` });
        }
        const [enrollment] = existing
          ? await tx.update(enrollments)
              .set({ tenantId, status: 'ACTIVE', joinedAt: new Date(), leftAt: null })
              .where(eq(enrollments.id, existing.id)).returning()
          : await tx.insert(enrollments)
              .values({ tenantId, studentId: student.id, groupId, status: 'ACTIVE', joinedAt: new Date() }).returning();
        createdEnrollments.push(enrollment);
        lockedGroups.push(group);
      }

      // ---- 3. optional first invoice, via the billing domain's own service ----
      let invoice: Awaited<ReturnType<InvoicesService['create']>> | null = null;
      if (dto.createInvoice) {
        const amount = dto.invoiceAmount ?? lockedGroups[0].monthlyPrice;
        if (!amount || amount <= 0) throw new BadRequestException("Hisob-faktura summasi aniqlanmadi");
        invoice = await this.invoices.create(tenantId, {
          studentId: student.id,
          enrollmentId: createdEnrollments[0].id,
          amount,
          dueDate: dto.invoiceDueDate!,
          forMonth: dto.invoiceForMonth!,
          description: `${lockedGroups[0].name} - ${dto.invoiceForMonth} (qabul)`,
        }, actor.userId ?? undefined, tx);
      }

      // ---- 4. close the lead ----
      await tx.update(leadTrials)
        .set({ status: 'CANCELLED', outcomeNote: "Lid o'quvchiga aylantirildi", updatedAt: new Date() })
        .where(and(eq(leadTrials.tenantId, tenantId), eq(leadTrials.leadId, leadId), eq(leadTrials.status, 'BOOKED')));
      const updatedLead = await this.leadsService.applyTransition(
        tx, tenantId, lead, 'ENROLLED', actor.userId,
        {
          type: 'CONVERTED',
          metadata: {
            studentId: student.id, studentCreated, resolution,
            enrollmentIds: createdEnrollments.map((e) => e.id), invoiceId: invoice?.id ?? null,
          },
        },
        { convertedStudentId: student.id, convertedAt: new Date(), followUpAt: null, followUpNotifiedAt: null },
      );

      return { alreadyConverted: false, studentCreated, lead: updatedLead, student, enrollments: createdEnrollments, invoice };
    });

    if (!result.alreadyConverted && result.student) {
      const studentId = result.student.id;
      this.audit.log({
        tenantId, userId: actor.userId, action: 'convert', entityType: 'lead', entityId: leadId,
        meta: {
          studentId, studentCreated: result.studentCreated, resolution: dto.studentResolution ?? 'AUTO',
          enrollmentIds: result.enrollments.map((e) => e.id), invoiceId: result.invoice?.id ?? null,
        },
      });
      if (result.studentCreated) {
        this.audit.log({ tenantId, userId: actor.userId, action: 'create', entityType: 'student', entityId: studentId, meta: { fromLeadId: leadId } });
        void this.webhooks.dispatch(tenantId, 'student.created', { id: studentId, fromLeadId: leadId }).catch(() => undefined);
      }
      if (result.invoice) {
        this.audit.log({
          tenantId, userId: actor.userId, action: 'create', entityType: 'invoice', entityId: result.invoice.id,
          meta: { studentId, amount: result.invoice.amount, forMonth: result.invoice.forMonth, fromLeadId: leadId },
        });
      }
      this.logger.log(JSON.stringify({ op: 'lead.convert', tenantId, leadId, studentId, actorUserId: actor.userId, studentCreated: result.studentCreated }));
      this.events.emit('LeadConverted', {
        tenantId, leadId, actorUserId: actor.userId,
        data: { studentId, studentCreated: result.studentCreated, enrollments: result.enrollments.length, invoiceId: result.invoice?.id ?? null },
      });
    }
    return result;
  }
}
