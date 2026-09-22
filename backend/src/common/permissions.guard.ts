import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { getEffectivePermissions } from './permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // SUPERADMIN and ADMIN automatically have all permissions
    if (user.role === 'SUPERADMIN' || user.role === 'ADMIN') {
      return true;
    }

    const effective = getEffectivePermissions(user.role, user.permissions);
    const hasAll = requiredPermissions.every((perm) => effective.includes(perm));

    if (!hasAll) {
      throw new ForbiddenException("Sizda ushbu amalni bajarish uchun ruxsat yo'q");
    }

    return true;
  }
}
