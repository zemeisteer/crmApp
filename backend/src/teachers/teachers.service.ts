import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { teachers } from '../db/schema';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teacher.dto';

@Injectable()
export class TeachersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string) {
    return this.db.query.teachers.findMany({
      where: eq(teachers.tenantId, tenantId),
      with: { groups: true },
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const teacher = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)),
      with: { groups: true },
    });
    if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    return teacher;
  }

  async create(tenantId: string, dto: CreateTeacherDto) {
    const [teacher] = await this.db.insert(teachers).values({ tenantId, ...dto }).returning();
    return teacher;
  }

  async update(tenantId: string, id: string, dto: UpdateTeacherDto) {
    await this.findOne(tenantId, id);
    const [teacher] = await this.db
      .update(teachers)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)))
      .returning();
    return teacher;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.delete(teachers).where(and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)));
    return { success: true };
  }
}
