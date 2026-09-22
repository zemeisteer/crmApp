import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DB, Database } from '../db/db.module';
import { users } from '../db/schema';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';

@Injectable()
export class StaffService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string) {
    return this.db.query.users.findMany({
      where: eq(users.tenantId, tenantId),
      columns: { id: true, email: true, fullName: true, role: true, permissions: true, createdAt: true },
      orderBy: (u, { asc }) => asc(u.createdAt),
    });
  }

  async create(tenantId: string, dto: CreateStaffDto) {
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, dto.email) });
    if (existing) throw new ConflictException("Bu email allaqachon ro'yxatdan o'tgan");
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const [user] = await this.db
      .insert(users)
      .values({
        tenantId,
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        role: dto.role as any,
        permissions: dto.permissions || [],
        emailVerified: true,
      })
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        permissions: users.permissions,
        createdAt: users.createdAt,
      });
    return user;
  }

  async update(tenantId: string, id: string, dto: UpdateStaffDto) {
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (dto.role !== undefined) patch.role = dto.role as any;
    if (dto.permissions !== undefined) patch.permissions = dto.permissions;

    const [user] = await this.db
      .update(users)
      .set(patch)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        permissions: users.permissions,
        createdAt: users.createdAt,
      });
    if (!user) throw new NotFoundException('Xodim topilmadi');
    return user;
  }

  async remove(tenantId: string, id: string, requesterId: string) {
    if (id === requesterId) throw new BadRequestException("O'zingizni o'chira olmaysiz");
    const target = await this.db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.tenantId, tenantId)) });
    if (!target) throw new NotFoundException('Xodim topilmadi');
    if (target.role === 'ADMIN') {
      const adminCount = await this.db.query.users.findMany({ where: and(eq(users.tenantId, tenantId), eq(users.role, 'ADMIN')) });
      if (adminCount.length <= 1) throw new BadRequestException("Markazda kamida bitta administrator qolishi kerak");
    }
    await this.db.delete(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
    return { success: true };
  }
}
