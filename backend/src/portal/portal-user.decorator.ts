import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface PortalUserPayload {
  studentId: string;
  tenantId: string;
  fullName: string;
  // 'parent' when signed in with the parent's phone or a PARENT account.
  viewer: 'student' | 'parent';
  // Set when the cabinet was opened from a parent's account.
  parentUserId?: string;
  // When the token was issued (seconds), for streams that re-check later.
  iat?: number;
}

export const PortalUser = createParamDecorator(
  (data: keyof PortalUserPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user: PortalUserPayload = req.portalUser;
    return data ? user?.[data] : user;
  },
);
