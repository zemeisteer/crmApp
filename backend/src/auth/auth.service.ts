import { ForbiddenException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { effectiveAccess } from '../access/catalog';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { generateSecret as generateTotpSecret, generateURI as generateTotpUri, verify as verifyTotp } from 'otplib';
import * as qrcode from 'qrcode';
import { randomBytes, createHash } from 'crypto';
import { eq, and, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenants, users, sessions, organizationMemberships, authHandoffCodes } from '../db/schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { SignupPhoneService } from './signup-phone.service';
import { TrialClaimsService } from '../trial/trial-claims.service';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
import { trialRules, trialStage } from '../trial/trial-rules';
import { billingRules } from '../platform-billing/billing-period';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** A new key waits this long for its confirmation. */
const PENDING_2FA_MS = 10 * 60_000;
// A code from the step before still counts (30 s): typing it and the
// sign-in itself can cross into the next step. Codes ahead do not.
const TOTP_TOLERANCE: [number, number] = [30, 0];
const RECOVERY_CODE = /^[0-9a-f]{5}-[0-9a-f]{5}$/;

/** Ten one-time recovery codes ("a1b2c-3d4e5") and their hashes. */
function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => {
    const h = randomBytes(5).toString('hex');
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => hashToken(c)) };
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
    private readonly signupPhone: SignupPhoneService,
    private readonly trialClaims: TrialClaimsService,
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
  }, sessionId: string) {
    // `sid` ties the token to its session row: when the session ends
    // (logout, revoke, removal from the center) the token stops working at
    // once instead of at its expiry. Checked in JwtStrategy.
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      permissions: user.permissions || [],
      sid: sessionId,
    });
  }

  private async signPendingToken(userId: string) {
    return this.jwt.signAsync({ sub: userId, pending2fa: true }, { expiresIn: '5m' });
  }

  private async issueSession(userId: string, tenantId: string | null, meta: { userAgent?: string; ip?: string }, mfaAt: Date | null = null) {
    const refreshToken = randomBytes(32).toString('hex');
    const [row] = await this.db.insert(sessions).values({
      userId,
      tenantId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      mfaAt,
    }).returning({ id: sessions.id });
    return { refreshToken, sessionId: row.id };
  }

  private frontendUrl() {
    return this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }

  async issueFullSession(
    user: { id: string; email: string; role: string; tenantId: string | null; permissions?: string[] | null },
    meta: { userAgent?: string; ip?: string } = {},
    mfaAt: Date | null = null,
  ) {
    const { refreshToken, sessionId } = await this.issueSession(user.id, user.tenantId, meta, mfaAt);
    const accessToken = await this.signAccessToken(user, sessionId);
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const passwordIssue = isPasswordStrongEnough(dto.password);
    if (passwordIssue) throw new BadRequestException(passwordIssue);
    const email = dto.email.trim().toLowerCase();
    const attemptId = dto.signupAttemptId?.trim() || null;

    // A retry of an attempt that already made its center (the answer was
    // lost on the way): that center back, to the same e-mail and password.
    if (attemptId) {
      const replay = await this.replaySignup(attemptId, email, dto.password);
      if (replay) return replay;
    }

    // Quick answers before anything is written (the transaction below checks again).
    if (await this.db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } })) {
      throw new ConflictException({ code: 'EMAIL_USED', message: "Bu email allaqachon ro'yxatdan o'tgan" });
    }
    let subdomain = dto.subdomain?.trim().toLowerCase();
    if (subdomain) {
      if (await this.db.query.tenants.findFirst({ where: eq(tenants.subdomain, subdomain), columns: { id: true } })) {
        throw new ConflictException({ code: 'SUBDOMAIN_USED', message: 'Bu sub-domen band, boshqasini tanlang' });
      }
    } else {
      const baseSlug = dto.centerName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'center';
      subdomain = (await this.db.query.tenants.findFirst({ where: eq(tenants.subdomain, baseSlug), columns: { id: true } }))
        ? `${baseSlug}-${randomBytes(3).toString('hex')}`
        : baseSlug;
    }

    // The phone, confirmed with its code (a wrong guess is counted here, in
    // its own write); then what this phone may get: a free trial, a sign-up
    // without one (a center of it paid before), or nothing.
    let codeId: string | null = null;
    const phoneCheck = trialRules().phoneCheck;
    if (phoneCheck && !dto.phone) {
      throw new BadRequestException({ code: 'PHONE_REQUIRED', message: 'Telefon raqamingizni SMS kod bilan tasdiqlang' });
    }
    const signupPhone = dto.phone ? this.signupPhone.normalize(dto.phone) : null;
    // A phone whose trial was had says so first, before any code is looked at.
    const right = signupPhone ? await this.trialClaims.rightOf(signupPhone) : 'FREE_TRIAL';
    if (phoneCheck) {
      if (!dto.phoneCode || !attemptId) {
        throw new BadRequestException({ code: 'PHONE_REQUIRED', message: 'Telefon raqamingizni SMS kod bilan tasdiqlang' });
      }
      codeId = await this.signupPhone.verify(signupPhone!, dto.phoneCode, attemptId);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const verifyToken = randomBytes(32).toString('hex');
    const trialEndsAt = new Date();
    if (right === 'FREE_TRIAL') trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    // Everything the sign-up writes, or nothing: the code used, the center,
    // its owner, the membership and the phone's trial.
    let created: { tenant: typeof tenants.$inferSelect; user: typeof users.$inferSelect };
    try {
      created = await this.db.transaction(async (tx) => {
        if (codeId && !(await this.signupPhone.use(tx, codeId))) {
          throw new ConflictException({ code: 'CODE_USED', message: "Bu kod bilan ro'yxatdan o'tilgan. Tizimga kiring." });
        }
        const tenant = await this.createTenant(tx, {
          name: dto.centerName.trim(), subdomain: subdomain!, category: (dto.category as never) ?? 'BOSHQA', status: 'TRIAL', plan: 'STARTER',
          trialEndsAt, onboardingStep: 'PROFILE', signupPhone: right === 'FREE_TRIAL' ? signupPhone : null, signupAttemptId: attemptId,
        });
        const user = await this.createOwner(tx, {
          tenantId: tenant.id, email, passwordHash, fullName: dto.fullName.trim(), phone: signupPhone, role: 'OWNER', verifyTokenHash: hashToken(verifyToken),
        });
        await this.createMembership(tx, { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' });
        if (signupPhone) await this.claimTrial(tx, signupPhone, tenant.id, right);
        return { tenant, user };
      });
    } catch (err) {
      throw this.signupConflict(err) ?? err;
    }
    const { tenant, user } = created;

    // After the commit: a mail that fails does not undo the sign-up, and a
    // session that fails to open leaves an account that can sign in.
    this.email
      .send(
        user.email,
        "TalimCRM — emailingizni tasdiqlang",
        `Assalomu alaykum, ${user.fullName}!\n\nEmailingizni tasdiqlash uchun havolani oching:\n${this.frontendUrl()}/verify-email?token=${verifyToken}\n\nAgar ro'yxatdan o'tmagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.`,
      )
      .catch(() => undefined);
    const { accessToken, refreshToken } = await this.issueFullSession(
      { id: user.id, email: user.email, role: 'OWNER', tenantId: tenant.id, permissions: user.permissions || [] },
      {},
    );
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: 'OWNER', permissions: user.permissions || [], access: effectiveAccess('OWNER', null) },
      tenant: { ...tenant, signupPhone: undefined },
      onboardingStep: 'PROFILE',
    };
  }

  // The sign-up's writes, each its own step (tests make one of them fail).
  async createTenant(tx: Tx, values: typeof tenants.$inferInsert) {
    const [tenant] = await tx.insert(tenants).values(values).returning();
    return tenant;
  }

  async createOwner(tx: Tx, values: typeof users.$inferInsert) {
    const [user] = await tx.insert(users).values(values).returning();
    return user;
  }

  async createMembership(tx: Tx, values: typeof organizationMemberships.$inferInsert) {
    await tx.insert(organizationMemberships).values(values);
  }

  async claimTrial(tx: Tx, phone: string, tenantId: string, right: 'FREE_TRIAL' | 'NO_TRIAL') {
    await this.trialClaims.claim(tx, phone, tenantId, right);
  }

  /** Two sign-ups at once with the same e-mail, phone, address or attempt: the second gets a clear 409. */
  private signupConflict(err: unknown): ConflictException | null {
    const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const code = e.code ?? e.cause?.code;
    const constraint = e.constraint ?? e.cause?.constraint;
    if (code !== '23505') return null;
    if (constraint === 'users_email_idx') return new ConflictException({ code: 'EMAIL_USED', message: "Bu email allaqachon ro'yxatdan o'tgan" });
    if (constraint === 'tenants_subdomain_idx') return new ConflictException({ code: 'SUBDOMAIN_USED', message: 'Bu sub-domen band, boshqasini tanlang' });
    if (constraint === 'tenants_signup_phone_idx' || constraint === 'trial_claims_fingerprint_idx') {
      return new ConflictException({ code: 'PHONE_USED', message: "Bu raqam bilan bepul sinov allaqachon olingan. Tizimga kiring yoki tarif tanlang." });
    }
    if (constraint === 'tenants_signup_attempt_idx') return new ConflictException({ code: 'SIGNUP_ATTEMPT_USED', message: "Bu urinish bilan markaz allaqachon yaratilgan. Tizimga kiring." });
    return new ConflictException("Ma'lumotlar allaqachon band. Qaytadan urinib ko'ring.");
  }

  /** A retry of a finished sign-up attempt: its center, to the right e-mail and password only. */
  private async replaySignup(attemptId: string, email: string, password: string) {
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.signupAttemptId, attemptId) });
    if (!tenant) return null;
    const user = await this.db.query.users.findFirst({ where: and(eq(users.email, email), eq(users.tenantId, tenant.id)) });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new ConflictException({ code: 'SIGNUP_ATTEMPT_USED', message: "Bu urinish bilan markaz allaqachon yaratilgan. Tizimga kiring." });
    }
    const { accessToken, refreshToken } = await this.issueFullSession({ id: user.id, email: user.email, role: 'OWNER', tenantId: tenant.id, permissions: user.permissions || [] }, {});
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: 'OWNER', permissions: user.permissions || [], access: effectiveAccess('OWNER', null) },
      tenant: { ...tenant, signupPhone: undefined },
      onboardingStep: tenant.onboardingStep,
    };
  }

  /** Phones of centers made before trial claims existed (see TrialClaimsService). */
  backfillTrialClaims() {
    return this.trialClaims.backfill();
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
  ): Promise<{ role: string; permissions: string[]; access: string[]; tenant: typeof tenants.$inferSelect | null }> {
    if (user.role === 'SUPERADMIN') {
      const tenant = tenantId ? (await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })) ?? null : null;
      if (tenantId && !tenant) throw new NotFoundException('Markaz topilmadi');
      return { role: 'SUPERADMIN', permissions: ['*'], access: effectiveAccess('SUPERADMIN', null), tenant };
    }
    const rows = await this.db.query.organizationMemberships.findMany({ where: eq(organizationMemberships.userId, user.id) });
    if (!tenantId) {
      // No workspace: only an account that belongs to no center at all.
      if (rows.length > 0 || user.tenantId) throw new UnauthorizedException('Markaz tanlanmagan');
      return { role: user.role, permissions: user.permissions || [], access: [], tenant: null };
    }
    const membership = rows.find((m) => m.tenantId === tenantId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new UnauthorizedException("Siz ushbu markazga a'zo emassiz");
    }
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');
    return { role: membership.role, permissions: membership.permissions || [], access: effectiveAccess(membership.role, membership.access), tenant };
  }

  // After the password (and the 2FA code): one session, bound to a
  // workspace; several centers -> the caller picks one.
  // `mfaAt`: set when this sign-in passed two-step verification.
  private async completeLogin(user: typeof users.$inferSelect, meta: { userAgent?: string; ip?: string }, mfaAt: Date | null = null) {
    // Every sign-in to the platform admin account is told to its owner by
    // e-mail and kept in the audit log: a stolen password shows at once.
    if (user.role === 'SUPERADMIN') {
      const when = new Date().toISOString().replace('T', ' ').slice(0, 16);
      this.audit.log({ tenantId: null, userId: user.id, action: 'superadmin_login', entityType: 'user', entityId: user.id, meta: { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null } });
      void this.email.send(
        user.email,
        'TalimCRM: platforma admini hisobiga kirildi',
        [`Platforma admini hisobiga kirildi: ${when} (UTC).`, `IP: ${meta.ip ?? '-'}`, `Qurilma: ${meta.userAgent ?? '-'}`, '', "Agar bu siz bo'lmasangiz, darhol parolni almashtiring va barcha seanslarni yoping."].join('\n'),
      );
    }
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
        mfaAt,
      );
      return {
        twoFactorRequired: false as const,
        requiresWorkspaceSelection: false as const,
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, fullName: user.fullName, role: 'SUPERADMIN', permissions: ['*'], access: effectiveAccess('SUPERADMIN', null), twoFactorEnabled: user.twoFactorEnabled, twoFactorRequired: trialRules().superadmin2fa, sessionTwoFactor: mfaAt !== null },
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
        mfaAt,
      );
      return {
        twoFactorRequired: false as const,
        requiresWorkspaceSelection: memberships.length > 1,
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, fullName: user.fullName, role: m.role, permissions: m.permissions || [], access: effectiveAccess(m.role, m.access) },
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
      mfaAt,
    );

    return {
      twoFactorRequired: false as const,
      requiresWorkspaceSelection: false as const,
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, permissions: user.permissions || [], access: [] as string[] },
      tenant: null,
      workspaces: [],
    };
  }

  // ---- Moving a session to the center's own address ----
  // The app on <center>.<domain> is a different site for the browser, so the
  // login does not follow. A signed-in user asks for a one-time code, the
  // browser carries it in the URL fragment, and the other address exchanges
  // it for its own session. 60 seconds, single use, stored hashed.

  async createHandoff(userId: string, tenantId: string | null, sid?: string) {
    if (!tenantId) throw new BadRequestException('Markaz tanlanmagan');
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException('Foydalanuvchi topilmadi');
    // Only for a workspace the caller really works in right now.
    const { tenant } = await this.resolveWorkspace(user, tenantId);
    const code = randomBytes(32).toString('hex');
    await this.db.delete(authHandoffCodes).where(lt(authHandoffCodes.expiresAt, new Date()));
    await this.db.insert(authHandoffCodes).values({ codeHash: hashToken(code), userId, tenantId: tenant!.id, mfaAt: await this.sessionMfaAt(userId, sid), expiresAt: new Date(Date.now() + 60_000) });
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
    return this.selectWorkspace(row.userId, row.tenantId, meta, undefined, row.mfaAt ?? null);
  }

  /** The session passed 2FA, and after the account's factor last changed. */
  async sessionIsVerified(user: { id: string; twoFactorEnabled: boolean; twoFactorChangedAt: Date | null }, sid?: string | null) {
    if (!user.twoFactorEnabled) return false;
    const at = await this.sessionMfaAt(user.id, sid);
    return !!at && (!user.twoFactorChangedAt || at >= user.twoFactorChangedAt);
  }

  /** When the caller's own session passed 2FA (null: it did not, or no session). */
  async sessionMfaAt(userId: string, sid?: string | null): Promise<Date | null> {
    if (!sid) return null;
    const [s] = await this.db.select({ mfaAt: sessions.mfaAt }).from(sessions).where(and(eq(sessions.id, sid), eq(sessions.userId, userId)));
    return s?.mfaAt ?? null;
  }

  // Opens `targetTenantId` for the user. With the caller's refresh token the
  // same session is re-bound to the workspace (and rotated); without one a
  // new session is opened. Either way the answer carries a refresh token
  // that keeps this workspace.
  // `mfaAt`: the 2FA state a new session starts with (the caller's own;
  // a re-bound session keeps what it had).
  async selectWorkspace(userId: string, targetTenantId: string, meta: { userAgent?: string; ip?: string }, currentRefreshToken?: string, mfaAt: Date | null = null) {
    if (!targetTenantId || typeof targetTenantId !== 'string') throw new BadRequestException('Markaz tanlanmagan');
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException('Foydalanuvchi topilmadi');

    const { role, permissions, access, tenant } = await this.resolveWorkspace(user, targetTenantId);
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

    let refreshToken: string | null = null;
    let sessionId: string | null = null;
    if (typeof currentRefreshToken === 'string' && currentRefreshToken) {
      const rotated = randomBytes(32).toString('hex');
      const [updated] = await this.db
        .update(sessions)
        .set({ tenantId: tenant.id, refreshTokenHash: hashToken(rotated), lastUsedAt: new Date(), userAgent: meta.userAgent, ip: meta.ip })
        .where(and(eq(sessions.refreshTokenHash, hashToken(currentRefreshToken)), eq(sessions.userId, user.id)))
        .returning({ id: sessions.id });
      if (updated) {
        refreshToken = rotated;
        sessionId = updated.id;
      }
    }
    if (!refreshToken || !sessionId) ({ refreshToken, sessionId } = await this.issueSession(user.id, tenant.id, meta, mfaAt));
    const accessToken = await this.signAccessToken({ id: user.id, email: user.email, role, tenantId: tenant.id, permissions }, sessionId);

    return {
      accessToken,
      refreshToken,
      tenant,
      role,
      permissions,
      user: { id: user.id, email: user.email, fullName: user.fullName, role, permissions, access },
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
    if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) throw new UnauthorizedException();

    // The active key, or one of the recovery codes (used up). A key still
    // pending confirmation opens nothing.
    if (!(await this.checkFactor(user, code))) throw new UnauthorizedException("Kod noto'g'ri");

    // Same as a password login from here: membership role, and the
    // workspace choice when there are several. This session passed 2FA.
    return this.completeLogin(user, meta, new Date());
  }

  /** The active TOTP key, or a recovery code (removed in the same step, so it works once). */
  private async checkFactor(user: typeof users.$inferSelect, rawCode: string): Promise<boolean> {
    const code = String(rawCode ?? '').trim().toLowerCase();
    if (RECOVERY_CODE.test(code)) {
      const hash = hashToken(code);
      const [used] = await this.db
        .update(users)
        .set({ twoFactorRecoveryHashes: sql`array_remove(${users.twoFactorRecoveryHashes}, ${hash})` })
        .where(and(eq(users.id, user.id), sql`${hash} = any(${users.twoFactorRecoveryHashes})`))
        .returning({ id: users.id });
      return !!used;
    }
    if (!user.twoFactorSecret || !/^\d{6}$/.test(code)) return false;
    return (await verifyTotp({ secret: user.twoFactorSecret, token: code, epochTolerance: TOTP_TOLERANCE })).valid;
  }

  /** Password and the current factor: what replacing or removing a factor asks for. */
  private async reauthenticate(user: typeof users.$inferSelect, password: string | undefined, code: string | undefined) {
    const passwordOk = typeof password === 'string' && password.length > 0 && (await bcrypt.compare(password, user.passwordHash));
    const factorOk = passwordOk && typeof code === 'string' && (await this.checkFactor(user, code));
    if (!passwordOk || !factorOk) {
      throw new ForbiddenException({ code: 'REAUTH_REQUIRED', message: "Parolingizni va joriy 2FA kodini (yoki tiklash kodini) kiriting" });
    }
  }

  // ---- Two-factor setup (TOTP, authenticator app — no external account needed) ----

  // A new key is only pending: the active one (if any) stays until the new
  // one is confirmed. With 2FA already on, replacing it needs the password
  // and the current factor (or a recovery code), not just a session.
  async setupTwoFactor(userId: string, dto: { password?: string; code?: string } = {}) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException();
    if (user.twoFactorEnabled) await this.reauthenticate(user, dto.password, dto.code);
    const secret = generateTotpSecret();
    const expiresAt = new Date(Date.now() + PENDING_2FA_MS);
    await this.db.update(users).set({ twoFactorPendingSecret: secret, twoFactorPendingExpiresAt: expiresAt }).where(eq(users.id, userId));
    const otpauth = generateTotpUri({ issuer: 'TalimCRM', label: user.email, secret });
    const qrDataUrl = await qrcode.toDataURL(otpauth);
    return { secret, qrDataUrl, expiresAt };
  }

  // The pending key becomes the active one, once: new recovery codes (shown
  // only now), every other session of the account ends, and this session -
  // which just proved the new factor - counts as verified.
  async confirmTwoFactor(userId: string, code: string, sid?: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    const pending = user?.twoFactorPendingSecret;
    if (!user || !pending || !user.twoFactorPendingExpiresAt || user.twoFactorPendingExpiresAt < new Date()) {
      throw new BadRequestException("Tasdiqlanadigan yangi kalit yo'q yoki muddati tugagan. Qaytadan boshlang.");
    }
    if (!/^\d{6}$/.test(String(code ?? '').trim()) || !(await verifyTotp({ secret: pending, token: String(code).trim(), epochTolerance: TOTP_TOLERANCE })).valid) {
      throw new BadRequestException("Kod noto'g'ri");
    }
    const now = new Date();
    const { codes, hashes } = newRecoveryCodes();
    await this.db.transaction(async (tx) => {
      const [done] = await tx
        .update(users)
        .set({ twoFactorSecret: pending, twoFactorEnabled: true, twoFactorPendingSecret: null, twoFactorPendingExpiresAt: null, twoFactorChangedAt: now, twoFactorRecoveryHashes: hashes })
        .where(and(eq(users.id, userId), eq(users.twoFactorPendingSecret, pending)))
        .returning({ id: users.id });
      if (!done) throw new BadRequestException("Tasdiqlanadigan yangi kalit yo'q yoki muddati tugagan. Qaytadan boshlang.");
      await tx.delete(sessions).where(sid ? and(eq(sessions.userId, userId), ne(sessions.id, sid)) : eq(sessions.userId, userId));
      if (sid) await tx.update(sessions).set({ mfaAt: now }).where(and(eq(sessions.id, sid), eq(sessions.userId, userId)));
    });
    this.audit.log({ tenantId: null, userId, action: user.twoFactorEnabled ? '2fa_replaced' : '2fa_enabled', entityType: 'user', entityId: userId });
    return { message: '2FA yoqildi.', recoveryCodes: codes };
  }

  async disableTwoFactor(userId: string, dto: { password?: string; code?: string }, sid?: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user?.twoFactorSecret || !user.twoFactorEnabled) throw new BadRequestException("2FA yoqilmagan");
    await this.reauthenticate(user, dto.password, dto.code);
    await this.db.transaction(async (tx) => {
      await tx.update(users)
        .set({ twoFactorEnabled: false, twoFactorSecret: null, twoFactorPendingSecret: null, twoFactorPendingExpiresAt: null, twoFactorRecoveryHashes: null, twoFactorChangedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.delete(sessions).where(sid ? and(eq(sessions.userId, userId), ne(sessions.id, sid)) : eq(sessions.userId, userId));
    });
    this.audit.log({ tenantId: null, userId, action: '2fa_disabled', entityType: 'user', entityId: userId });
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
    }, session.id);
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
    const removed = await this.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    // Someone else's session (or one already ended) is not "revoked" by us.
    if (removed.length === 0) throw new NotFoundException('Sessiya topilmadi');
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
  async me(userId: string, tenantId: string | null = null, sid?: string) {
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
        // What this member may do (access/catalog.ts keys), for the screens.
        access: ws.access,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        // The platform pages stay closed until two-step sign-in is on.
        twoFactorRequired: ws.role === 'SUPERADMIN' && trialRules().superadmin2fa,
        // Whether this very session passed 2FA (after the factor's last change).
        sessionTwoFactor: await this.sessionIsVerified(user, sid),
      },
      // Where a center on its free trial stands (the app shows the plans
      // once it is locked); the sign-up phone stays on the server.
      tenant: ws.tenant ? { ...ws.tenant, signupPhone: undefined, trial: trialStage(ws.tenant), billing: billingOf(ws.tenant) } : ws.tenant,
    };
  }
}

/** The paid period as the app shows it: until when, and how long a past-due center keeps working. */
function billingOf(t: { paidUntil?: Date | null; suspendedReason?: string | null }) {
  if (!t.paidUntil) return { paidUntil: null, graceUntil: null, suspendedForNonPayment: t.suspendedReason === 'NON_PAYMENT' };
  const graceUntil = new Date(t.paidUntil.getTime() + billingRules().graceDays * 86_400_000);
  return { paidUntil: t.paidUntil, graceUntil, suspendedForNonPayment: t.suspendedReason === 'NON_PAYMENT' };
}
