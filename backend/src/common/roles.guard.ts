import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

export const END_USER_ROLES = ['STUDENT', 'PARENT'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles || requiredRoles.length === 0) {
      // Routes without @Roles are staff back-office endpoints. Students and
      // parents (who use the /portal API) must be let in explicitly, so a
      // forgotten @Roles can never expose center-wide data to them.
      return !user || !END_USER_ROLES.includes(user.role);
    }
    if (!user) return false;
    if (user.role === 'SUPERADMIN') return true;
    if (user.role === 'OWNER' && (requiredRoles.includes('ADMIN') || requiredRoles.includes('OWNER'))) return true;
    return requiredRoles.includes(user.role);
  }
}
