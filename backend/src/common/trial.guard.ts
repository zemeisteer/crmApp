import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenants } from '../db/schema';
import { centerAccess } from '../trial/trial-access';
import { JwtPayload } from './jwt.strategy';
import { routeIdOf } from './route-id';

// Refuses what the center's state does not allow (trial over, suspended)
// before the handler's pipes run. The answer comes from the one table in
// trial/trial-access.ts - the same TrialInterceptor gives every route.
// Superadmins and unauthenticated/public routes pass through untouched.
@Injectable()
export class TrialGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = req.user;
    if (!user || !user.tenantId || user.role === 'SUPERADMIN') return true;

    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
    if (!tenant) return true;

    const refusal = centerAccess(tenant, req.method, routeIdOf(context) ?? `${req.method} ?`);
    if (refusal) throw new ForbiddenException(refusal);
    return true;
  }
}
