import { ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

const join = (...parts: Array<string | string[] | undefined>) =>
  '/' + parts.flatMap((p) => (Array.isArray(p) ? p[0] : p) ?? '').map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

/** "GET /api/students/:id" for a handler: its declared route, as the access catalog names it. */
export function routeId(controller: object, handler: object): string | null {
  const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
  if (path === undefined || method === undefined) return null;
  return `${RequestMethod[method]} ${join('api', Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined, path)}`;
}

export function routeIdOf(context: ExecutionContext): string | null {
  return routeId(context.getClass(), context.getHandler());
}
