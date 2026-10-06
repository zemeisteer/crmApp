import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { studentPortalPins, students } from '../db/schema';

@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: Database,
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
      // A cabinet token is good only while the student is on the center's
      // books, and a newly issued PIN signs every cabinet opened before it
      // out (the way to end a leaked or shared session).
      const [row] = await this.db
        .select({ id: students.id, pinUpdatedAt: studentPortalPins.updatedAt })
        .from(students)
        .leftJoin(studentPortalPins, eq(studentPortalPins.studentId, students.id))
        .where(and(eq(students.id, payload.studentId), eq(students.tenantId, payload.tenantId), isNull(students.deletedAt)));
      if (!row) throw new UnauthorizedException("O'quvchi topilmadi");
      if (row.pinUpdatedAt && typeof payload.iat === 'number' && payload.iat < Math.floor(row.pinUpdatedAt.getTime() / 1000)) {
        throw new UnauthorizedException('PIN yangilangan, qaytadan kiring');
      }
      req.portalUser = {
        studentId: payload.studentId,
        tenantId: payload.tenantId,
        fullName: payload.fullName,
        viewer: payload.viewer === 'parent' ? 'parent' : 'student',
      };
      return true;
    } catch {
      throw new UnauthorizedException('Portal sessiyasi eskirgan yoki xato');
    }
  }
}
