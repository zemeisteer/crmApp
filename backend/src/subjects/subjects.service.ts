import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { courses, groups, subjects } from '../db/schema';
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

  async findAll(tenantId: string, status?: 'ACTIVE' | 'ARCHIVED') {
    const conditions = [eq(subjects.tenantId, tenantId)];
    if (status) {
      conditions.push(eq(subjects.status, status));
    }
    const list = await this.db.query.subjects.findMany({
      where: and(...conditions),
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
    const cleanName = dto.name.trim();
    const existing = await this.db.query.subjects.findFirst({
      where: and(eq(subjects.tenantId, tenantId), eq(subjects.name, cleanName)),
    });
    if (existing) {
      throw new ConflictException(`'${cleanName}' nomli fan allaqachon mavjud`);
    }

    const [subject] = await this.db
      .insert(subjects)
      .values({
        tenantId,
        name: cleanName,
        code: dto.code?.trim() || null,
        description: dto.description?.trim() || null,
        color: dto.color || '#3B82F6',
        status: dto.status || 'ACTIVE',
      })
      .returning();
    return subject;
  }

  async update(tenantId: string, id: string, dto: UpdateSubjectDto) {
    await this.findOne(tenantId, id);

    if (dto.name) {
      const cleanName = dto.name.trim();
      const existing = await this.db.query.subjects.findFirst({
        where: and(eq(subjects.tenantId, tenantId), eq(subjects.name, cleanName)),
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`'${cleanName}' nomli fan allaqachon mavjud`);
      }
    }

    const [updated] = await this.db
      .update(subjects)
      .set({
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(subjects.id, id), eq(subjects.tenantId, tenantId)))
      .returning();

    if (!updated) throw new NotFoundException('Fan topilmadi');
    return updated;
  }

  async archive(tenantId: string, id: string) {
    return this.update(tenantId, id, { status: 'ARCHIVED' });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    // Check if courses exist for this subject
    const attachedCourses = await this.db.query.courses.findMany({
      where: and(eq(courses.tenantId, tenantId), eq(courses.subjectId, id)),
    });

    if (attachedCourses.length > 0) {
      // Safe archive behavior instead of destructive deletion
      await this.archive(tenantId, id);
      return { success: true, archived: true, message: 'Fanga biriktirilgan kurslar mavjudligi sababli u arxivlandi' };
    }

    const [removed] = await this.db
      .delete(subjects)
      .where(and(eq(subjects.id, id), eq(subjects.tenantId, tenantId)))
      .returning();

    if (!removed) throw new NotFoundException('Fan topilmadi');
    return { success: true };
  }

  // Course methods
  async findAllCourses(tenantId: string, subjectId?: string, status?: 'ACTIVE' | 'ARCHIVED') {
    const conditions = [eq(courses.tenantId, tenantId)];
    if (subjectId) {
      conditions.push(eq(courses.subjectId, subjectId));
    }
    if (status) {
      conditions.push(eq(courses.status, status));
    }
    return this.db.query.courses.findMany({
      where: and(...conditions),
      orderBy: [desc(courses.createdAt)],
    });
  }

  async createCourse(tenantId: string, dto: CreateCourseDto) {
    if (dto.subjectId) {
      const subject = await this.db.query.subjects.findFirst({
        where: and(eq(subjects.id, dto.subjectId), eq(subjects.tenantId, tenantId)),
      });
      if (!subject) throw new NotFoundException('Fan topilmadi');
    }

    const cleanName = dto.name.trim();
    const existing = await this.db.query.courses.findFirst({
      where: and(
        eq(courses.tenantId, tenantId),
        eq(courses.name, cleanName),
        dto.subjectId ? eq(courses.subjectId, dto.subjectId) : undefined,
      ),
    });
    if (existing) {
      throw new ConflictException(`'${cleanName}' nomli kurs allaqachon mavjud`);
    }

    const [course] = await this.db
      .insert(courses)
      .values({
        tenantId,
        subjectId: dto.subjectId || null,
        name: cleanName,
        description: dto.description || null,
        durationMonths: dto.durationMonths ?? 3,
        price: dto.price ? dto.price.toString() : '0',
        status: dto.status || 'ACTIVE',
      })
      .returning();
    return course;
  }

  async updateCourse(tenantId: string, id: string, dto: UpdateCourseDto) {
    const current = await this.db.query.courses.findFirst({
      where: and(eq(courses.id, id), eq(courses.tenantId, tenantId)),
    });
    if (!current) throw new NotFoundException('Kurs topilmadi');

    if (dto.subjectId) {
      const subject = await this.db.query.subjects.findFirst({
        where: and(eq(subjects.id, dto.subjectId), eq(subjects.tenantId, tenantId)),
      });
      if (!subject) throw new NotFoundException('Fan topilmadi');
    }

    if (dto.name) {
      const cleanName = dto.name.trim();
      const subjectId = dto.subjectId !== undefined ? dto.subjectId : current.subjectId;
      const existing = await this.db.query.courses.findFirst({
        where: and(
          eq(courses.tenantId, tenantId),
          eq(courses.name, cleanName),
          subjectId ? eq(courses.subjectId, subjectId) : undefined,
        ),
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`'${cleanName}' nomli kurs allaqachon mavjud`);
      }
    }

    const [updated] = await this.db
      .update(courses)
      .set({
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.subjectId !== undefined ? { subjectId: dto.subjectId || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.durationMonths !== undefined ? { durationMonths: dto.durationMonths } : {}),
        ...(dto.price !== undefined ? { price: dto.price?.toString() || '0' } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(courses.id, id), eq(courses.tenantId, tenantId)))
      .returning();

    if (!updated) throw new NotFoundException('Kurs topilmadi');
    return updated;
  }

  async archiveCourse(tenantId: string, id: string) {
    return this.updateCourse(tenantId, id, { status: 'ARCHIVED' });
  }

  async removeCourse(tenantId: string, id: string) {
    const current = await this.db.query.courses.findFirst({
      where: and(eq(courses.id, id), eq(courses.tenantId, tenantId)),
    });
    if (!current) throw new NotFoundException('Kurs topilmadi');

    // Check if any groups reference this course
    const attachedGroups = await this.db.query.groups.findMany({
      where: and(eq(groups.tenantId, tenantId), eq(groups.courseId, id)),
    });

    if (attachedGroups.length > 0) {
      await this.archiveCourse(tenantId, id);
      return { success: true, archived: true, message: 'Guruhlar biriktirilganligi sababli kurs arxivlandi' };
    }

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
      const cleanSubjectName = item.name.trim();
      let subject = await this.db.query.subjects.findFirst({
        where: and(eq(subjects.tenantId, tenantId), eq(subjects.name, cleanSubjectName)),
      });

      if (!subject) {
        const [inserted] = await this.db
          .insert(subjects)
          .values({
            tenantId,
            name: cleanSubjectName,
            color: '#3B82F6',
            status: 'ACTIVE',
          })
          .returning();
        subject = inserted;
      }

      const createdCoursesList = [];
      if (item.courses && item.courses.length > 0) {
        for (const courseName of item.courses) {
          const cleanCourseName = courseName.trim();
          let course = await this.db.query.courses.findFirst({
            where: and(
              eq(courses.tenantId, tenantId),
              eq(courses.subjectId, subject.id),
              eq(courses.name, cleanCourseName),
            ),
          });

          if (!course) {
            const [insertedCourse] = await this.db
              .insert(courses)
              .values({
                tenantId,
                subjectId: subject.id,
                name: cleanCourseName,
                durationMonths: 3,
                status: 'ACTIVE',
              })
              .returning();
            course = insertedCourse;
          }
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
