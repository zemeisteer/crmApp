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
import { authHandoffCodes, organizationMemberships, sessions, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { ACCESS_KEYS, effectiveAccess, isConfigurableRole } from '../access/catalog';

type MembershipRow = typeof organizationMemberships.$inferSelect;
const view = (userId: string, email: string, fullName: string, m: MembershipRow) => ({
  id: userId,
  membershipId: m.id,
  email,
  fullName,
  role: m.role,
  permissions: m.permissions || [],
  // The own list (null: the role's default) and what it comes to.
  access: m.access ?? null,
  effectiveAccess: effectiveAccess(m.role, m.access),
  createdAt: m.createdAt,
});

/** A list can be set only for the roles it applies to; kept in catalog order, without repeats. */
function checkedAccess(role: string, access: string[] | null | undefined): string[] | null | undefined {
  if (access === undefined || access === null) return access;
  if (!isConfigurableRole(role)) {
    throw new BadRequestException("Admin hamma narsaga ega: ruxsatlarni cheklash uchun boshqa rol tanlang");
  }
  return ACCESS_KEYS.filter((k) => access.includes(k));
}

@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

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

    return memberships.map((m) => view(m.userId, m.user.email, m.user.fullName, m));
  }

  async create(tenantId: string, dto: CreateStaffDto) {
    const access = checkedAccess(dto.role, dto.access) ?? null;
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
        // Adding them again is the deliberate way back in.
        const [updated] = await this.db
          .update(organizationMemberships)
          .set({
            role: dto.role as any,
            permissions: dto.permissions || [],
            access,
            status: 'ACTIVE',
            removedAt: null,
            removedByUserId: null,
            updatedAt: new Date(),
          })
          .where(eq(organizationMemberships.id, existingMembership.id))
          .returning();

        return view(user.id, user.email, user.fullName, updated);
      }

      // Add membership for existing global user to this tenant
      const [membership] = await this.db
        .insert(organizationMemberships)
        .values({
          userId: user.id,
          tenantId,
          role: dto.role as any,
          permissions: dto.permissions || [],
          access,
          status: 'ACTIVE',
        })
        .returning();

      return view(user.id, user.email, user.fullName, membership);
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
        access,
        status: 'ACTIVE',
      })
      .returning();

    return view(newUser.id, newUser.email, newUser.fullName, membership);
  }

  async update(tenantId: string, id: string, dto: UpdateStaffDto, requesterId?: string) {
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
    // The owner always has everything; their membership is not edited here.
    if (membership.role === 'OWNER') throw new BadRequestException("Markaz egasining roli va ruxsatlari o'zgartirilmaydi");

    const patch: Partial<typeof organizationMemberships.$inferInsert> = {
      updatedAt: new Date(),
    };
    const role = dto.role ?? membership.role;
    if (dto.role !== undefined) patch.role = dto.role as any;
    if (dto.permissions !== undefined) patch.permissions = dto.permissions;
    if (dto.access !== undefined) patch.access = checkedAccess(role, dto.access);
    // A new role starts from its own default unless a list comes with it.
    else if (dto.role !== undefined && dto.role !== membership.role) patch.access = null;

    const [updated] = await this.db
      .update(organizationMemberships)
      .set(patch)
      .where(eq(organizationMemberships.id, membership.id))
      .returning();
    if (patch.role !== undefined || patch.access !== undefined) {
      this.audit.log({ tenantId, userId: requesterId ?? null, action: 'update', entityType: 'staff', entityId: membership.userId, meta: { role: updated.role, access: updated.access ?? null } });
    }

    return view(membership.userId, membership.user.email, membership.user.fullName, updated);
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

    // Only this center's membership; the person's account and their other
    // centers are untouched. The row is kept as a tombstone (SUSPENDED,
    // removedAt) rather than deleted, and everything that could carry the
    // old access forward goes with it: sessions bound to this center and
    // any handoff code issued for it.
    await this.db.transaction(async (tx) => {
      await tx
        .update(organizationMemberships)
        .set({ status: 'SUSPENDED', removedAt: new Date(), removedByUserId: requesterId, updatedAt: new Date() })
        .where(eq(organizationMemberships.id, membership.id));
      await tx.delete(sessions).where(and(eq(sessions.userId, membership.userId), eq(sessions.tenantId, tenantId)));
      await tx.delete(authHandoffCodes).where(and(eq(authHandoffCodes.userId, membership.userId), eq(authHandoffCodes.tenantId, tenantId)));
    });
    this.audit.log({ tenantId, userId: requesterId ?? null, action: 'delete', entityType: 'staff', entityId: membership.userId, meta: { role: membership.role, membershipId: membership.id } });

    return { success: true };
  }
}
