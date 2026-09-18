import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { groups } from '../db/schema';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';

@Injectable()
export class GroupsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string) {
    return this.db.query.groups.findMany({
      where: eq(groups.tenantId, tenantId),
      with: { teacher: true },
      orderBy: (g, { desc }) => desc(g.createdAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, id), eq(groups.tenantId, tenantId)),
      with: { teacher: true, enrollments: { with: { student: true } } },
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');
    return group;
  }

  async create(tenantId: string, dto: CreateGroupDto) {
    const [group] = await this.db
      .insert(groups)
      .values({
        tenantId,
        name: dto.name,
        subject: dto.subject,
        level: dto.level,
        teacherId: dto.teacherId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        maxStudents: dto.maxStudents ?? 20,
        schedule: dto.schedule,
        monthlyPrice: dto.monthlyPrice ?? 0,
      })
      .returning();
    return group;
  }

  async update(tenantId: string, id: string, dto: UpdateGroupDto) {
    await this.findOne(tenantId, id);
    const [group] = await this.db
      .update(groups)
      .set({
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(groups.id, id), eq(groups.tenantId, tenantId)))
      .returning();
    return group;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.delete(groups).where(and(eq(groups.id, id), eq(groups.tenantId, tenantId)));
    return { success: true };
  }
}
