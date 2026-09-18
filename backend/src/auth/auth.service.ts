import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { tenants, users } from '../db/schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  private async signToken(user: {
    id: string;
    email: string;
    role: string;
    tenantId: string | null;
  }) {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });
  }

  async register(dto: RegisterDto) {
    const existingSubdomain = await this.db.query.tenants.findFirst({
      where: eq(tenants.subdomain, dto.subdomain),
    });
    if (existingSubdomain) {
      throw new ConflictException('Bu sub-domen band, boshqasini tanlang');
    }
    const existingEmail = await this.db.query.users.findFirst({
      where: eq(users.email, dto.email),
    });
    if (existingEmail) {
      throw new ConflictException('Bu email allaqachon ro\'yxatdan o\'tgan');
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const [tenant] = await this.db
      .insert(tenants)
      .values({
        name: dto.centerName,
        subdomain: dto.subdomain,
        status: 'TRIAL',
        plan: 'STARTER',
        trialEndsAt,
      })
      .returning();

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const [user] = await this.db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        role: 'ADMIN',
      })
      .returning();

    const accessToken = await this.signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: tenant.id,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      tenant,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, dto.email),
    });
    if (!user) throw new UnauthorizedException('Email yoki parol noto\'g\'ri');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Email yoki parol noto\'g\'ri');

    let tenant: typeof tenants.$inferSelect | null = null;
    if (user.tenantId) {
      tenant = (await this.db.query.tenants.findFirst({
        where: eq(tenants.id, user.tenantId),
      })) ?? null;
    }

    const accessToken = await this.signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      tenant,
    };
  }

  async me(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new UnauthorizedException();
    let tenant: typeof tenants.$inferSelect | null = null;
    if (user.tenantId) {
      tenant = (await this.db.query.tenants.findFirst({
        where: eq(tenants.id, user.tenantId),
      })) ?? null;
    }
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      tenant,
    };
  }
}
