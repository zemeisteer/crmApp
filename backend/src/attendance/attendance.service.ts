import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { attendance, groups } from '../db/schema';
import { MarkAttendanceDto, QueryAttendanceDto } from './dto/attendance.dto';
import { TelegramService } from '../telegram/telegram.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly webhooks: WebhooksService,
  ) {}

  async mark(tenantId: string, dto: MarkAttendanceDto) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId)),
    });
    if (!group) {
      throw new NotFoundException('Guruh topilmadi');
    }

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

    const absentees = dto.entries.filter((e) => e.status === 'ABSENT');
    if (absentees.length > 0) {
      const group = await this.db.query.groups.findFirst({ where: eq(groups.id, dto.groupId) });
      for (const entry of absentees) {
        void this.telegram.notifyStudent(
          entry.studentId,
          `${dto.date} kuni ${group?.name ?? 'guruh'} darsiga kelmadingiz. Sababi bo'lsa markazga xabar bering.`,
        );
      }
    }

    const flat = rows.flat();
    void this.webhooks.dispatch(tenantId, 'attendance.marked', { groupId: dto.groupId, date: dto.date, entries: flat });
    return flat;
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
