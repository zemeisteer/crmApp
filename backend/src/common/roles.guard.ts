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
    if (!requiredRoles || requiredRoles.length === 0) return !user || rolesAllow(user.role, requiredRoles);
    if (!user) return false;
    return rolesAllow(user.role, requiredRoles);
  }
}

/**
 * The rule itself, for a signed-in role (also used by the access matrix, so
 * the matrix is the guard's own answer):
 * - no @Roles: staff back-office; students and parents (who use the
 *   /portal API) must be let in explicitly, so a forgotten @Roles can never
 *   expose center-wide data to them;
 * - SUPERADMIN: everything; OWNER: whatever ADMIN or OWNER may.
 */
export function rolesAllow(role: string, requiredRoles: string[] | undefined): boolean {
  if (!requiredRoles || requiredRoles.length === 0) return !END_USER_ROLES.includes(role);
  if (role === 'SUPERADMIN') return true;
  if (role === 'OWNER' && (requiredRoles.includes('ADMIN') || requiredRoles.includes('OWNER'))) return true;
  return requiredRoles.includes(role);
}
