import { Injectable } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { routeId } from '../common/route-id';
import { ROLES_KEY } from '../common/roles.decorator';
import { PERMISSIONS_KEY } from '../common/permissions.decorator';
import { RolesGuard, rolesAllow } from '../common/roles.guard';
import { PermissionsGuard, permissionsAllow } from '../common/permissions.guard';

export interface RouteAccess {
  method: string; // GET, POST...
  path: string; // /api/... with :params
  roles?: string[];
  permissions?: string[];
  rolesGuard: boolean;
  permissionsGuard: boolean;
}

/**
 * Every HTTP route of the application with its @Roles / @RequirePermissions
 * and the guards in front of it, read from the running app's own metadata -
 * so what the access matrix says is what the guards do.
 */
@Injectable()
export class RouteAccessService {
  private cache: RouteAccess[] | null = null;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  routes(): RouteAccess[] {
    if (this.cache) return this.cache;
    const out: RouteAccess[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, metatype) as unknown[] | undefined) ?? [];
      const proto = Object.getPrototypeOf(instance);
      for (const name of this.scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        const id = routeId(metatype, handler);
        if (!id) continue;
        const [method, path] = id.split(' ');
        const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [])];
        out.push({
          method,
          path,
          roles: this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, metatype]),
          permissions: this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [handler, metatype]),
          rolesGuard: guards.includes(RolesGuard),
          permissionsGuard: guards.includes(PermissionsGuard),
        });
      }
    }
    this.cache = out;
    return out;
  }

  find(method: string, path: string) {
    return this.routes().find((r) => r.method === method && r.path === path) ?? null;
  }

  /** Whether `role` (with no extra permissions) passes this route's role checks. */
  static allows(route: RouteAccess, role: string) {
    if (route.rolesGuard && !rolesAllow(role, route.roles)) return false;
    if (route.permissionsGuard && !permissionsAllow(role, route.permissions)) return false;
    return true;
  }
}
