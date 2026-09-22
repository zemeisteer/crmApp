import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DB, Database } from '../db/db.module';
import { tenants, users, groups, students, teachers, payments, attendance, leads, branches, announcements } from '../db/schema';
import { CreateTenantDto, UpdateTenantDto, UpdateTenantStatusDto, PublicApplyDto } from './dto/tenant.dto';

@Injectable()
export class TenantsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Superadmin: list every tenant on the platform
  findAll() {
    return this.db.query.tenants.findMany({
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  }

  async findBySubdomain(subdomain: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
    });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');
    // Public-safe subset only
    return {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      accentColor: tenant.accentColor,
      logoUrl: tenant.logoUrl,
      category: tenant.category,
      phone: tenant.phone,
      address: tenant.address,
      email: tenant.email,
      telegramUsername: tenant.telegramUsername,
      website: tenant.website,
      websiteLabel: tenant.websiteLabel,
      plan: tenant.plan,
    };
  }

  async getPublicShowcase(subdomain: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
    });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');

    // 1. Groups / Courses (only active groups without deletedAt)
    const activeGroups = await this.db.query.groups.findMany({
      where: and(eq(groups.tenantId, tenant.id), isNull(groups.deletedAt)),
      with: {
        teacher: { columns: { id: true, fullName: true, subject: true } },
        branch: { columns: { id: true, name: true, address: true } },
      },
    });

    // 2. Teachers (active teachers without deletedAt, only safe public info)
    const activeTeachers = await this.db.query.teachers.findMany({
      where: and(eq(teachers.tenantId, tenant.id), isNull(teachers.deletedAt)),
      columns: { id: true, fullName: true, subject: true, startDate: true },
    });

    // 3. Branches
    const activeBranches = await this.db.query.branches.findMany({
      where: eq(branches.tenantId, tenant.id),
      columns: { id: true, name: true, address: true },
    });

    // 4. Announcements (targeted to ALL)
    const publicAnnouncements = await this.db.query.announcements.findMany({
      where: and(eq(announcements.tenantId, tenant.id), eq(announcements.targetAudience, 'ALL')),
      columns: { id: true, title: true, content: true, priority: true, publishedAt: true },
      orderBy: (a, { desc }) => desc(a.publishedAt),
      limit: 5,
    });

    // Extract unique subjects and course programs
    const subjectMap = new Map<string, { subject: string; courses: string[]; groupCount: number }>();
    for (const g of activeGroups) {
      const subj = g.subject || 'Umumiy';
      const entry = subjectMap.get(subj) || { subject: subj, courses: [], groupCount: 0 };
      entry.groupCount += 1;
      if (g.level && !entry.courses.includes(g.level)) {
        entry.courses.push(g.level);
      }
      subjectMap.set(subj, entry);
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        category: tenant.category,
        accentColor: tenant.accentColor,
        logoUrl: tenant.logoUrl,
        phone: tenant.phone,
        address: tenant.address,
        email: tenant.email,
        telegramUsername: tenant.telegramUsername,
        website: tenant.website,
        websiteLabel: tenant.websiteLabel,
        language: tenant.language,
      },
      stats: {
        coursesCount: activeGroups.length,
        teachersCount: activeTeachers.length,
        branchesCount: activeBranches.length,
      },
      subjects: Array.from(subjectMap.values()),
      groups: activeGroups.map((g) => ({
        id: g.id,
        name: g.name,
        subject: g.subject,
        level: g.level,
        schedule: g.schedule,
        scheduleDays: g.scheduleDays,
        startTime: g.startTime,
        monthlyPrice: g.monthlyPrice,
        teacherName: g.teacher?.fullName,
        branchName: g.branch?.name,
      })),
      teachers: activeTeachers,
      branches: activeBranches,
      announcements: publicAnnouncements,
    };
  }

  async publicApply(subdomain: string, dto: PublicApplyDto) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.subdomain, subdomain),
    });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');

    if (!dto.fullName?.trim() || !dto.phone?.trim()) {
      throw new BadRequestException("Ism va telefon raqami to'ldirilishi shart");
    }

    // If branchId is provided, verify it belongs to this tenant
    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenant.id)),
      });
      if (!branch) {
        dto.branchId = undefined;
      }
    }

    const [lead] = await this.db
      .insert(leads)
      .values({
        tenantId: tenant.id,
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        parentPhone: dto.parentPhone?.trim() || null,
        status: 'NEW',
        source: 'WEBSITE',
        subject: dto.subject?.trim() || null,
        branchId: dto.branchId || null,
        notes: dto.notes?.trim() ? `Saytdan onlayn ariza: ${dto.notes.trim()}` : "Markaz veb-saytidan onlayn ariza topshirildi",
      })
      .returning();

    return {
      success: true,
      leadId: lead.id,
      message: "Arizangiz muvaffaqiyatli qabul qilindi! Tez orada operatorlarimiz siz bilan bog'lanishadi.",
    };
  }

  async findOne(id: string) {
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, id) });
    if (!tenant) throw new NotFoundException('Mijoz topilmadi');
    return tenant;
  }

  async updateMe(tenantId: string, dto: UpdateTenantDto) {
    const [tenant] = await this.db
      .update(tenants)
      .set({ ...dto, category: dto.category as any, language: dto.language as any, currency: dto.currency as any, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    if (!tenant) throw new NotFoundException('Mijoz topilmadi');
    return tenant;
  }

  async updateLogo(tenantId: string, file: Express.Multer.File) {
    const [tenant] = await this.db
      .update(tenants)
      .set({ logoUrl: file.filename, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    if (!tenant) throw new NotFoundException('Mijoz topilmadi');
    return tenant;
  }

  async updateStatus(id: string, dto: UpdateTenantStatusDto) {
    await this.findOne(id);
    const [tenant] = await this.db
      .update(tenants)
      .set({ status: dto.status as any, plan: dto.plan as any, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    return tenant;
  }

  // Superadmin: create a tenant + its first admin user directly, without
  // that admin having to self-register.
  async createByAdmin(dto: CreateTenantDto) {
    const existingSubdomain = await this.db.query.tenants.findFirst({ where: eq(tenants.subdomain, dto.subdomain) });
    if (existingSubdomain) throw new ConflictException('Bu sub-domen band');
    const existingEmail = await this.db.query.users.findFirst({ where: eq(users.email, dto.adminEmail) });
    if (existingEmail) throw new ConflictException('Bu email allaqachon ro\'yxatdan o\'tgan');

    const [tenant] = await this.db
      .insert(tenants)
      .values({ name: dto.name, subdomain: dto.subdomain, status: 'ACTIVE', plan: 'STARTER' })
      .returning();

    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);
    const [user] = await this.db
      .insert(users)
      .values({ tenantId: tenant.id, email: dto.adminEmail, passwordHash, fullName: dto.adminFullName, role: 'ADMIN', emailVerified: true })
      .returning();

    return { tenant, admin: { id: user.id, email: user.email, fullName: user.fullName } };
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.db.delete(tenants).where(eq(tenants.id, id));
    return { success: true };
  }

  // GDPR-style self-service export: everything this tenant owns, as one
  // JSON document the admin can download and keep.
  async exportData(tenantId: string) {
    const tenant = await this.findOne(tenantId);
    const [g, s, t, p, a] = await Promise.all([
      this.db.query.groups.findMany({ where: eq(groups.tenantId, tenantId) }),
      this.db.query.students.findMany({ where: eq(students.tenantId, tenantId) }),
      this.db.query.teachers.findMany({ where: eq(teachers.tenantId, tenantId) }),
      this.db.query.payments.findMany({ where: eq(payments.tenantId, tenantId) }),
      this.db.query.attendance.findMany({ where: eq(attendance.tenantId, tenantId) }),
    ]);
    return { exportedAt: new Date().toISOString(), tenant, groups: g, students: s, teachers: t, payments: p, attendance: a };
  }

  // GDPR-style self-service deletion: an ADMIN can delete their own tenant
  // and everything in it, after confirming their password.
  async deleteMyTenant(tenantId: string, userId: string, password: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new NotFoundException();
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new BadRequestException("Parol noto'g'ri");
    await this.db.delete(tenants).where(eq(tenants.id, tenantId));
    return { success: true };
  }
}
