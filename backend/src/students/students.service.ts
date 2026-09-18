import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { students, enrollments } from '../db/schema';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';

@Injectable()
export class StudentsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string) {
    return this.db.query.students.findMany({
      where: eq(students.tenantId, tenantId),
      with: { enrollments: { with: { group: true } } },
      orderBy: (s, { desc }) => desc(s.createdAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, id), eq(students.tenantId, tenantId)),
      with: { enrollments: { with: { group: true } }, payments: true },
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");
    return student;
  }

  async create(tenantId: string, dto: CreateStudentDto) {
    const [student] = await this.db
      .insert(students)
      .values({
        tenantId,
        fullName: dto.fullName,
        phone: dto.phone,
        parentPhone: dto.parentPhone,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        address: dto.address,
        telegramUsername: dto.telegramUsername,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      })
      .returning();

    if (dto.groupId) {
      await this.db.insert(enrollments).values({ studentId: student.id, groupId: dto.groupId });
    }
    return student;
  }

  async update(tenantId: string, id: string, dto: UpdateStudentDto) {
    await this.findOne(tenantId, id);
    const [student] = await this.db
      .update(students)
      .set({
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(students.id, id), eq(students.tenantId, tenantId)))
      .returning();
    return student;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.delete(students).where(and(eq(students.id, id), eq(students.tenantId, tenantId)));
    return { success: true };
  }

  async enroll(tenantId: string, studentId: string, groupId: string) {
    await this.findOne(tenantId, studentId);
    await this.db.insert(enrollments).values({ studentId, groupId }).onConflictDoNothing();
    return { success: true };
  }

  async unenroll(tenantId: string, studentId: string, groupId: string) {
    await this.findOne(tenantId, studentId);
    await this.db
      .delete(enrollments)
      .where(and(eq(enrollments.studentId, studentId), eq(enrollments.groupId, groupId)));
    return { success: true };
  }
}
