import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { generateSecret as generateTotpSecret, generateURI as generateTotpUri, verify as verifyTotp } from 'otplib';
import * as qrcode from 'qrcode';
import { randomBytes, createHash } from 'crypto';
import { eq, and, gt, isNull, lt } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenants, users, sessions, organizationMemberships, authHandoffCodes } from '../db/schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

// class-validator's DTO doesn't enforce this beyond MinLength(6) — a
// dedicated check here keeps password strength independent of that and
// easy to test.
export function isPasswordStrongEnough(password: string): string | null {
  if (password.length < 8) return "Parol kamida 8 ta belgidan iborat bo'lishi kerak";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Parol kamida bitta harf va bitta raqamdan iborat bo'lishi kerak";
  }
  return null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  verifyAccessToken(token: string) {
    try {
      return this.jwt.verify<{ sub: string; email: string; role: string; tenantId: string | null }>(token);
    } catch {
      return null;
    }
  }

  private async signAccessToken(user: {
    id: string;
    email: string;
    role: string;
    tenantId: string | null;
    permissions?: string[] | null;
  }) {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      permissions: user.permissions || [],
    });
  }

  private async signPendingToken(userId: string) {
    return this.jwt.signAsync({ sub: userId, pending2fa: true }, { expiresIn: '5m' });
  }

  private async issueSession(userId: string, tenantId: string | null, meta: { userAgent?: string; ip?: string }) {
    const refreshToken = randomBytes(32).toString('hex');
    await this.db.insert(sessions).values({
      userId,
      tenantId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    return refreshToken;
  }

  private frontendUrl() {
    return this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }

  async issueFullSession(
    user: { id: string; email: string; role: string; tenantId: string | null; permissions?: string[] | null },
    meta: { userAgent?: string; ip?: string } = {},
  ) {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.issueSession(user.id, user.tenantId, meta);
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const passwordIssue = isPasswordStrongEnough(dto.password);
    if (passwordIssue) throw new BadRequestException(passwordIssue);

    const email = dto.email.trim().toLowerCase();
    const existingEmail = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existingEmail) {
      throw new ConflictException("Bu email allaqachon ro'yxatdan o'tgan");
    }

    let subdomain = dto.subdomain?.trim().toLowerCase();
    if (subdomain) {
      const existingSubdomain = await this.db.query.tenants.findFirst({
        where: eq(tenants.subdomain, subdomain),
      });
      if (existingSubdomain) {
        throw new ConflictException('Bu sub-domen band, boshqasini tanlang');
      }
    } else {
      const baseSlug = dto.centerName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20) || 'center';
      subdomain = baseSlug;
      const exists = await this.db.query.tenants.findFirst({
        where: eq(tenants.subdomain, subdomain),
      });
      if (exists) {
        subdomain = `${baseSlug}-${randomBytes(3).toString('hex')}`;
      }
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const [tenant] = await this.db
      .insert(tenants)
      .values({
        name: dto.centerName.trim(),
        subdomain,
        category: (dto.category as any) ?? 'BOSHQA',
        status: 'TRIAL',
        plan: 'STARTER',
        trialEndsAt,
        onboardingStep: 'PROFILE',
      })
      .returning();

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const verifyToken = randomBytes(32).toString('hex');
    const [user] = await this.db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        role: 'OWNER',
        verifyTokenHash: hashToken(verifyToken),
      })
      .returning();

    // Create organization membership
    await this.db.insert(organizationMemberships).values({
      userId: user.id,
      tenantId: tenant.id,
      role: 'OWNER',
      status: 'ACTIVE',
    });

    void this.email.send(
      user.email,
      "TalimCRM — emailingizni tasdiqlang",
      `Assalomu alaykum, ${user.fullName}!\n\nEmailingizni tasdiqlash uchun havolani oching:\n${this.frontendUrl()}/verify-email?token=${verifyToken}\n\nAgar ro'yxatdan o'tmagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.`,
    );

    const { accessToken, refreshToken } = await this.issueFullSession(
      { id: user.id, email: user.email, role: 'OWNER', tenantId: tenant.id, permissions: user.permissions || [] },
      {},
    );

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: 'OWNER', permissions: user.permissions || [] },
      tenant,
      onboardingStep: 'PROFILE',
    };
  }

  async login(dto: LoginDto, meta: { userAgent?: string; ip?: string }) {
    const identifier = (dto.login || dto.email || '').trim().toLowerCase();
    if (!identifier) throw new BadRequestException('Email yoki telefon kiritilmadi');

    const user = await this.db.query.users.findFirst({
      where: eq(users.email, identifier),
    });
    if (!user) throw new UnauthorizedException('Email yoki parol noto\'g\'ri');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Email yoki parol noto\'g\'ri');

    if (user.twoFactorEnabled) {
      const pendingToken = await this.signPendingToken(user.id);
      return { twoFactorRequired: true, pendingToken };
    }

    return this.completeLogin(user, meta);
  }

  // ---- Workspaces ----
  // A user may belong to several centers with a different role in each.
  // Role and permissions always come from the ACTIVE membership of the
  // workspace in use - at login, on every request (JwtStrategy), on refresh
  // and on handoff - never from the user's global row. A center with no
  // membership row for the user is closed to them, whatever `users.tenantId`
  // and `users.role` say: those columns do not grant anything.

  async resolveWorkspace(
    user: { id: string; role: string; tenantId: string | null; permissions?: string[] | null },
    tenantId: string | null,
  ): Promise<{ role: string; permissions: string[]; tenant: typeof tenants.$inferSelect | null }> {
    if (user.role === 'SUPERADMIN') {
      const tenant = tenantId ? (await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })) ?? null : null;
      if (tenantId && !tenant) throw new NotFoundException('Markaz topilmadi');
      return { role: 'SUPERADMIN', permissions: ['*'], tenant };
    }
    const rows = await this.db.query.organizationMemberships.findMany({ where: eq(organizationMemberships.userId, user.id) });
    if (!tenantId) {
      // No workspace: only an account that belongs to no center at all.
      if (rows.length > 0 || user.tenantId) throw new UnauthorizedException('Markaz tanlanmagan');
      return { role: user.role, permissions: user.permissions || [], tenant: null };
    }
    const membership = rows.find((m) => m.tenantId === tenantId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new UnauthorizedException("Siz ushbu markazga a'zo emassiz");
    }
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');
    return { role: membership.role, permissions: membership.permissions || [], tenant };
  }

  // After the password (and the 2FA code): one session, bound to a
  // workspace; several centers -> the caller picks one.
  private async completeLogin(user: typeof users.$inferSelect, meta: { userAgent?: string; ip?: string }) {
    const memberships = await this.db.query.organizationMemberships.findMany({
      where: and(
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, 'ACTIVE'),
      ),
      with: {
        tenant: true,
      },
    });

    const workspaces = memberships.map((m) => ({
      tenantId: m.tenant.id,
      name: m.tenant.name,
      subdomain: m.tenant.subdomain,
      role: m.role,
      logoUrl: m.tenant.logoUrl,
      onboardingStep: m.tenant.onboardingStep,
    }));

    if (workspaces.length === 0 && user.role === 'SUPERADMIN') {
      const { accessToken, refreshToken } = await this.issueFullSession(
        { id: user.id, email: user.email, role: 'SUPERADMIN', tenantId: null, permissions: ['*'] },
        meta,
      );
      return {
        twoFactorRequired: false as const,
        requiresWorkspaceSelection: false as const,
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, fullName: user.fullName, role: 'SUPERADMIN', permissions: ['*'] },
        tenant: null,
        workspaces: [],
      };
    }

    if (memberships.length >= 1) {
      // Several centers: the session starts in the first one and the caller
      // is told to choose (select-workspace re-binds this same session).
      const m = memberships[0];
      const { accessToken, refreshToken } = await this.issueFullSession(
        { id: user.id, email: user.email, role: m.role, tenantId: m.tenant.id, permissions: m.permissions || [] },
        meta,
      );
      return {
        twoFactorRequired: false as const,
        requiresWorkspaceSelection: memberships.length > 1,
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, fullName: user.fullName, role: m.role, permissions: m.permissions || [] },
        tenant: m.tenant,
        workspaces,
      };
    }

    // No ACTIVE membership anywhere. Neither suspended/removed rows nor the
    // user's old `tenantId` / `role` columns open a center: a person removed
    // from their only center has nothing to sign in to until someone adds
    // them again.
    const anyMembership = await this.db.query.organizationMemberships.findFirst({ where: eq(organizationMemberships.userId, user.id), columns: { id: true } });
    if (anyMembership || user.tenantId) throw new UnauthorizedException("Sizning markazdagi a'zoligingiz faol emas");

    // An account that never belonged to a center: a session with no
    // workspace, which reads nothing tenant-scoped.
    const { accessToken, refreshToken } = await this.issueFullSession(
      { id: user.id, email: user.email, role: user.role, tenantId: null, permissions: user.permissions || [] },
      meta,
    );

    return {
      twoFactorRequired: false as const,
      requiresWorkspaceSelection: false as const,
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, permissions: user.permissions || [] },
      tenant: null,
      workspaces: [],
    };
  }

  // ---- Moving a session to the center's own address ----
  // The app on <center>.<domain> is a different site for the browser, so the
  // login does not follow. A signed-in user asks for a one-time code, the
  // browser carries it in the URL fragment, and the other address exchanges
  // it for its own session. 60 seconds, single use, stored hashed.

  async createHandoff(userId: string, tenantId: string | null) {
    if (!tenantId) throw new BadRequestException('Markaz tanlanmagan');
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException('Foydalanuvchi topilmadi');
    // Only for a workspace the caller really works in right now.
    const { tenant } = await this.resolveWorkspace(user, tenantId);
    const code = randomBytes(32).toString('hex');
    await this.db.delete(authHandoffCodes).where(lt(authHandoffCodes.expiresAt, new Date()));
    await this.db.insert(authHandoffCodes).values({ codeHash: hashToken(code), userId, tenantId: tenant!.id, expiresAt: new Date(Date.now() + 60_000) });
    return { code, subdomain: tenant!.subdomain };
  }

  async exchangeHandoff(code: string, meta: { userAgent?: string; ip?: string }) {
    if (typeof code !== 'string' || code.length < 32) throw new UnauthorizedException('Kod yaroqsiz');
    // Claim it atomically: only the first exchange gets a row back.
    const [row] = await this.db
      .update(authHandoffCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(authHandoffCodes.codeHash, hashToken(code)), isNull(authHandoffCodes.usedAt), gt(authHandoffCodes.expiresAt, new Date())))
      .returning();
    if (!row) throw new UnauthorizedException('Kod eskirgan yoki ishlatilgan');
    // A full session of its own at the destination (access + refresh),
    // bound to that workspace; the membership is checked again here.
    return this.selectWorkspace(row.userId, row.tenantId, meta);
  }

  // Opens `targetTenantId` for the user. With the caller's refresh token the
  // same session is re-bound to the workspace (and rotated); without one a
  // new session is opened. Either way the answer carries a refresh token
  // that keeps this workspace.
  async selectWorkspace(userId: string, targetTenantId: string, meta: { userAgent?: string; ip?: string }, currentRefreshToken?: string) {
    if (!targetTenantId || typeof targetTenantId !== 'string') throw new BadRequestException('Markaz tanlanmagan');
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException('Foydalanuvchi topilmadi');

    const { role, permissions, tenant } = await this.resolveWorkspace(user, targetTenantId);
    if (!tenant) throw new NotFoundException('Markaz topilmadi');

    if (user.role === 'SUPERADMIN') {
      this.audit.log({
        tenantId: tenant.id,
        userId: user.id,
        action: 'switch_workspace',
        entityType: 'tenant',
        entityId: tenant.id,
        meta: {
          action: 'SUPERADMIN_SWITCH_WORKSPACE',
          superAdminEmail: user.email,
          targetTenantName: tenant.name,
          targetSubdomain: tenant.subdomain,
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const accessToken = await this.signAccessToken({ id: user.id, email: user.email, role, tenantId: tenant.id, permissions });

    let refreshToken: string | null = null;
    if (typeof currentRefreshToken === 'string' && currentRefreshToken) {
      const rotated = randomBytes(32).toString('hex');
      const [updated] = await this.db
        .update(sessions)
        .set({ tenantId: tenant.id, refreshTokenHash: hashToken(rotated), lastUsedAt: new Date(), userAgent: meta.userAgent, ip: meta.ip })
        .where(and(eq(sessions.refreshTokenHash, hashToken(currentRefreshToken)), eq(sessions.userId, user.id)))
        .returning({ id: sessions.id });
      if (updated) refreshToken = rotated;
    }
    refreshToken ??= await this.issueSession(user.id, tenant.id, meta);

    return {
      accessToken,
      refreshToken,
      tenant,
      role,
      permissions,
      user: { id: user.id, email: user.email, fullName: user.fullName, role, permissions },
    };
  }

  async listWorkspaces(userId: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException();

    if (user.role === 'SUPERADMIN') {
      const allTenants = await this.db.query.tenants.findMany({
        columns: { id: true, name: true, subdomain: true, logoUrl: true, status: true, onboardingStep: true },
        limit: 50,
      });
      return allTenants.map((t) => ({
        tenantId: t.id,
        name: t.name,
        subdomain: t.subdomain,
        role: 'SUPERADMIN',
        logoUrl: t.logoUrl,
        onboardingStep: t.onboardingStep,
      }));
    }

    const memberships = await this.db.query.organizationMemberships.findMany({
      where: and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'ACTIVE'),
      ),
      with: {
        tenant: true,
      },
    });

    return memberships.map((m) => ({
      tenantId: m.tenant.id,
      name: m.tenant.name,
      subdomain: m.tenant.subdomain,
      role: m.role,
      logoUrl: m.tenant.logoUrl,
      onboardingStep: m.tenant.onboardingStep,
    }));
  }

  async verifyTwoFactorLogin(pendingToken: string, code: string, meta: { userAgent?: string; ip?: string }) {
    let payload: { sub: string; pending2fa?: boolean };
    try {
      payload = await this.jwt.verifyAsync(pendingToken);
    } catch {
      throw new UnauthorizedException("Sessiya muddati tugagan, qayta kiring");
    }
    if (!payload.pending2fa) throw new UnauthorizedException('Noto\'g\'ri token');

    const user = await this.db.query.users.findFirst({ where: eq(users.id, payload.sub) });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException();

    const result = await verifyTotp({ secret: user.twoFactorSecret, token: code });
    if (!result.valid) throw new UnauthorizedException("Kod noto'g'ri");

    // Same as a password login from here: membership role, and the
    // workspace choice when there are several.
    return this.completeLogin(user, meta);
  }

  // ---- Two-factor setup (TOTP, authenticator app — no external account needed) ----

  async setupTwoFactor(userId: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException();
    const secret = generateTotpSecret();
    await this.db.update(users).set({ twoFactorSecret: secret }).where(eq(users.id, userId));
    const otpauth = generateTotpUri({ issuer: 'TalimCRM', label: user.email, secret });
    const qrDataUrl = await qrcode.toDataURL(otpauth);
    return { secret, qrDataUrl };
  }

  async confirmTwoFactor(userId: string, code: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user?.twoFactorSecret) throw new BadRequestException("Avval /2fa/setup chaqiring");
    const result = await verifyTotp({ secret: user.twoFactorSecret, token: code });
    if (!result.valid) throw new BadRequestException("Kod noto'g'ri");
    await this.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, userId));
    return { message: '2FA yoqildi.' };
  }

  async disableTwoFactor(userId: string, code: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user?.twoFactorSecret || !user.twoFactorEnabled) throw new BadRequestException("2FA yoqilmagan");
    const result = await verifyTotp({ secret: user.twoFactorSecret, token: code });
    if (!result.valid) throw new BadRequestException("Kod noto'g'ri");
    await this.db.update(users).set({ twoFactorEnabled: false, twoFactorSecret: null }).where(eq(users.id, userId));
    return { message: '2FA o\'chirildi.' };
  }

  // ---- Sessions ----

  async refresh(refreshToken: string, meta: { userAgent?: string; ip?: string }) {
    if (typeof refreshToken !== 'string' || !refreshToken) throw new UnauthorizedException("Refresh token noto'g'ri yoki eskirgan");
    const hash = hashToken(refreshToken);
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.refreshTokenHash, hash) });
    if (!session) throw new UnauthorizedException("Refresh token noto'g'ri yoki eskirgan");

    const user = await this.db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user) throw new UnauthorizedException();

    // The session's own workspace - never the user's default center - and
    // only while that membership is still active.
    let ws: Awaited<ReturnType<AuthService['resolveWorkspace']>>;
    try {
      ws = await this.resolveWorkspace(user, session.tenantId);
    } catch (err) {
      await this.db.delete(sessions).where(eq(sessions.id, session.id));
      throw err instanceof NotFoundException ? new UnauthorizedException('Markaz topilmadi') : err;
    }

    const accessToken = await this.signAccessToken({
      id: user.id,
      email: user.email,
      role: ws.role,
      tenantId: ws.tenant?.id ?? null,
      permissions: ws.permissions,
    });
    const newRefreshToken = randomBytes(32).toString('hex');
    await this.db
      .update(sessions)
      .set({ refreshTokenHash: hashToken(newRefreshToken), lastUsedAt: new Date(), userAgent: meta.userAgent, ip: meta.ip })
      .where(eq(sessions.id, session.id));
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    const hash = hashToken(refreshToken);
    await this.db.delete(sessions).where(eq(sessions.refreshTokenHash, hash));
    return { success: true };
  }

  async listSessions(userId: string) {
    const rows = await this.db.query.sessions.findMany({
      where: eq(sessions.userId, userId),
      orderBy: (s, { desc }) => desc(s.lastUsedAt),
    });
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    return { success: true };
  }

  // ---- Password reset / email verify ----

  async forgotPassword(email: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (user) {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await this.db
        .update(users)
        .set({ resetTokenHash: hashToken(token), resetTokenExpiresAt: expiresAt })
        .where(eq(users.id, user.id));
      void this.email.send(
        user.email,
        'TalimCRM — parolni tiklash',
        `Parolni tiklash uchun havola (30 daqiqa amal qiladi):\n${this.frontendUrl()}/reset-password?token=${token}\n\nAgar buni siz so'ramagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.`,
      );
    }
    return { message: "Agar bunday email ro'yxatdan o'tgan bo'lsa, parolni tiklash havolasi yuborildi." };
  }

  async resetPassword(token: string, newPassword: string) {
    const passwordIssue = isPasswordStrongEnough(newPassword);
    if (passwordIssue) throw new BadRequestException(passwordIssue);

    const hash = hashToken(token);
    const user = await this.db.query.users.findFirst({
      where: and(eq(users.resetTokenHash, hash), gt(users.resetTokenExpiresAt, new Date())),
    });
    if (!user) throw new BadRequestException("Havola noto'g'ri yoki muddati o'tgan");

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.db
      .update(users)
      .set({ passwordHash, resetTokenHash: null, resetTokenExpiresAt: null })
      .where(eq(users.id, user.id));
    await this.db.delete(sessions).where(eq(sessions.userId, user.id));
    return { message: "Parol muvaffaqiyatli yangilandi. Barcha qurilmalardan chiqildi." };
  }

  async verifyEmail(token: string) {
    const hash = hashToken(token);
    const user = await this.db.query.users.findFirst({ where: eq(users.verifyTokenHash, hash) });
    if (!user) throw new BadRequestException("Tasdiqlash havolasi noto'g'ri");
    await this.db.update(users).set({ emailVerified: true, verifyTokenHash: null }).where(eq(users.id, user.id));
    return { message: 'Email tasdiqlandi.' };
  }

  // Who the caller is in the workspace their token names (role and
  // permissions of that membership), not their default center.
  async me(userId: string, tenantId: string | null = null) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new UnauthorizedException();
    const ws = await this.resolveWorkspace(user, tenantId);
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: ws.role,
        permissions: ws.permissions,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      tenant: ws.tenant,
    };
  }
}
