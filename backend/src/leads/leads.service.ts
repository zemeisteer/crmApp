import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, enrollments, groups, leads, students } from '../db/schema';
import { ConvertLeadDto, CreateLeadDto, QueryLeadDto, UpdateLeadDto } from './dto/lead.dto';

@Injectable()
export class LeadsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findAll(tenantId: string, query?: QueryLeadDto) {
    const conditions = [eq(leads.tenantId, tenantId)];

    if (query?.status) {
      conditions.push(eq(leads.status, query.status as any));
    }
    if (query?.source) {
      conditions.push(eq(leads.source, query.source as any));
    }
    if (query?.search) {
      const q = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(or(ilike(leads.fullName, q), ilike(leads.phone, q))!);
    }

    return this.db.query.leads.findMany({
      where: and(...conditions),
      with: {
        branch: true,
        trialGroup: true,
        convertedStudent: true,
      },
      orderBy: desc(leads.createdAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const lead = await this.db.query.leads.findFirst({
      where: and(eq(leads.id, id), eq(leads.tenantId, tenantId)),
      with: {
        branch: true,
        trialGroup: true,
        convertedStudent: true,
      },
    });
    if (!lead) {
      throw new NotFoundException('Lid topilmadi');
    }
    return lead;
  }

  async getFunnelStats(tenantId: string) {
    const all = await this.db.query.leads.findMany({
      where: eq(leads.tenantId, tenantId),
    });

    const counts = {
      NEW: 0,
      CONTACTED: 0,
      TRIAL_BOOKED: 0,
      TRIAL_ATTENDED: 0,
      QUALIFIED: 0,
      ENROLLED: 0,
      LOST: 0,
    };

    for (const l of all) {
      if (counts[l.status as keyof typeof counts] !== undefined) {
        counts[l.status as keyof typeof counts]++;
      }
    }

    const total = all.length;
    const enrolled = counts.ENROLLED;
    const conversionRate = total > 0 ? Math.round((enrolled / total) * 100) : 0;

    return {
      total,
      counts,
      conversionRate,
    };
  }

  async create(tenantId: string, dto: CreateLeadDto) {
    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) {
        throw new BadRequestException('Filial topilmadi');
      }
    }

    if (dto.trialGroupId) {
      const group = await this.db.query.groups.findFirst({
        where: and(eq(groups.id, dto.trialGroupId), eq(groups.tenantId, tenantId)),
      });
      if (!group) {
        throw new BadRequestException('Sinov darsi guruhi topilmadi');
      }
    }

    const [lead] = await this.db
      .insert(leads)
      .values({
        tenantId,
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        parentPhone: dto.parentPhone?.trim() || null,
        status: dto.status ?? 'NEW',
        source: dto.source ?? 'OTHER',
        subject: dto.subject?.trim() || null,
        branchId: dto.branchId || null,
        trialDate: dto.trialDate ? new Date(dto.trialDate) : null,
        trialGroupId: dto.trialGroupId || null,
        notes: dto.notes?.trim() || null,
      })
      .returning();

    return lead;
  }

  async update(tenantId: string, id: string, dto: UpdateLeadDto) {
    await this.findOne(tenantId, id);

    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) {
        throw new BadRequestException('Filial topilmadi');
      }
    }

    if (dto.trialGroupId) {
      const group = await this.db.query.groups.findFirst({
        where: and(eq(groups.id, dto.trialGroupId), eq(groups.tenantId, tenantId)),
      });
      if (!group) {
        throw new BadRequestException('Sinov darsi guruhi topilmadi');
      }
    }

    const [updated] = await this.db
      .update(leads)
      .set({
        ...dto,
        fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
        phone: dto.phone !== undefined ? dto.phone.trim() : undefined,
        parentPhone: dto.parentPhone !== undefined ? (dto.parentPhone ? dto.parentPhone.trim() : null) : undefined,
        subject: dto.subject !== undefined ? (dto.subject ? dto.subject.trim() : null) : undefined,
        trialDate: dto.trialDate !== undefined ? (dto.trialDate ? new Date(dto.trialDate) : null) : undefined,
        notes: dto.notes !== undefined ? (dto.notes ? dto.notes.trim() : null) : undefined,
        lostReason: dto.lostReason !== undefined ? (dto.lostReason ? dto.lostReason.trim() : null) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
      .returning();

    return updated;
  }

  async convert(tenantId: string, id: string, dto: ConvertLeadDto) {
    const lead = await this.findOne(tenantId, id);

    if (lead.convertedStudentId) {
      const existing = await this.db.query.students.findFirst({
        where: and(eq(students.id, lead.convertedStudentId), eq(students.tenantId, tenantId)),
      });
      if (existing) {
        return { student: existing, lead };
      }
    }

    // Verify all groupIds belong to tenant
    if (dto.groupIds && dto.groupIds.length > 0) {
      const validGroups = await this.db.query.groups.findMany({
        where: and(inArray(groups.id, dto.groupIds), eq(groups.tenantId, tenantId)),
      });
      if (validGroups.length !== dto.groupIds.length) {
        throw new BadRequestException('Ayrim guruhlar sizning markazingizga tegishli emas');
      }
    }

    // Create student
    const [student] = await this.db
      .insert(students)
      .values({
        tenantId,
        fullName: lead.fullName,
        phone: lead.phone,
        parentPhone: lead.parentPhone,
        gender: dto.gender || null,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        address: dto.address || null,
      })
      .returning();

    // Enroll in groups if provided
    if (dto.groupIds && dto.groupIds.length > 0) {
      await Promise.all(
        dto.groupIds.map((groupId) =>
          this.db
            .insert(enrollments)
            .values({ groupId, studentId: student.id })
            .onConflictDoNothing(),
        ),
      );
    }

    // Mark lead as ENROLLED
    const [updatedLead] = await this.db
      .update(leads)
      .set({
        status: 'ENROLLED',
        convertedStudentId: student.id,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
      .returning();

    return { student, lead: updatedLead };
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.delete(leads).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)));
    return { success: true };
  }
}
