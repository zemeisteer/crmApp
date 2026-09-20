import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenants } from '../db/schema';
import { JwtPayload } from './jwt.strategy';

// Blocks writes (non-GET) from a tenant whose trial has lapsed or whose
// account is suspended. Superadmins and unauthenticated/public routes pass
// through untouched — this only fires once a tenant-scoped user is present.
@Injectable()
export class TrialGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.method === 'GET') return true;

    const user: JwtPayload | undefined = req.user;
    if (!user || !user.tenantId || user.role === 'SUPERADMIN') return true;

    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
    if (!tenant) return true;

    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException("Markazingiz to'xtatilgan. Administrator bilan bog'laning.");
    }
    if (tenant.status === 'TRIAL' && tenant.trialEndsAt && new Date(tenant.trialEndsAt) < new Date()) {
      throw new ForbiddenException("Sinov muddati tugagan. Davom etish uchun tarifni faollashtiring.");
    }
    return true;
  }
}
