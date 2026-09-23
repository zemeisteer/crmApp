import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { courses, subjects } from '../db/schema';
import {
  BulkCreateSubjectsDto,
  CreateCourseDto,
  CreateSubjectDto,
  UpdateCourseDto,
  UpdateSubjectDto,
} from './dto/subject.dto';

@Injectable()
export class SubjectsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findAll(tenantId: string) {
    const list = await this.db.query.subjects.findMany({
      where: eq(subjects.tenantId, tenantId),
      with: {
        courses: true,
      },
      orderBy: [desc(subjects.createdAt)],
    });
    return list;
  }

  async findOne(tenantId: string, id: string) {
    const subject = await this.db.query.subjects.findFirst({
      where: and(eq(subjects.id, id), eq(subjects.tenantId, tenantId)),
      with: {
        courses: true,
      },
    });
    if (!subject) throw new NotFoundException('Fan topilmadi');
    return subject;
  }

  async create(tenantId: string, dto: CreateSubjectDto) {
    const [subject] = await this.db
      .insert(subjects)
      .values({
        tenantId,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        description: dto.description?.trim() || null,
        color: dto.color || '#3B82F6',
      })
      .returning();
    return subject;
  }

  async update(tenantId: string, id: string, dto: UpdateSubjectDto) {
    const [updated] = await this.db
      .update(subjects)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(and(eq(subjects.id, id), eq(subjects.tenantId, tenantId)))
      .returning();

    if (!updated) throw new NotFoundException('Fan topilmadi');
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const [removed] = await this.db
      .delete(subjects)
      .where(and(eq(subjects.id, id), eq(subjects.tenantId, tenantId)))
      .returning();

    if (!removed) throw new NotFoundException('Fan topilmadi');
    return { success: true };
  }

  // Course methods
  async findAllCourses(tenantId: string, subjectId?: string) {
    const conditions = [eq(courses.tenantId, tenantId)];
    if (subjectId) {
      conditions.push(eq(courses.subjectId, subjectId));
    }
    return this.db.query.courses.findMany({
      where: and(...conditions),
      orderBy: [desc(courses.createdAt)],
    });
  }

  async createCourse(tenantId: string, dto: CreateCourseDto) {
    const [course] = await this.db
      .insert(courses)
      .values({
        tenantId,
        subjectId: dto.subjectId || null,
        name: dto.name.trim(),
        description: dto.description || null,
        durationMonths: dto.durationMonths ?? 3,
        price: dto.price ? dto.price.toString() : '0',
      })
      .returning();
    return course;
  }

  async updateCourse(tenantId: string, id: string, dto: UpdateCourseDto) {
    const [updated] = await this.db
      .update(courses)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(and(eq(courses.id, id), eq(courses.tenantId, tenantId)))
      .returning();

    if (!updated) throw new NotFoundException('Kurs topilmadi');
    return updated;
  }

  async removeCourse(tenantId: string, id: string) {
    const [removed] = await this.db
      .delete(courses)
      .where(and(eq(courses.id, id), eq(courses.tenantId, tenantId)))
      .returning();

    if (!removed) throw new NotFoundException('Kurs topilmadi');
    return { success: true };
  }

  async bulkCreate(tenantId: string, dto: BulkCreateSubjectsDto) {
    const createdSubjects = [];
    for (const item of dto.subjects) {
      const [subject] = await this.db
        .insert(subjects)
        .values({
          tenantId,
          name: item.name.trim(),
          color: '#3B82F6',
        })
        .returning();

      const createdCoursesList = [];
      if (item.courses && item.courses.length > 0) {
        for (const courseName of item.courses) {
          const [course] = await this.db
            .insert(courses)
            .values({
              tenantId,
              subjectId: subject.id,
              name: courseName.trim(),
              durationMonths: 3,
            })
            .returning();
          createdCoursesList.push(course);
        }
      }

      createdSubjects.push({
        ...subject,
        courses: createdCoursesList,
      });
    }

    return createdSubjects;
  }
}
