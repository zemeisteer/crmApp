import { CallHandler, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import { Observable } from 'rxjs';
import { DB, Database } from '../db/db.module';
import { tenants, trialAiUsage } from '../db/schema';
import { routeIdOf } from '../common/route-id';
import { DEFAULT_TIMEZONE, zonedParts } from '../common/timezone';
import { trialRules, trialStage } from './trial-rules';

const USES_AI = 'usesAi';
/** The handler asks the AI: a center on its free trial has a daily allowance. */
export const UsesAi = () => SetMetadata(USES_AI, true);

/**
 * What an expired trial may still reach: signing in and out, its own data to
 * take away or delete, and the plans and the payment for one. Everything else
 * is closed once the read-only days are over (writes are closed from the day
 * the trial ends).
 */
const ALWAYS_OPEN = [
  /^[A-Z]+ \/api\/auth\//,
  /^GET \/api\/plans(\/public)?$/,
  /^POST \/api\/platform-billing\/(click|payme)\/link$/,
  /^GET \/api\/tenants\/me\/export$/,
  /^DELETE \/api\/tenants\/me$/,
];

/**
 * Runs after the guards, so the signed-in member is known:
 * - a trial that ended: read-only for TRIAL_READONLY_DAYS, then only the
 *   routes above (403 TRIAL_READ_ONLY / TRIAL_LOCKED; the app shows the plans);
 * - an AI request of a center on its trial: counted per day of the center,
 *   refused past TRIAL_AI_PER_DAY (429 TRIAL_AI_LIMIT).
 * The platform admin, and student and parent cabinets, are not concerned.
 */
@Injectable()
export class TrialInterceptor implements NestInterceptor {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ method: string; user?: { tenantId?: string | null; role?: string; studentId?: string } }>();
    const user = req.user;
    if (!user?.tenantId || user.role === 'SUPERADMIN' || user.studentId) return next.handle();

    const [tenant] = await this.db
      .select({ status: tenants.status, trialEndsAt: tenants.trialEndsAt, tz: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId));
    if (!tenant || tenant.status !== 'TRIAL') return next.handle();

    const rules = trialRules();
    const { stage } = trialStage(tenant, new Date(), rules);
    const route = routeIdOf(context) ?? `${req.method} ?`;
    const open = ALWAYS_OPEN.some((r) => r.test(route));
    if (stage === 'LOCKED' && !open) {
      throw new ForbiddenException({ code: 'TRIAL_LOCKED', message: "Sinov muddati tugagan. Markazdan foydalanishni davom ettirish uchun tarifni faollashtiring." });
    }
    if (stage === 'READ_ONLY' && req.method !== 'GET' && !open) {
      throw new ForbiddenException({ code: 'TRIAL_READ_ONLY', message: "Sinov muddati tugagan: ma'lumotlarni ko'rish mumkin, o'zgartirish uchun tarifni faollashtiring." });
    }

    const usesAi = this.reflector.getAllAndOverride<boolean>(USES_AI, [context.getHandler(), context.getClass()]);
    if (usesAi && stage === 'TRIAL' && rules.limits) {
      const p = zonedParts(new Date(), tenant.tz || DEFAULT_TIMEZONE);
      const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      const [row] = await this.db
        .insert(trialAiUsage)
        .values({ tenantId: user.tenantId, day, count: 1 })
        .onConflictDoUpdate({ target: [trialAiUsage.tenantId, trialAiUsage.day], set: { count: sql`${trialAiUsage.count} + 1` } })
        .returning({ count: trialAiUsage.count });
      if (row.count > rules.aiPerDay) {
        throw new HttpException(
          { code: 'TRIAL_AI_LIMIT', message: `Sinov davrida kuniga ${rules.aiPerDay} ta AI so'rov mumkin. Ertaga davom eting yoki tarifni faollashtiring.` },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return next.handle();
  }
}
