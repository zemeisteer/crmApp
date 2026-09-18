import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { attendance } from '../db/schema';
import { MarkAttendanceDto, QueryAttendanceDto } from './dto/attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async mark(tenantId: string, dto: MarkAttendanceDto) {
    const rows = await Promise.all(
      dto.entries.map((entry) =>
        this.db
          .insert(attendance)
          .values({
            tenantId,
            groupId: dto.groupId,
            studentId: entry.studentId,
            date: dto.date,
            status: entry.status as any,
          })
          .onConflictDoUpdate({
            target: [attendance.studentId, attendance.groupId, attendance.date],
            set: { status: entry.status as any, updatedAt: new Date() },
          })
          .returning(),
      ),
    );
    return rows.flat();
  }

  findAll(tenantId: string, query: QueryAttendanceDto) {
    const conditions = [eq(attendance.tenantId, tenantId)];
    if (query.groupId) conditions.push(eq(attendance.groupId, query.groupId));
    if (query.date) conditions.push(eq(attendance.date, query.date));
    if (query.studentId) conditions.push(eq(attendance.studentId, query.studentId));

    return this.db.query.attendance.findMany({
      where: and(...conditions),
      orderBy: (a, { desc }) => desc(a.date),
    });
  }
}
