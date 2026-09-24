import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, users } from '../db/schema';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';

@Injectable()
export class StaffService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findAll(tenantId: string) {
    const memberships = await this.db.query.organizationMemberships.findMany({
      where: and(
        eq(organizationMemberships.tenantId, tenantId),
        eq(organizationMemberships.status, 'ACTIVE'),
      ),
      with: {
        user: {
          columns: { id: true, email: true, fullName: true, createdAt: true },
        },
      },
      orderBy: (m, { asc }) => asc(m.createdAt),
    });

    return memberships.map((m) => ({
      id: m.userId,
      membershipId: m.id,
      email: m.user.email,
      fullName: m.user.fullName,
      role: m.role,
      permissions: m.permissions || [],
      createdAt: m.createdAt,
    }));
  }

  async create(tenantId: string, dto: CreateStaffDto) {
    const email = dto.email.trim().toLowerCase();
    let user = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (user) {
      // Check if user already has a membership in this tenant
      const existingMembership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.userId, user.id),
          eq(organizationMemberships.tenantId, tenantId),
        ),
      });

      if (existingMembership) {
        if (existingMembership.status === 'ACTIVE') {
          throw new ConflictException("Ushbu xodim allaqachon markazga a'zo");
        }
        // Reactivate suspended membership
        const [updated] = await this.db
          .update(organizationMemberships)
          .set({
            role: dto.role as any,
            permissions: dto.permissions || [],
            status: 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(eq(organizationMemberships.id, existingMembership.id))
          .returning();

        return {
          id: user.id,
          membershipId: updated.id,
          email: user.email,
          fullName: user.fullName,
          role: updated.role,
          permissions: updated.permissions || [],
          createdAt: updated.createdAt,
        };
      }

      // Add membership for existing global user to this tenant
      const [membership] = await this.db
        .insert(organizationMemberships)
        .values({
          userId: user.id,
          tenantId,
          role: dto.role as any,
          permissions: dto.permissions || [],
          status: 'ACTIVE',
        })
        .returning();

      return {
        id: user.id,
        membershipId: membership.id,
        email: user.email,
        fullName: user.fullName,
        role: membership.role,
        permissions: membership.permissions || [],
        createdAt: membership.createdAt,
      };
    }

    // New user creation
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const [newUser] = await this.db
      .insert(users)
      .values({
        tenantId, // retained as legacy/default tenant reference
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        role: dto.role as any,
        permissions: dto.permissions || [],
        emailVerified: true,
      })
      .returning();

    const [membership] = await this.db
      .insert(organizationMemberships)
      .values({
        userId: newUser.id,
        tenantId,
        role: dto.role as any,
        permissions: dto.permissions || [],
        status: 'ACTIVE',
      })
      .returning();

    return {
      id: newUser.id,
      membershipId: membership.id,
      email: newUser.email,
      fullName: newUser.fullName,
      role: membership.role,
      permissions: membership.permissions || [],
      createdAt: membership.createdAt,
    };
  }

  async update(tenantId: string, id: string, dto: UpdateStaffDto) {
    const membership = await this.db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.tenantId, tenantId),
        or(eq(organizationMemberships.userId, id), eq(organizationMemberships.id, id)),
        eq(organizationMemberships.status, 'ACTIVE'),
      ),
      with: {
        user: {
          columns: { id: true, email: true, fullName: true },
        },
      },
    });

    if (!membership) throw new NotFoundException('Xodim topilmadi');

    const patch: Partial<typeof organizationMemberships.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.role !== undefined) patch.role = dto.role as any;
    if (dto.permissions !== undefined) patch.permissions = dto.permissions;

    const [updated] = await this.db
      .update(organizationMemberships)
      .set(patch)
      .where(eq(organizationMemberships.id, membership.id))
      .returning();

    return {
      id: membership.userId,
      membershipId: updated.id,
      email: membership.user.email,
      fullName: membership.user.fullName,
      role: updated.role,
      permissions: updated.permissions || [],
      createdAt: updated.createdAt,
    };
  }

  async remove(tenantId: string, id: string, requesterId: string) {
    const membership = await this.db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.tenantId, tenantId),
        or(eq(organizationMemberships.userId, id), eq(organizationMemberships.id, id)),
        eq(organizationMemberships.status, 'ACTIVE'),
      ),
    });

    if (!membership) throw new NotFoundException('Xodim topilmadi');

    if (membership.userId === requesterId) {
      throw new BadRequestException("O'zingizni o'chira olmaysiz");
    }

    if (membership.role === 'OWNER') {
      throw new BadRequestException("Markaz asoschisini (OWNER) xodimlar ro'yxatidan o'chirib bo'lmaydi");
    }

    if (membership.role === 'ADMIN') {
      const adminCount = await this.db.query.organizationMemberships.findMany({
        where: and(
          eq(organizationMemberships.tenantId, tenantId),
          or(eq(organizationMemberships.role, 'ADMIN'), eq(organizationMemberships.role, 'OWNER')),
          eq(organizationMemberships.status, 'ACTIVE'),
        ),
      });
      if (adminCount.length <= 1) {
        throw new BadRequestException("Markazda kamida bitta ma'mur qolishi kerak");
      }
    }

    // MULTI-TENANT SAFE: Remove ONLY the organization membership for this tenant!
    // NEVER delete the global User record.
    await this.db
      .delete(organizationMemberships)
      .where(eq(organizationMemberships.id, membership.id));

    return { success: true };
  }
}
