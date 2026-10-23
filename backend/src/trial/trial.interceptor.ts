import { CallHandler, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { DB, Database } from '../db/db.module';
import { tenants } from '../db/schema';
import { routeIdOf } from '../common/route-id';
import { trialRules } from './trial-rules';
import { centerAccess, centerState } from './trial-access';
import { chargeTrialAi, refundTrialAi } from './trial-limits';

const USES_AI = 'usesAi';
/** The handler asks the AI: a center on its free trial has a daily allowance. */
export const UsesAi = () => SetMetadata(USES_AI, true);

/**
 * Runs after the guards, so the signed-in member is known:
 * - what the center's state allows, for every route (the table in
 *   trial-access.ts: a trial that ended is read-only for
 *   TRIAL_READONLY_DAYS, then only sign-in, plans, payment and export are
 *   open; a suspended center reads only; 403 TRIAL_READ_ONLY / TRIAL_LOCKED /
 *   CENTER_SUSPENDED - the app shows the plans);
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
    if (!tenant) return next.handle();

    const rules = trialRules();
    const refusal = centerAccess(tenant, req.method, routeIdOf(context) ?? `${req.method} ?`, new Date(), rules);
    if (refusal) throw new ForbiddenException(refusal);

    const usesAi = this.reflector.getAllAndOverride<boolean>(USES_AI, [context.getHandler(), context.getClass()]);
    if (usesAi && centerState(tenant, new Date(), rules) === 'TRIAL') {
      if (!(await chargeTrialAi(this.db, user.tenantId, tenant.tz))) {
        throw new HttpException(
          { code: 'TRIAL_AI_LIMIT', message: `Sinov davrida kuniga ${rules.aiPerDay} ta AI so'rov mumkin. Ertaga davom eting yoki tarifni faollashtiring.` },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // No answer, no charge: a failed request gives its place back.
      const tenantId = user.tenantId;
      return next.handle().pipe(
        catchError((err: unknown) => from(refundTrialAi(this.db, tenantId, tenant.tz).catch(() => undefined)).pipe(mergeMap(() => throwError(() => err)))),
      );
    }
    return next.handle();
  }
}
