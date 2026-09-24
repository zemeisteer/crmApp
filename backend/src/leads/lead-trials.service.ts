import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, courses, groups, leadTrials, rooms, schedules, subjects, teachers } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { zonedParts } from '../common/timezone';
import { ScheduleService, type ScheduleConflict } from '../schedule/schedule.service';
import { AdmissionsEventsService } from './admissions-events.service';
import { Actor, appTimestamps, isUniqueViolation, LeadRow, LeadsService, Tx } from './leads.service';
import { BookTrialDto, RescheduleTrialDto } from './dto/lead.dto';

// Converts an instant to the center's wall-clock values the schedule engine
// works with (lessons are stored as local "HH:MM" + weekday/date).
export function toLocalSlot(start: Date, durationMinutes: number, tz: string) {
  const local = zonedParts(start, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${local.year}-${pad(local.month)}-${pad(local.day)}`;
  const dayOfWeek = local.weekday;
  const startMin = local.hour * 60 + local.minute;
  // A trial that would run past midnight is checked up to 23:59.
  const endMin = Math.min(startMin + durationMinutes, 24 * 60 - 1);
  const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return { date, dayOfWeek, startTime: hhmm(startMin), endTime: hhmm(endMin) };
}

export interface TrialConflict {
  type: 'ROOM' | 'TEACHER' | 'TRIAL';
  message: string;
  conflictingScheduleId?: string;
  conflictingTrialId?: string;
}

type TrialRow = typeof leadTrials.$inferSelect;

@Injectable()
export class LeadTrialsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly leadsService: LeadsService,
    private readonly schedule: ScheduleService,
    private readonly audit: AuditService,
    private readonly events: AdmissionsEventsService,
  ) {}

  async list(tenantId: string, q: { from?: string; to?: string; teacherId?: string; status?: string }) {
    const conditions = [eq(leadTrials.tenantId, tenantId)];
    if (q.from) conditions.push(gte(leadTrials.scheduledAt, new Date(q.from)));
    if (q.to) conditions.push(lt(leadTrials.scheduledAt, new Date(q.to)));
    if (q.teacherId) conditions.push(eq(leadTrials.teacherId, q.teacherId));
    if (q.status === 'BOOKED') conditions.push(eq(leadTrials.status, 'BOOKED'));
    return this.db.query.leadTrials.findMany({
      where: and(...conditions),
      with: {
        lead: { columns: { id: true, fullName: true, status: true } },
        group: { columns: { id: true, name: true } },
        teacher: { columns: { id: true, fullName: true } },
        room: { columns: { id: true, name: true } },
      },
      orderBy: asc(leadTrials.scheduledAt),
      limit: 500,
    });
  }

  // ---- validation ----

  private async resolveRefs(tx: Tx, tenantId: string, lead: LeadRow, dto: Partial<BookTrialDto>) {
    let group: typeof groups.$inferSelect | undefined;
    if (dto.groupId) {
      [group] = await tx.select().from(groups).where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      if (!group) throw new NotFoundException('Guruh topilmadi');
      if (group.status === 'ARCHIVED' || group.status === 'COMPLETED') {
        throw new BadRequestException("Yopilgan guruhga sinov darsi belgilab bo'lmaydi");
      }
    }
    const teacherId = dto.teacherId || group?.teacherId || null;
    if (teacherId) {
      const [t] = await tx.select({ id: teachers.id }).from(teachers)
        .where(and(eq(teachers.id, teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
      if (!t) throw new NotFoundException("O'qituvchi topilmadi");
    }
    if (dto.roomId) {
      const [r] = await tx.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, dto.roomId), eq(rooms.tenantId, tenantId)));
      if (!r) throw new NotFoundException('Xona topilmadi');
    }
    const branchId = dto.branchId || group?.branchId || lead.preferredBranchId || null;
    if (dto.branchId) {
      const [b] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)));
      if (!b) throw new NotFoundException('Filial topilmadi');
    }
    const courseId = dto.courseId || group?.courseId || lead.desiredCourseId || null;
    let subjectId = dto.subjectId || lead.desiredSubjectId || null;
    if (dto.subjectId) {
      const [s] = await tx.select({ id: subjects.id, status: subjects.status }).from(subjects)
        .where(and(eq(subjects.id, dto.subjectId), eq(subjects.tenantId, tenantId)));
      if (!s) throw new NotFoundException('Fan topilmadi');
      if (s.status === 'ARCHIVED') throw new BadRequestException("Arxivlangan fanni tanlab bo'lmaydi");
    }
    if (courseId) {
      const [c] = await tx.select({ id: courses.id, subjectId: courses.subjectId, status: courses.status }).from(courses)
        .where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)));
      if (!c) throw new NotFoundException('Kurs topilmadi');
      if (dto.courseId && c.status === 'ARCHIVED') throw new BadRequestException("Arxivlangan kursni tanlab bo'lmaydi");
      if (dto.subjectId && c.subjectId && c.subjectId !== dto.subjectId) {
        throw new BadRequestException('Kurs tanlangan fanga tegishli emas');
      }
      subjectId = subjectId ?? c.subjectId;
    }
    return { groupId: group?.id ?? null, teacherId, roomId: dto.roomId || null, branchId, courseId, subjectId };
  }

  // Reuses ScheduleService.findConflicts for teacher/room clashes with real
  // lessons, then adds trial-vs-trial clashes. Differences from lesson
  // scheduling (documented in the report):
  //  - a trial *in* a group's own lesson is the normal case, so that group's
  //    lessons never count as conflicts;
  //  - a trial is a one-off: the engine checks it against lessons on its
  //    date and against weekly lessons on its weekday.
  async findConflicts(
    exec: Tx | Database,
    tenantId: string,
    slot: { start: Date; durationMinutes: number; teacherId: string | null; roomId: string | null; groupId: string | null },
    excludeTrialId?: string,
  ): Promise<TrialConflict[]> {
    if (!slot.teacherId && !slot.roomId) return [];
    const local = toLocalSlot(slot.start, slot.durationMinutes, await this.leadsService.tenantTimezone(tenantId));

    const lessonConflicts: ScheduleConflict[] = await this.schedule.findConflicts(tenantId, {
      groupId: '',
      teacherId: slot.teacherId,
      roomId: slot.roomId,
      dayOfWeek: local.dayOfWeek,
      date: local.date,
      startTime: local.startTime,
      endTime: local.endTime,
    });
    let ownGroupLessonIds = new Set<string>();
    if (slot.groupId) {
      const own = await exec.select({ id: schedules.id }).from(schedules)
        .where(and(eq(schedules.tenantId, tenantId), eq(schedules.groupId, slot.groupId)));
      ownGroupLessonIds = new Set(own.map((s) => s.id));
    }
    const conflicts: TrialConflict[] = lessonConflicts
      .filter((c) => !ownGroupLessonIds.has(c.conflictingScheduleId))
      .map((c) => ({ type: c.type === 'ROOM' ? 'ROOM' : 'TEACHER', message: c.message, conflictingScheduleId: c.conflictingScheduleId }));

    const end = new Date(slot.start.getTime() + slot.durationMinutes * 60_000);
    const resource = [];
    if (slot.teacherId) resource.push(eq(leadTrials.teacherId, slot.teacherId));
    if (slot.roomId) resource.push(eq(leadTrials.roomId, slot.roomId));
    const conditions = [
      eq(leadTrials.tenantId, tenantId),
      eq(leadTrials.status, 'BOOKED'),
      lt(leadTrials.scheduledAt, end),
      sql`${leadTrials.scheduledAt} + (${leadTrials.durationMinutes} * interval '1 minute') > ${slot.start}`,
      sql`(${sql.join(resource, sql` OR `)})`,
    ];
    if (excludeTrialId) conditions.push(ne(leadTrials.id, excludeTrialId));
    const overlapping = await exec.select().from(leadTrials).where(and(...conditions));
    for (const t of overlapping) {
      // Several prospects sitting in on the same group lesson is fine.
      if (slot.groupId && t.groupId === slot.groupId) continue;
      conflicts.push({ type: 'TRIAL', message: "Bu vaqtda o'qituvchi yoki xona boshqa sinov darsi bilan band", conflictingTrialId: t.id });
    }
    return conflicts;
  }

  private async lockResources(tx: Tx, tenantId: string, teacherId: string | null, roomId: string | null) {
    // Serializes bookings that compete for the same teacher/room so the
    // check-then-insert below cannot double-book under concurrency.
    for (const key of [teacherId && `trial:t:${tenantId}:${teacherId}`, roomId && `trial:r:${tenantId}:${roomId}`]) {
      if (key) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    }
  }

  private conflictError(conflicts: TrialConflict[]) {
    return new ConflictException({ code: 'TRIAL_CONFLICT', message: "Sinov darsi vaqtida to'qnashuv aniqlandi", conflicts });
  }

  private async getTrial(tx: Tx, tenantId: string, leadId: string, trialId: string, lock = true): Promise<TrialRow> {
    const where = and(eq(leadTrials.id, trialId), eq(leadTrials.tenantId, tenantId), eq(leadTrials.leadId, leadId));
    const rows = lock ? await tx.select().from(leadTrials).where(where).for('update') : await tx.select().from(leadTrials).where(where);
    if (!rows[0]) throw new NotFoundException('Sinov darsi topilmadi');
    return rows[0];
  }

  private requireBooked(trial: TrialRow) {
    if (trial.status !== 'BOOKED') {
      throw new ConflictException({ code: 'TRIAL_NOT_BOOKED', message: `Sinov darsi holati: ${trial.status}` });
    }
  }

  // ---- commands ----

  async book(tenantId: string, actor: Actor, leadId: string, dto: BookTrialDto) {
    const start = new Date(dto.scheduledAt);
    if (start.getTime() < Date.now() - 5 * 60_000) {
      throw new BadRequestException("Sinov darsini o'tgan vaqtga belgilab bo'lmaydi");
    }
    const durationMinutes = dto.durationMinutes ?? 60;
    let trial: TrialRow;
    try {
      trial = await this.db.transaction(async (tx) => {
        const lead = await this.leadsService.getLeadRow(tx, tenantId, leadId, { lock: true });
        if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Lid arxivlangan' });
        // CONTACTED -> TRIAL_BOOKED is a stage move; a lead already in
        // TRIAL_BOOKED may book again after a missed/cancelled trial.
        if (lead.status !== 'TRIAL_BOOKED') this.leadsService.assertTransition(lead.status, 'TRIAL_BOOKED');

        const refs = await this.resolveRefs(tx, tenantId, lead, dto);
        await this.lockResources(tx, tenantId, refs.teacherId, refs.roomId);
        const conflicts = await this.findConflicts(tx, tenantId, { start, durationMinutes, ...refs });
        if (conflicts.length > 0) throw this.conflictError(conflicts);

        const [row] = await tx.insert(leadTrials).values({
          tenantId, leadId, ...refs, scheduledAt: start, durationMinutes, status: 'BOOKED',
          outcomeNote: dto.note?.trim() || null, createdByUserId: actor.userId, ...appTimestamps(),
        }).returning();

        const activity = { type: 'TRIAL_BOOKED' as const, body: dto.note?.trim() || null, metadata: { trialId: row.id, scheduledAt: start.toISOString(), groupId: refs.groupId, teacherId: refs.teacherId } };
        if (lead.status === 'TRIAL_BOOKED') {
          await this.leadsService.recordActivity(tx, { tenantId, leadId, actorUserId: actor.userId, ...activity });
        } else {
          await this.leadsService.applyTransition(tx, tenantId, lead, 'TRIAL_BOOKED', actor.userId, activity);
        }
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ code: 'TRIAL_ALREADY_BOOKED', message: 'Bu lid uchun faol sinov darsi allaqachon bor' });
      }
      throw err;
    }
    this.events.emit('TrialBooked', { tenantId, leadId, actorUserId: actor.userId, data: { trialId: trial.id, scheduledAt: trial.scheduledAt.toISOString() } });
    return trial;
  }

  async reschedule(tenantId: string, actor: Actor, leadId: string, trialId: string, dto: RescheduleTrialDto) {
    const start = new Date(dto.scheduledAt);
    if (start.getTime() < Date.now() - 5 * 60_000) {
      throw new BadRequestException("Sinov darsini o'tgan vaqtga ko'chirib bo'lmaydi");
    }
    const result = await this.db.transaction(async (tx) => {
      const lead = await this.leadsService.getLeadRow(tx, tenantId, leadId, { lock: true });
      if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Lid arxivlangan' });
      const old = await this.getTrial(tx, tenantId, leadId, trialId);
      this.requireBooked(old);
      const refs = await this.resolveRefs(tx, tenantId, lead, {
        groupId: dto.groupId ?? old.groupId ?? undefined,
        teacherId: dto.teacherId ?? old.teacherId ?? undefined,
        roomId: dto.roomId ?? old.roomId ?? undefined,
        branchId: old.branchId ?? undefined,
        subjectId: old.subjectId ?? undefined,
        courseId: old.courseId ?? undefined,
      });
      const durationMinutes = dto.durationMinutes ?? old.durationMinutes;
      await this.lockResources(tx, tenantId, refs.teacherId, refs.roomId);
      const conflicts = await this.findConflicts(tx, tenantId, { start, durationMinutes, ...refs }, old.id);
      if (conflicts.length > 0) throw this.conflictError(conflicts);

      await tx.update(leadTrials).set({ status: 'RESCHEDULED', updatedAt: new Date() }).where(eq(leadTrials.id, old.id));
      const [row] = await tx.insert(leadTrials).values({
        tenantId, leadId, ...refs, scheduledAt: start, durationMinutes, status: 'BOOKED',
        outcomeNote: dto.note?.trim() || null, rescheduledFromTrialId: old.id, createdByUserId: actor.userId, ...appTimestamps(),
      }).returning();
      await this.leadsService.recordActivity(tx, {
        tenantId, leadId, actorUserId: actor.userId, type: 'TRIAL_BOOKED', body: dto.note?.trim() || null,
        metadata: { kind: 'RESCHEDULED', trialId: row.id, previousTrialId: old.id, from: old.scheduledAt.toISOString(), to: start.toISOString() },
      });
      return { row, old };
    });
    this.audit.log({
      tenantId, userId: actor.userId, action: 'trial_reschedule', entityType: 'lead_trial', entityId: result.row.id,
      meta: { leadId, previousTrialId: result.old.id, from: result.old.scheduledAt.toISOString(), to: start.toISOString() },
    });
    this.events.emit('TrialRescheduled', { tenantId, leadId, actorUserId: actor.userId, data: { trialId: result.row.id, previousTrialId: result.old.id } });
    return result.row;
  }

  async attend(tenantId: string, actor: Actor, leadId: string, trialId: string, note?: string) {
    const trial = await this.db.transaction(async (tx) => {
      const lead = await this.leadsService.getLeadRow(tx, tenantId, leadId, { lock: true });
      if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Lid arxivlangan' });
      const t = await this.getTrial(tx, tenantId, leadId, trialId);
      this.requireBooked(t);
      const [updated] = await tx.update(leadTrials)
        .set({ status: 'ATTENDED', outcomeNote: note?.trim() || t.outcomeNote, updatedAt: new Date() })
        .where(and(eq(leadTrials.id, t.id), eq(leadTrials.status, 'BOOKED')))
        .returning();
      const activity = { type: 'TRIAL_ATTENDED' as const, body: note?.trim() || null, metadata: { trialId: t.id } };
      if (lead.status === 'TRIAL_BOOKED') {
        await this.leadsService.applyTransition(tx, tenantId, lead, 'TRIAL_ATTENDED', actor.userId, activity);
      } else {
        await this.leadsService.recordActivity(tx, { tenantId, leadId, actorUserId: actor.userId, ...activity });
      }
      return updated;
    });
    this.events.emit('TrialAttended', { tenantId, leadId, actorUserId: actor.userId, data: { trialId } });
    return trial;
  }

  // MISSED and CANCELLED close the trial but leave the lead in TRIAL_BOOKED,
  // so staff can book another trial or mark the lead LOST.
  async close(tenantId: string, actor: Actor, leadId: string, trialId: string, status: 'MISSED' | 'CANCELLED', note?: string) {
    const trial = await this.db.transaction(async (tx) => {
      await this.leadsService.getLeadRow(tx, tenantId, leadId, { lock: true });
      const t = await this.getTrial(tx, tenantId, leadId, trialId);
      this.requireBooked(t);
      const [updated] = await tx.update(leadTrials)
        .set({ status, outcomeNote: note?.trim() || t.outcomeNote, updatedAt: new Date() })
        .where(eq(leadTrials.id, t.id))
        .returning();
      await this.leadsService.recordActivity(tx, {
        tenantId, leadId, actorUserId: actor.userId, type: 'NOTE', body: note?.trim() || null,
        metadata: { kind: status === 'MISSED' ? 'TRIAL_MISSED' : 'TRIAL_CANCELLED', trialId: t.id },
      });
      return updated;
    });
    this.audit.log({ tenantId, userId: actor.userId, action: status === 'MISSED' ? 'trial_missed' : 'trial_cancel', entityType: 'lead_trial', entityId: trialId, meta: { leadId } });
    return trial;
  }

  // Exposed so callers can pre-check a slot before booking.
  async check(tenantId: string, leadId: string, dto: BookTrialDto) {
    return this.db.transaction(async (tx) => {
      const lead = await this.leadsService.getLeadRow(tx, tenantId, leadId);
      const refs = await this.resolveRefs(tx, tenantId, lead, dto);
      const conflicts = await this.findConflicts(tx, tenantId, { start: new Date(dto.scheduledAt), durationMinutes: dto.durationMinutes ?? 60, ...refs });
      return { hasConflict: conflicts.length > 0, conflicts };
    });
  }
}
