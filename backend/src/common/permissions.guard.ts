import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { getEffectivePermissions } from './permissions';
import { END_USER_ROLES } from './roles.guard';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const { user } = context.switchToHttp().getRequest();
    if (!requiredPermissions || requiredPermissions.length === 0) return !user || permissionsAllow(user.role, requiredPermissions);
    if (!user) return false;
    if (!permissionsAllow(user.role, requiredPermissions, user.permissions)) {
      throw new ForbiddenException("Sizda ushbu amalni bajarish uchun ruxsat yo'q");
    }
    return true;
  }
}

/**
 * The rule itself (also used by the access matrix): no @RequirePermissions
 * is back-office only, like RolesGuard; SUPERADMIN and ADMIN have every
 * permission; others need all the listed ones (role defaults plus the
 * staff member's own extra permissions).
 */
export function permissionsAllow(role: string, required: string[] | undefined, custom?: string[] | null): boolean {
  if (!required || required.length === 0) return !END_USER_ROLES.includes(role);
  if (role === 'SUPERADMIN' || role === 'ADMIN') return true;
  const effective = getEffectivePermissions(role, custom);
  return required.every((perm) => effective.includes(perm));
}
