import {
  BadRequestException,
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

      // Existing user joining a new organization
      // Check existing membership
      const existingMembership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.userId, user.id),
          eq(organizationMemberships.tenantId, invitation.tenantId),
        ),
      });

      if (existingMembership) {
        await this.db
          .update(organizationMemberships)
          .set({
            role: invitation.role as any,
            status: 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(eq(organizationMemberships.id, existingMembership.id));
      } else {
        await this.db.insert(organizationMemberships).values({
          userId: user.id,
          tenantId: invitation.tenantId,
          role: invitation.role as any,
          status: 'ACTIVE',
        });
      }
    } else {
      // New user registering via invitation
      if (!dto.fullName?.trim() || !dto.password || dto.password.length < 6) {
        throw new BadRequestException(
          'Yangi foydalanuvchi uchun ism va parol (kamida 6 ta belgi) kiritilishi shart',
        );
      }

      const passwordHash = await bcrypt.hash(dto.password, 10);
      const [newUser] = await this.db
        .insert(users)
        .values({
          tenantId: invitation.tenantId,
          fullName: dto.fullName.trim(),
          email: invitation.email || `${invitation.phone || Date.now()}@user.crmapp`,
          phone: invitation.phone || null,
          passwordHash,
          role: invitation.role as any,
          emailVerified: true,
        })
        .returning();

      user = newUser;

      // Create membership
      await this.db.insert(organizationMemberships).values({
        userId: user.id,
        tenantId: invitation.tenantId,
        role: invitation.role as any,
        status: 'ACTIVE',
      });
    }

    // Mark invitation accepted
    await this.db
      .update(invitations)
      .set({
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invitations.id, invitation.id));

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
