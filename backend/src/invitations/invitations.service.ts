import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { and, desc, eq, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import {
  invitations,
  organizationMemberships,
  tenants,
  users,
} from '../db/schema';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AuthService } from '../auth/auth.service';
import { assertTrialRoom } from '../trial/trial-limits';
import { centerWorkRefusal } from '../trial/trial-access';

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly authService: AuthService,
  ) {}

  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  async create(tenantId: string, invitedByUserId: string, dto: CreateInvitationDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email yoki telefon raqami kiritilishi shart');
    }
    await assertTrialRoom(this.db, tenantId, 'staff');

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invitation] = await this.db
      .insert(invitations)
      .values({
        tenantId,
        role: dto.role,
        email: dto.email ? dto.email.toLowerCase().trim() : null,
        phone: dto.phone ? dto.phone.trim() : null,
        tokenHash,
        status: 'PENDING',
        invitedByUserId,
        expiresAt,
      })
      .returning();

    return {
      id: invitation.id,
      role: invitation.role,
      email: invitation.email,
      phone: invitation.phone,
      expiresAt: invitation.expiresAt,
      status: invitation.status,
      token: rawToken,
      inviteUrl: `/invite/${rawToken}`,
    };
  }

  async findAll(tenantId: string) {
    return this.db.query.invitations.findMany({
      where: eq(invitations.tenantId, tenantId),
      orderBy: [desc(invitations.createdAt)],
    });
  }

  async revoke(tenantId: string, id: string) {
    const [revoked] = await this.db
      .update(invitations)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(and(eq(invitations.id, id), eq(invitations.tenantId, tenantId)))
      .returning();

    if (!revoked) {
      throw new NotFoundException('Taklifnoma topilmadi');
    }
    return { success: true };
  }

  async validateToken(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const invitation = await this.db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, tokenHash),
    });

    if (!invitation) {
      throw new NotFoundException('Taklifnoma topilmadi yoki yaroqsiz');
    }

    if (invitation.status === 'ACCEPTED') {
      throw new BadRequestException('Ushbu taklifnoma allaqachon qabul qilingan');
    }

    if (invitation.status === 'REVOKED') {
      throw new BadRequestException('Ushbu taklifnoma bekor qilingan');
    }

    if (invitation.expiresAt < new Date() || invitation.status === 'EXPIRED') {
      throw new BadRequestException('Taklifnoma muddati tugagan');
    }

    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, invitation.tenantId),
    });

    // Security: Do NOT disclose whether this identity has an existing account to unauthenticated requests
    return {
      valid: true,
      role: invitation.role,
      email: invitation.email,
      phone: invitation.phone,
      tenantName: tenant?.name || 'Talim markazi',
      tenantSubdomain: tenant?.subdomain,
      expiresAt: invitation.expiresAt,
    };
  }

  // Marks it accepted in the transaction that adds the member: only once,
  // so two accepts at the same moment add one.
  private async markAccepted(tx: Pick<Database, 'update'>, id: string) {
    const [row] = await tx
      .update(invitations)
      .set({ status: 'ACCEPTED', acceptedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invitations.id, id), eq(invitations.status, 'PENDING')))
      .returning({ id: invitations.id });
    if (!row) throw new BadRequestException('Ushbu taklifnoma allaqachon qabul qilingan');
  }

  async accept(rawToken: string, dto: AcceptInvitationDto, authenticatedUserId?: string) {
    const tokenHash = this.hashToken(rawToken);
    const invitation = await this.db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, tokenHash),
    });

    if (!invitation) {
      throw new NotFoundException('Taklifnoma topilmadi');
    }

    if (invitation.status === 'ACCEPTED') {
      throw new BadRequestException('Ushbu taklifnoma allaqachon qabul qilingan');
    }

    if (invitation.status === 'REVOKED') {
      throw new BadRequestException('Ushbu taklifnoma bekor qilingan');
    }

    if (invitation.expiresAt < new Date() || invitation.status === 'EXPIRED') {
      throw new BadRequestException('Taklifnoma muddati tugagan');
    }

    // A center whose trial is over, or that is suspended, takes no one in.
    const [center] = await this.db
      .select({ status: tenants.status, trialEndsAt: tenants.trialEndsAt })
      .from(tenants)
      .where(eq(tenants.id, invitation.tenantId));
    const closed = center && centerWorkRefusal(center);
    if (closed) throw new ForbiddenException(closed);
    const joinsStaff = invitation.role !== 'STUDENT' && invitation.role !== 'PARENT';

    // Check if user exists by email or phone
    const conditions = [];
    if (invitation.email) conditions.push(eq(users.email, invitation.email.toLowerCase().trim()));
    if (invitation.phone) conditions.push(eq(users.phone, invitation.phone.trim()));

    let user = conditions.length > 0
      ? await this.db.query.users.findFirst({ where: or(...conditions) })
      : null;

    if (user) {
      // SECURITY HARDENING:
      // An invitation token alone MUST NOT authenticate an existing user.
      // Require either:
      // A. An authenticated session matching this user
      // OR
      // B. Explicit re-authentication using their existing password.
      if (authenticatedUserId) {
        if (authenticatedUserId !== user.id) {
          throw new ForbiddenException(
            "Ushbu taklifnoma boshqa hisob uchun mo'ljallangan. Iltimos, tegishli profil orqali kiring.",
          );
        }
      } else {
        if (!dto.password) {
          throw new BadRequestException(
            "Sizning profilingiz allaqachon mavjud. Taklifnomani qabul qilish uchun parolingizni kiriting.",
          );
        }
        const isPasswordCorrect = await bcrypt.compare(dto.password, user.passwordHash);
        if (!isPasswordCorrect) {
          throw new UnauthorizedException("Parol noto'g'ri kiritildi");
        }
      }
    } else if (!dto.fullName?.trim() || !dto.password || dto.password.length < 6) {
      // New user registering via invitation
      throw new BadRequestException(
        'Yangi foydalanuvchi uchun ism va parol (kamida 6 ta belgi) kiritilishi shart',
      );
    }
    const existing = user;
    // Hashed before the transaction: it is slow and needs no lock.
    const passwordHash = existing ? null : await bcrypt.hash(dto.password!, 10);

    // One transaction: the staff limit, the invitation marked used (once),
    // and the member added - all of it, or nothing.
    try {
      user = await this.db.transaction(async (tx) => {
        await this.markAccepted(tx, invitation.id);
        if (existing) {
          const membership = await tx.query.organizationMemberships.findFirst({
            where: and(eq(organizationMemberships.userId, existing.id), eq(organizationMemberships.tenantId, invitation.tenantId)),
          });
          if (joinsStaff) await assertTrialRoom(tx, invitation.tenantId, 'staff', membership?.status === 'ACTIVE' ? 0 : 1, true, { countPending: false });
          if (membership) {
            await tx
              .update(organizationMemberships)
              .set({ role: invitation.role as any, status: 'ACTIVE', removedAt: null, removedByUserId: null, updatedAt: new Date() })
              .where(eq(organizationMemberships.id, membership.id));
          } else {
            await tx.insert(organizationMemberships).values({ userId: existing.id, tenantId: invitation.tenantId, role: invitation.role as any, status: 'ACTIVE' });
          }
          return existing;
        }
        if (joinsStaff) await assertTrialRoom(tx, invitation.tenantId, 'staff', 1, true, { countPending: false });
        const [created] = await tx
          .insert(users)
          .values({
            tenantId: invitation.tenantId,
            fullName: dto.fullName!.trim(),
            email: invitation.email || `${invitation.phone || Date.now()}@user.crmapp`,
            phone: invitation.phone || null,
            passwordHash: passwordHash!,
            role: invitation.role as any,
            emailVerified: true,
          })
          .returning();
        await tx.insert(organizationMemberships).values({ userId: created.id, tenantId: invitation.tenantId, role: invitation.role as any, status: 'ACTIVE' });
        return created;
      });
    } catch (err) {
      // The account was created a moment ago (another invitation accepted at
      // the same time): nothing was written here; accepting again signs in to it.
      if ((err as { code?: string; cause?: { code?: string } }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new ConflictException({ code: 'ACCOUNT_EXISTS', message: "Bu email yoki telefon bilan profil hozirgina yaratildi. Taklifnomani parolingiz bilan qayta qabul qiling." });
      }
      throw err;
    }

    // Sign JWT with the invited tenant context and role
    const tokens = await this.authService.issueFullSession({
      id: user.id,
      email: user.email,
      role: invitation.role,
      tenantId: invitation.tenantId,
      permissions: user.permissions,
    });

    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, invitation.tenantId),
    });

    let redirectUrl = '/dashboard';
    if (invitation.role === 'STUDENT' || invitation.role === 'PARENT') {
      redirectUrl = '/portal';
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: invitation.role,
        tenantId: invitation.tenantId,
      },
      tenant: {
        id: tenant?.id,
        name: tenant?.name,
        subdomain: tenant?.subdomain,
      },
      redirectUrl,
    };
  }
}
