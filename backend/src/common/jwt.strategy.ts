import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, users } from '../db/schema';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: 'SUPERADMIN' | 'OWNER' | 'ADMIN' | 'MANAGER' | 'RECEPTIONIST' | 'TEACHER' | 'ACCOUNTANT' | 'STUDENT' | 'PARENT';
  tenantId: string | null;
  permissions?: string[] | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(DB) private readonly db: Database,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  // A signed token is not enough on its own: the workspace it names must
  // still be one the user actively belongs to, and role and permissions are
  // taken from that membership as it is now - so removing or suspending a
  // member, or changing their role, takes effect on their next request
  // instead of when the token expires.
  async validate(payload: JwtPayload & { pending2fa?: boolean; studentId?: string }) {
    // The short token between password and 2FA code opens nothing.
    if (payload.pending2fa) throw new UnauthorizedException();
    // Student / parent cabinet tokens are checked by PortalAuthGuard and are
    // kept out of the back office by RolesGuard.
    if (payload.studentId) return payload;

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, payload.sub),
      columns: { id: true, role: true, tenantId: true, permissions: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.role === 'SUPERADMIN') return { ...payload, role: 'SUPERADMIN' as const };
    if (payload.role === 'SUPERADMIN') throw new UnauthorizedException();
    if (!payload.tenantId) return payload; // no workspace: nothing tenant-scoped can be read with it

    const [membership] = await this.db
      .select({ role: organizationMemberships.role, status: organizationMemberships.status, permissions: organizationMemberships.permissions })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, user.id), eq(organizationMemberships.tenantId, payload.tenantId)));
    if (membership) {
      if (membership.status !== 'ACTIVE') throw new UnauthorizedException("Sizning markazdagi a'zoligingiz faol emas");
      return { ...payload, role: membership.role, permissions: membership.permissions || [] };
    }
    // Accounts from before memberships: their own center only, and only
    // while they have no membership rows at all.
    const [any] = await this.db.select({ id: organizationMemberships.id }).from(organizationMemberships).where(eq(organizationMemberships.userId, user.id)).limit(1);
    if (!any && user.tenantId === payload.tenantId) return { ...payload, role: user.role, permissions: user.permissions || [] };
    throw new UnauthorizedException("Siz ushbu markazga a'zo emassiz");
  }
}
