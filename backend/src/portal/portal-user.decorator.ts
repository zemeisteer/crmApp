import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface PortalUserPayload {
  studentId: string;
  tenantId: string;
  fullName: string;
}

export const PortalUser = createParamDecorator(
  (data: keyof PortalUserPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user: PortalUserPayload = req.portalUser;
    return data ? user?.[data] : user;
  },
);
