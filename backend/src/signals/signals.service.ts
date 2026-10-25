import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { attendance, enrollments, groups, leadActivities, leads, leadTrials, organizationMemberships, signals, students, tenants, users } from '../db/schema';
import { TelegramService } from '../telegram/telegram.service';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';
import { absenceAlertDue, absenceRun, trialFollowUpDue } from './rules';

export type SignalRule = 'ABSENCE_STREAK' | 'TRIAL_FOLLOW_UP' | 'PAYMENT_OVERDUE';
type Tenant = typeof tenants.$inferSelect;

const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A person's contact with a lead (not the system's own entries).
const CONTACT_TYPES = ['CALL', 'MESSAGE', 'MEETING', 'NOTE'] as const;
// How far back attendance is read for a run of absences.
const ABSENCE_LOOKBACK_DAYS = 60;

/**
 * Rule-based signals: plain rules, no AI. Each one records why it fired -
 * the rule and the values it saw - so a manager can see the reason, and
 * fires once per occasion (the unique rule/subject/key). The rules only
 * tell people or plan a follow-up; nothing here deletes, expels or touches
 * money.
 */
@Injectable()
export class SignalsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
  ) {}

  /** Stores a signal; false when this rule already fired for that subject and key. */
  async record(
    tenantId: string,
    s: { rule: SignalRule; subjectType: 'student' | 'lead'; subjectId: string; key: string; reason: string; facts: Record<string, unknown>; action: string },
  ) {
    const rows = await this.db.insert(signals).values({ tenantId, ...s }).onConflictDoNothing().returning({ id: signals.id });
    return rows.length > 0;
  }

  private hour(t: Tenant, now: Date) {
    return zonedParts(now, isValidTimeZone(t.timezone) ? t.timezone : DEFAULT_TIMEZONE).hour;
  }

  private async managerChats(tenantId: string) {
    const rows = await this.db
      .select({ chat: users.telegramChatId })
      .from(users)
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.userId, users.id), eq(organizationMemberships.tenantId, tenantId)))
      .where(and(eq(organizationMemberships.status, 'ACTIVE'), inArray(organizationMemberships.role, ['OWNER', 'ADMIN', 'MANAGER']), isNotNull(users.telegramChatId)));
    return [...new Set(rows.map((r) => r.chat).filter((c): c is string => Boolean(c)))];
  }

  /** Every rule for one center (RemindersService runs this on its schedule). */
  async run(t: Tenant, now = new Date()) {
    // Office hours only: nobody is messaged at night.
    const h = this.hour(t, now);
    if (h < 9 || h >= 20) return { absences: 0, trials: 0 };
    return { absences: await this.absenceStreaks(t, now), trials: await this.trialFollowUps(t, now) };
  }

  // ---- N absences in a row -> the managers hear of it ----

  async absenceStreaks(t: Tenant, now = new Date()) {
    const threshold = t.absenceStreakAlert;
    if (threshold <= 0) return 0;
    const from = new Date(now.getTime() - ABSENCE_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const marks = await this.db
      .select({ studentId: attendance.studentId, date: attendance.date, status: attendance.status, groupId: attendance.groupId })
      .from(attendance)
      .innerJoin(students, eq(students.id, attendance.studentId))
      .where(and(eq(attendance.tenantId, t.id), gte(attendance.date, from), eq(students.status, 'ACTIVE'), isNull(students.deletedAt)));
    const byStudent = new Map<string, typeof marks>();
    for (const m of marks) byStudent.set(m.studentId, [...(byStudent.get(m.studentId) ?? []), m]);
    // Only students who study now (an active enrollment).
    const studying = new Set(
      (
        await this.db
          .selectDistinct({ id: enrollments.studentId })
          .from(enrollments)
          .innerJoin(students, eq(students.id, enrollments.studentId))
          .where(and(eq(students.tenantId, t.id), eq(enrollments.status, 'ACTIVE')))
      ).map((r) => r.id),
    );

    let fired = 0;
    let chats: string[] | null = null;
    for (const [studentId, list] of byStudent) {
      if (!studying.has(studentId)) continue;
      const run = absenceRun(list);
      if (!run || !absenceAlertDue(run, threshold)) continue;
      const [st] = await this.db.select({ fullName: students.fullName, phone: students.phone }).from(students).where(eq(students.id, studentId));
      const groupNames = run.groupIds.length
        ? (await this.db.select({ name: groups.name }).from(groups).where(inArray(groups.id, run.groupIds))).map((g) => g.name)
        : [];
      const inserted = await this.record(t.id, {
        rule: 'ABSENCE_STREAK',
        subjectType: 'student',
        subjectId: studentId,
        key: run.since,
        reason: `${run.count} ta dars ketma-ket qoldirildi (${run.since} – ${run.last}); chegara: ${threshold}`,
        facts: { threshold, absences: run.count, since: run.since, last: run.last, dates: run.dates, groups: groupNames },
        action: 'NOTIFIED_MANAGERS',
      });
      if (!inserted) continue;
      fired++;
      chats ??= await this.managerChats(t.id);
      const text = [
        `⚠️ <b>Ketma-ket dars qoldirmoqda</b>`,
        `${escape(st?.fullName ?? '')}${st?.phone ? ` · ${escape(st.phone)}` : ''}`,
        `${run.count} ta dars (${run.since} – ${run.last})${groupNames.length ? ` · ${escape(groupNames.join(', '))}` : ''}`,
        '',
        `Sababini bilish uchun bog'laning. TalimCRM → Signallar.`,
      ].join('\n');
      for (const chat of chats) await this.telegram.sendMessage(chat, text);
    }
    return fired;
  }

  // ---- no contact X days after a trial lesson -> a follow-up task ----

  async trialFollowUps(t: Tenant, now = new Date()) {
    const days = t.trialFollowUpDays;
    if (days <= 0) return 0;
    const earliest = new Date(now.getTime() - (days + 14) * 86_400_000);
    const trials = await this.db
      .select({
        trialId: leadTrials.id,
        leadId: leads.id,
        scheduledAt: leadTrials.scheduledAt,
        trialStatus: leadTrials.status,
        leadStatus: leads.status,
        followUpAt: leads.followUpAt,
      })
      .from(leadTrials)
      .innerJoin(leads, eq(leads.id, leadTrials.leadId))
      .where(
        and(
          eq(leadTrials.tenantId, t.id),
          inArray(leadTrials.status, ['ATTENDED', 'MISSED', 'BOOKED']),
          gte(leadTrials.scheduledAt, earliest),
          isNull(leads.archivedAt),
          inArray(leads.status, ['TRIAL_BOOKED', 'TRIAL_ATTENDED']),
        ),
      );
    let fired = 0;
    for (const tr of trials) {
      const [contact] = await this.db
        .select({ at: max(leadActivities.occurredAt) })
        .from(leadActivities)
        .where(and(eq(leadActivities.leadId, tr.leadId), isNotNull(leadActivities.actorUserId), inArray(leadActivities.type, [...CONTACT_TYPES])));
      const lastContactAt = contact?.at ? new Date(contact.at) : null;
      if (!trialFollowUpDue({ scheduledAt: tr.scheduledAt, leadStatus: tr.leadStatus, lastContactAt, followUpAt: tr.followUpAt }, days, now)) continue;
      const trialDate = tr.scheduledAt.toISOString().slice(0, 10);
      const inserted = await this.record(t.id, {
        rule: 'TRIAL_FOLLOW_UP',
        subjectType: 'lead',
        subjectId: tr.leadId,
        key: tr.trialId,
        reason: `Sinov darsidan (${trialDate}) keyin ${days} kundan ortiq aloqa bo'lmadi`,
        facts: { days, trialDate, trialStatus: tr.trialStatus, leadStatus: tr.leadStatus, lastContactAt: lastContactAt?.toISOString() ?? null },
        action: 'FOLLOW_UP_TASK',
      });
      if (!inserted) continue;
      fired++;
      // The task: a follow-up due now - the admissions scanner tells the
      // lead's manager, and the lead's timeline says why.
      await this.db.update(leads).set({ followUpAt: now, followUpNotifiedAt: null, updatedAt: now }).where(eq(leads.id, tr.leadId));
      await this.db.insert(leadActivities).values({
        tenantId: t.id,
        leadId: tr.leadId,
        actorUserId: null,
        type: 'FOLLOW_UP_SCHEDULED',
        body: `Avtomatik eslatma: sinov darsidan (${trialDate}) keyin ${days} kundan ortiq aloqa bo'lmadi. Qo'ng'iroq qiling.`,
        metadata: { auto: true, rule: 'TRIAL_FOLLOW_UP', days, trialDate },
      });
    }
    return fired;
  }

  // ---- what the managers see ----

  async list(tenantId: string, q: { status?: string; rule?: string }) {
    const where = [eq(signals.tenantId, tenantId)];
    if (q.status && ['OPEN', 'DONE', 'DISMISSED'].includes(q.status)) where.push(eq(signals.status, q.status));
    if (q.rule && ['ABSENCE_STREAK', 'TRIAL_FOLLOW_UP', 'PAYMENT_OVERDUE'].includes(q.rule)) where.push(eq(signals.rule, q.rule));
    const [rows, counts] = await Promise.all([
      this.db
        .select({ s: signals, studentName: students.fullName, leadName: leads.fullName, resolvedBy: users.fullName })
        .from(signals)
        .leftJoin(students, and(eq(signals.subjectType, 'student'), eq(students.id, signals.subjectId)))
        .leftJoin(leads, and(eq(signals.subjectType, 'lead'), eq(leads.id, signals.subjectId)))
        .leftJoin(users, eq(users.id, signals.resolvedByUserId))
        .where(and(...where))
        .orderBy(desc(signals.createdAt))
        .limit(300),
      this.db
        .select({ rule: signals.rule, n: sql<number>`count(*)::int` })
        .from(signals)
        .where(and(eq(signals.tenantId, tenantId), eq(signals.status, 'OPEN')))
        .groupBy(signals.rule),
    ]);
    return {
      open: Object.fromEntries(counts.map((c) => [c.rule, c.n])),
      items: rows.map((r) => ({ ...r.s, subjectName: r.studentName ?? r.leadName ?? null, resolvedBy: r.resolvedBy })),
    };
  }

  /** A person marks it handled or not needed (nothing else changes). */
  async resolve(tenantId: string, userId: string, id: string, status: string) {
    if (!['DONE', 'DISMISSED', 'OPEN'].includes(status)) throw new BadRequestException("Holat noto'g'ri");
    const [row] = await this.db
      .update(signals)
      .set(status === 'OPEN' ? { status, resolvedByUserId: null, resolvedAt: null } : { status, resolvedByUserId: userId, resolvedAt: new Date() })
      .where(and(eq(signals.id, id), eq(signals.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Signal topilmadi');
    return row;
  }
}
