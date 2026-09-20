import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DB, Database } from '../db/db.module';
import { tenants, users, groups, students, teachers, payments, attendance } from '../db/schema';
import { CreateTenantDto, UpdateTenantDto, UpdateTenantStatusDto } from './dto/tenant.dto';

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
      plan: tenant.plan,
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
