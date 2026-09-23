import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, ne } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import {
  branches,
  courses,
  invitations,
  organizationMemberships,
  students,
  subjects,
  tenants,
  users,
} from '../db/schema';
import {
  BranchStepDto,
  CategoriesStepDto,
  ProfileStepDto,
  WorkspaceStepDto,
} from './dto/onboarding.dto';

const RESERVED_SUBDOMAINS = new Set([
  'admin',
  'api',
  'app',
  'crmapp',
  'crm',
  'mail',
  'portal',
  'superadmin',
  'dashboard',
  'test',
  'dev',
  'stage',
  'billing',
  'support',
  'help',
  'auth',
  'login',
  'register',
  'static',
  'assets',
  'public',
  'webhook',
  'webhooks',
  'sys',
  'root',
  'internal',
  'status',
  'docs',
  'blog',
  'demo',
]);

const STEP_TRANSITIONS: Record<string, string> = {
  PROFILE: 'CATEGORIES',
  CATEGORIES: 'SUBJECTS',
  SUBJECTS: 'COURSES',
  COURSES: 'WORKSPACE',
  WORKSPACE: 'BRANCH',
  BRANCH: 'TEAM',
  TEAM: 'STUDENTS',
  STUDENTS: 'COMPLETED',
};

@Injectable()
export class OnboardingService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getState(tenantId: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant) throw new NotFoundException('Markaz topilmadi');

    const [subjectCount] = await this.db
      .select({ val: count() })
      .from(subjects)
      .where(eq(subjects.tenantId, tenantId));

    const [branchCount] = await this.db
      .select({ val: count() })
      .from(branches)
      .where(eq(branches.tenantId, tenantId));

    const [teamCount] = await this.db
      .select({ val: count() })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.tenantId, tenantId),
          eq(organizationMemberships.status, 'ACTIVE'),
        ),
      );

    const [studentCount] = await this.db
      .select({ val: count() })
      .from(students)
      .where(eq(students.tenantId, tenantId));

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        phone: tenant.phone,
        country: tenant.country || 'UZ',
        timezone: tenant.timezone || 'Asia/Tashkent',
        currency: tenant.currency || 'UZS',
        logoUrl: tenant.logoUrl,
        teachingCategories: tenant.teachingCategories || [],
        onboardingStep: tenant.onboardingStep || 'PROFILE',
      },
      counts: {
        subjects: subjectCount?.val ?? 0,
        branches: branchCount?.val ?? 0,
        team: teamCount?.val ?? 0,
        students: studentCount?.val ?? 0,
      },
    };
  }

  async checkSubdomain(currentTenantId: string, rawSubdomain: string) {
    const slug = rawSubdomain.toLowerCase().trim();

    if (slug.length < 3 || slug.length > 40) {
      return {
        available: false,
        reason: 'Subdomain uzunligi 3 tadan 40 tagacha belgidan iborat bolishi kerak',
      };
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return {
        available: false,
        reason: 'Faqat kichik lotin harflari, raqamlar va defisdan iborat bolishi kerak',
      };
    }

    if (RESERVED_SUBDOMAINS.has(slug)) {
      return {
        available: false,
        reason: 'Ushbu nom tizim tomonidan band qilingan, boshqa nom tanlang',
      };
    }

    const existing = await this.db.query.tenants.findFirst({
      where: and(eq(tenants.subdomain, slug), ne(tenants.id, currentTenantId)),
    });

    if (existing) {
      return {
        available: false,
        reason: 'Ushbu workspace URL allaqachon band qilingan',
      };
    }

    return { available: true, slug };
  }

  async updateProfile(tenantId: string, dto: ProfileStepDto) {
    const [updated] = await this.db
      .update(tenants)
      .set({
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        country: dto.country?.trim() || 'UZ',
        timezone: dto.timezone?.trim() || 'Asia/Tashkent',
        currency: (dto.currency?.trim() || 'UZS') as any,
        logoUrl: dto.logoUrl || null,
        onboardingStep: 'CATEGORIES',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    return { success: true, nextStep: 'CATEGORIES', tenant: updated };
  }

  async updateCategories(tenantId: string, dto: CategoriesStepDto) {
    const [updated] = await this.db
      .update(tenants)
      .set({
        teachingCategories: dto.categories,
        onboardingStep: 'SUBJECTS',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    return { success: true, nextStep: 'SUBJECTS', tenant: updated };
  }

  async updateWorkspace(tenantId: string, dto: WorkspaceStepDto) {
    const check = await this.checkSubdomain(tenantId, dto.subdomain);
    if (!check.available) {
      throw new BadRequestException(check.reason);
    }

    const [updated] = await this.db
      .update(tenants)
      .set({
        subdomain: check.slug,
        onboardingStep: 'BRANCH',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    return { success: true, nextStep: 'BRANCH', tenant: updated };
  }

  async addFirstBranch(tenantId: string, dto: BranchStepDto) {
    const [branch] = await this.db
      .insert(branches)
      .values({
        tenantId,
        name: dto.name.trim(),
        address: dto.address?.trim() || null,
        phone: dto.phone?.trim() || null,
      })
      .returning();

    await this.db
      .update(tenants)
      .set({
        onboardingStep: 'TEAM',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    return { success: true, nextStep: 'TEAM', branch };
  }

  async skipStep(tenantId: string, step: string) {
    const nextStep = STEP_TRANSITIONS[step.toUpperCase()] || 'COMPLETED';

    const [updated] = await this.db
      .update(tenants)
      .set({
        onboardingStep: nextStep,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    return { success: true, nextStep, tenant: updated };
  }

  async advanceToStep(tenantId: string, step: string) {
    const [updated] = await this.db
      .update(tenants)
      .set({
        onboardingStep: step,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    return { success: true, step: updated.onboardingStep };
  }

  async complete(tenantId: string) {
    const [tenant] = await this.db
      .update(tenants)
      .set({
        onboardingStep: 'COMPLETED',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    return {
      success: true,
      ready: true,
      workspaceUrl: `${tenant.subdomain}.crmapp.com`,
      redirectUrl: '/dashboard',
    };
  }
}
