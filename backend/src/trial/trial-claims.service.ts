import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHmac } from 'crypto';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { platformSubscriptions, tenants, trialClaims } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../leads/phone';

type Exec = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

/**
 * "One phone, one free trial", kept apart from the centers: a trial a phone
 * had stays had after its center is deleted (by the owner, the platform or
 * the clean-up of unpaid trials). Only a keyed fingerprint of the number is
 * stored (TRIAL_PHONE_KEY, else JWT_SECRET - keep it once set: another key
 * makes old fingerprints unrecognisable).
 *
 * - A phone never seen: a free trial.
 * - Seen, and a center of it paid the platform: it may sign up again, without
 *   a new free trial (the center starts with the plans page).
 * - Seen, unpaid: refused (PHONE_USED).
 * - Released by the platform admin (audited, with a reason): a free trial again.
 */
@Injectable()
export class TrialClaimsService implements OnModuleInit {
  private readonly logger = new Logger(TrialClaimsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    // Phones of centers made before the claims existed count as used too.
    try {
      const added = await this.backfill();
      if (added) this.logger.log(`Recorded the trial of ${added} earlier sign-up phone(s)`);
    } catch (err) {
      this.logger.warn(`Trial claims backfill failed: ${(err as Error).message}`);
    }
  }

  fingerprint(rawPhone: string): string {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new ConflictException({ code: 'PHONE_INVALID', message: "Telefon raqami noto'g'ri" });
    const key = process.env.TRIAL_PHONE_KEY?.trim() || process.env.JWT_SECRET || 'talimcrm-trial';
    return createHmac('sha256', key).update(phone).digest('hex');
  }

  /** What a sign-up with this phone may get: a free trial, a sign-up without one, or nothing. */
  async rightOf(rawPhone: string, db: Exec = this.db): Promise<'FREE_TRIAL' | 'NO_TRIAL'> {
    const fp = this.fingerprint(rawPhone);
    const [claim] = await db.select().from(trialClaims).where(eq(trialClaims.phoneFingerprint, fp));
    if (!claim || claim.releasedAt) return 'FREE_TRIAL';
    if (claim.paidAt || (await this.anyPaid(db, [claim.firstTenantId, claim.lastTenantId]))) return 'NO_TRIAL';
    throw new ConflictException({ code: 'PHONE_USED', message: "Bu raqam bilan bepul sinov allaqachon olingan. Tizimga kiring yoki tarif tanlang." });
  }

  /**
   * Records the sign-up in the same transaction as the center. Two sign-ups
   * of one phone at once: the unique fingerprint lets one through.
   */
  async claim(tx: Exec, rawPhone: string, tenantId: string, right: 'FREE_TRIAL' | 'NO_TRIAL') {
    const fp = this.fingerprint(rawPhone);
    if (right === 'NO_TRIAL') {
      await tx.update(trialClaims).set({ lastTenantId: tenantId }).where(eq(trialClaims.phoneFingerprint, fp));
      return;
    }
    // A released claim is taken again (once); otherwise a new one.
    const [reused] = await tx
      .update(trialClaims)
      .set({ releasedAt: null, releasedBy: null, releaseReason: null, paidAt: null, firstTenantId: tenantId, lastTenantId: tenantId, claimedAt: new Date() })
      .where(and(eq(trialClaims.phoneFingerprint, fp), isNotNull(trialClaims.releasedAt)))
      .returning({ id: trialClaims.id });
    if (reused) return;
    await tx.insert(trialClaims).values({ phoneFingerprint: fp, firstTenantId: tenantId, lastTenantId: tenantId });
  }

  /**
   * Before a center is deleted: if it paid the platform, its phone keeps the
   * right to sign up again (the payments go with the center).
   */
  async noteBeforeDelete(db: Exec, tenantId: string) {
    if (!(await this.anyPaid(db, [tenantId]))) return;
    await db
      .update(trialClaims)
      .set({ paidAt: sql`coalesce(${trialClaims.paidAt}, now())` })
      .where(or(eq(trialClaims.firstTenantId, tenantId), eq(trialClaims.lastTenantId, tenantId)));
  }

  /** The platform admin gives a phone its free trial back: audited, with a reason. */
  async release(rawPhone: string, reason: string, actorUserId: string) {
    const fp = this.fingerprint(rawPhone);
    const [row] = await this.db
      .update(trialClaims)
      .set({ releasedAt: new Date(), releasedBy: actorUserId, releaseReason: reason.trim() })
      .where(and(eq(trialClaims.phoneFingerprint, fp), isNull(trialClaims.releasedAt)))
      .returning({ id: trialClaims.id });
    if (!row) throw new NotFoundException("Bu raqam uchun ishlatilgan sinov topilmadi");
    // The fingerprint's start only: enough to find the row, never the number.
    this.audit.log({ tenantId: null, userId: actorUserId, action: 'trial_claim_released', entityType: 'trial_claim', entityId: row.id, meta: { fingerprint: fp.slice(0, 12), reason: reason.trim() } });
    return { released: true };
  }

  async backfill(): Promise<number> {
    const legacy = await this.db.select({ id: tenants.id, phone: tenants.signupPhone }).from(tenants).where(isNotNull(tenants.signupPhone));
    let added = 0;
    for (const t of legacy) {
      const rows = await this.db
        .insert(trialClaims)
        .values({ phoneFingerprint: this.fingerprint(t.phone!), firstTenantId: t.id, lastTenantId: t.id })
        .onConflictDoNothing()
        .returning({ id: trialClaims.id });
      added += rows.length;
    }
    return added;
  }

  private async anyPaid(db: Exec, tenantIds: Array<string | null>): Promise<boolean> {
    const ids = tenantIds.filter((x): x is string => !!x);
    if (ids.length === 0) return false;
    const [paid] = await db
      .select({ id: platformSubscriptions.id })
      .from(platformSubscriptions)
      .where(and(inArray(platformSubscriptions.tenantId, ids), eq(platformSubscriptions.status, 'PAID')))
      .limit(1);
    return !!paid;
  }
}
