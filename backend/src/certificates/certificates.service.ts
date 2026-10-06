import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DB, Database } from '../db/db.module';
import { certificates, groups, students } from '../db/schema';
import { CreateCertificateDto, QueryCertificateDto } from './dto/certificate.dto';
import { STUDENT_STAFF_COLUMNS, studentIdsInGroups, teacherGroupIds, Viewer } from '../common/teacher-scope';

@Injectable()
export class CertificatesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // A teacher: the students of their own groups (and certificates of those groups).
  private async teacherScope(tenantId: string, viewer?: Viewer) {
    const groupIds = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (!groupIds) return null;
    return { groupIds, studentIds: await studentIdsInGroups(this.db, groupIds) };
  }

  async findAll(tenantId: string, query: QueryCertificateDto, viewer?: Viewer) {
    const conditions = [eq(certificates.tenantId, tenantId)];
    const scope = await this.teacherScope(tenantId, viewer);
    if (scope) {
      if (scope.groupIds.length === 0) return [];
      const visible = [inArray(certificates.groupId, scope.groupIds)];
      if (scope.studentIds.length) visible.push(inArray(certificates.studentId, scope.studentIds));
      conditions.push(or(...visible)!);
    }

    if (query.studentId) {
      conditions.push(eq(certificates.studentId, query.studentId));
    }
    if (query.groupId) {
      conditions.push(eq(certificates.groupId, query.groupId));
    }
    if (query.search) {
      conditions.push(
        or(
          ilike(certificates.code, `%${query.search}%`),
          ilike(certificates.title, `%${query.search}%`),
        )!,
      );
    }

    return this.db.query.certificates.findMany({
      where: and(...conditions),
      with: {
        student: { columns: { id: true, fullName: true, phone: true } },
        group: { columns: { id: true, name: true, subject: true } },
      },
      orderBy: [desc(certificates.createdAt)],
    });
  }

  async findOne(tenantId: string, id: string, viewer?: Viewer) {
    const cert = await this.db.query.certificates.findFirst({
      where: and(eq(certificates.id, id), eq(certificates.tenantId, tenantId)),
      with: {
        student: { columns: STUDENT_STAFF_COLUMNS },
        group: true,
      },
    });
    if (!cert) {
      throw new NotFoundException('Sertifikat topilmadi');
    }
    const scope = await this.teacherScope(tenantId, viewer);
    if (scope && !(cert.groupId && scope.groupIds.includes(cert.groupId)) && !scope.studentIds.includes(cert.studentId)) {
      throw new ForbiddenException("Bu o'quvchi sizning guruhingizda emas");
    }
    return cert;
  }

  async create(tenantId: string, dto: CreateCertificateDto, viewer?: Viewer) {
    // A teacher certifies the students of their own groups only.
    const scope = await this.teacherScope(tenantId, viewer);
    if (scope && (!dto.groupId || !scope.groupIds.includes(dto.groupId) || !scope.studentIds.includes(dto.studentId))) {
      throw new ForbiddenException("Bu o'quvchi sizning guruhingizda emas");
    }
    // 1. Multi-tenant IDOR check: verify student belongs to tenant
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) {
      throw new BadRequestException("O'quvchi topilmadi yoki ushbu markazga tegishli emas");
    }

    // 2. If group provided, verify group belongs to tenant
    if (dto.groupId) {
      const group = await this.db.query.groups.findFirst({
        where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId)),
      });
      if (!group) {
        throw new BadRequestException("Guruh topilmadi yoki ushbu markazga tegishli emas");
      }
    }

    // 3. Generate unique verifiable code: CERT-YYYY-XXXXXX
    const year = new Date().getFullYear();
    const entropy = randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
    const code = `CERT-${year}-${entropy}`;

    const [created] = await this.db
      .insert(certificates)
      .values({
        tenantId,
        studentId: dto.studentId,
        groupId: dto.groupId,
        code,
        title: dto.title,
        grade: dto.grade,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        signatoryName: dto.signatoryName || "O'quv bo'limi",
        signatoryTitle: dto.signatoryTitle,
        description: dto.description,
      })
      .returning();

    return this.findOne(tenantId, created.id);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.delete(certificates).where(and(eq(certificates.id, id), eq(certificates.tenantId, tenantId)));
    return { success: true };
  }

  // Public verification endpoint: Safe minimal data only (Master Spec Section 23)
  async verifyPublic(code: string) {
    const cert = await this.db.query.certificates.findFirst({
      where: eq(certificates.code, code.trim().toUpperCase()),
      with: {
        student: { columns: { fullName: true } },
        group: { columns: { name: true, subject: true } },
        tenant: { columns: { name: true } },
      },
    });

    if (!cert) {
      return {
        valid: false,
        message: "Sertifikat topilmadi yoki bekor qilingan",
      };
    }

    return {
      valid: true,
      code: cert.code,
      studentName: cert.student.fullName,
      title: cert.title,
      grade: cert.grade,
      issueDate: cert.issueDate,
      organizationName: cert.tenant?.name || "O'quv markazi",
      courseName: cert.group?.name,
      subject: cert.group?.subject,
      signatoryName: cert.signatoryName,
      signatoryTitle: cert.signatoryTitle,
      description: cert.description,
    };
  }
}
