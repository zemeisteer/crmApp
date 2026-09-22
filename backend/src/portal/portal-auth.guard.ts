import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Portal sessiyasi mavjud emas');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      if (!payload.studentId || !payload.tenantId) {
        throw new UnauthorizedException('Yaroqsiz portal foydalanuvchisi');
      }
      req.portalUser = {
        studentId: payload.studentId,
        tenantId: payload.tenantId,
        fullName: payload.fullName,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Portal sessiyasi eskirgan yoki xato');
    }
  }
}
