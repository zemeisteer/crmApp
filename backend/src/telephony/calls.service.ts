import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedTimeToUtc } from '../common/timezone';
import { DB, Database } from '../db/db.module';
import { calls, leadActivities, leads, students, tenants, users } from '../db/schema';
import { normalizePhone } from '../leads/phone';
import { allows, entitlementsOf, notInPlan } from '../plans/entitlements';
import { CallIngestService } from './call-ingest.service';
import { TelephonyProviderError } from './providers/telephony-provider.interface';
import { TelephonyProviders } from './providers/telephony-providers';
import { TelephonyAccountsService } from './telephony-accounts.service';

/** Who is asking (from the token). */
export interface CallsViewer {
  tenantId: string;
  userId: string;
  role: string;
}

type CallRow = typeof calls.$inferSelect;

const isAdmin = (role: string) => role === 'OWNER' || role === 'ADMIN' || role === 'SUPERADMIN';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The call log as staff see it. Every query is limited to the viewer's
 * center (tenantId from the token, never from the request). Within the
 * center, the owner's setting decides (telephony_accounts.calls_visibility):
 * OWN - a member sees the calls they took or were rung for; ALL - every
 * call. Owner and admins always see all. Recordings: only owner and admins,
 * or whoever can see the call (recordings_access).
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accounts: TelephonyAccountsService,
    private readonly providers: TelephonyProviders,
    private readonly ingestService: CallIngestService,
  ) {}

  private async seesAll(v: CallsViewer) {
    if (isAdmin(v.role)) return true;
    const account = await this.accounts.row(v.tenantId);
    return account?.callsVisibility === 'ALL';
  }

  /** The viewer's limit inside the center: nothing more, or only their own calls. */
  private async scope(v: CallsViewer): Promise<SQL> {
    return (await this.seesAll(v)) ? eq(calls.tenantId, v.tenantId) : and(eq(calls.tenantId, v.tenantId), eq(calls.managerUserId, v.userId))!;
  }

  private async visibleCall(v: CallsViewer, id: string): Promise<CallRow> {
    const [c] = await this.db.select().from(calls).where(and(eq(calls.id, id), await this.scope(v)));
    if (!c) throw new NotFoundException("Qo'ng'iroq topilmadi");
    return c;
  }

  async list(v: CallsViewer, q: { leadId?: string; studentId?: string; managerUserId?: string; status?: string; direction?: string; limit?: number; before?: string }) {
    const where: SQL[] = [await this.scope(v)];
    if (q.leadId) where.push(eq(calls.leadId, q.leadId));
    if (q.studentId) where.push(eq(calls.studentId, q.studentId));
    if (q.managerUserId) where.push(eq(calls.managerUserId, q.managerUserId));
    if (q.status === 'ANSWERED' || q.status === 'MISSED' || q.status === 'RINGING') where.push(eq(calls.status, q.status));
    if (q.direction === 'INBOUND' || q.direction === 'OUTBOUND') where.push(eq(calls.direction, q.direction));
    if (q.before) {
      const d = new Date(q.before);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("before noto'g'ri");
      where.push(lt(calls.startedAt, d));
    }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const manager = alias(users, 'manager');
    const rows = await this.db
      .select({
        id: calls.id, direction: calls.direction, status: calls.status, clientNumber: calls.clientNumber, extension: calls.extension,
        managerUserId: calls.managerUserId, managerName: manager.fullName, contactKind: calls.contactKind, leadId: calls.leadId, studentId: calls.studentId,
        leadName: leads.fullName, studentName: students.fullName, createdLead: calls.createdLead, disposition: calls.disposition,
        durationSec: calls.durationSec, startedAt: calls.startedAt, answeredAt: calls.answeredAt, endedAt: calls.endedAt, hasRecording: calls.hasRecording,
      })
      .from(calls)
      .leftJoin(manager, eq(manager.id, calls.managerUserId))
      // Joined on the call's own center as well: a link never reaches another center's row.
      .leftJoin(leads, and(eq(leads.id, calls.leadId), eq(leads.tenantId, calls.tenantId)))
      .leftJoin(students, and(eq(students.id, calls.studentId), eq(students.tenantId, calls.tenantId)))
      .where(and(...where))
      .orderBy(desc(calls.startedAt), desc(calls.id))
      .limit(limit + 1);
    const canPlay = await this.mayPlay(v);
    return {
      items: rows.slice(0, limit).map((r) => ({ ...r, canPlay: r.hasRecording && canPlay })),
      hasMore: rows.length > limit,
    };
  }

  /** The popup's caller card: who it is, their status, the latest notes, past calls. */
  async card(v: CallsViewer, id: string) {
    const c = await this.visibleCall(v, id);
    let contact: Record<string, unknown> | null = null;
    if (c.leadId && (c.contactKind === 'LEAD' || !c.studentId)) {
      const [l] = await this.db
        .select({ id: leads.id, fullName: leads.fullName, status: leads.status, source: leads.source, notes: leads.notes, assignedManagerUserId: leads.assignedManagerUserId })
        .from(leads).where(and(eq(leads.id, c.leadId), eq(leads.tenantId, v.tenantId)));
      if (l) {
        const recent = await this.db
          .select({ type: leadActivities.type, body: leadActivities.body, occurredAt: leadActivities.occurredAt })
          .from(leadActivities)
          .where(and(eq(leadActivities.tenantId, v.tenantId), eq(leadActivities.leadId, l.id), sql`${leadActivities.body} IS NOT NULL AND ${leadActivities.body} <> ''`))
          .orderBy(desc(leadActivities.occurredAt))
          .limit(3);
        contact = { kind: 'LEAD', id: l.id, name: l.fullName, status: l.status, source: l.source, notes: l.notes, recent, href: `/leads/${l.id}` };
      }
    }
    if (!contact && c.studentId) {
      const [s] = await this.db
        .select({ id: students.id, fullName: students.fullName, status: students.status, notes: students.notes })
        .from(students).where(and(eq(students.id, c.studentId), eq(students.tenantId, v.tenantId)));
      if (s) contact = { kind: c.contactKind === 'PARENT' ? 'PARENT' : 'STUDENT', id: s.id, name: s.fullName, status: s.status, notes: s.notes, recent: [], href: `/students/${s.id}` };
    }
    const [{ previous }] = await this.db
      .select({ previous: sql<number>`count(*)::int` })
      .from(calls)
      .where(and(eq(calls.tenantId, v.tenantId), eq(calls.clientNumber, c.clientNumber ?? ''), lt(calls.startedAt, c.startedAt)));
    return {
      call: { id: c.id, direction: c.direction, status: c.status, clientNumber: c.clientNumber, extension: c.extension, managerUserId: c.managerUserId, startedAt: c.startedAt, createdLead: c.createdLead },
      contact,
      previousCalls: previous,
    };
  }

  // ---- Click-to-call ----

  async clickToCall(v: CallsViewer, phone: string) {
    const to = normalizePhone(phone);
    if (!to) throw new BadRequestException("Telefon raqami noto'g'ri");
    if (!allows(await entitlementsOf(this.db, v.tenantId), 'TELEPHONY')) throw notInPlan('TELEPHONY');
    const account = await this.accounts.row(v.tenantId);
    if (!account || !account.enabled) throw new BadRequestException('Telefoniya ulanmagan yoki o\'chirilgan');
    const extension = await this.accounts.extensionOfUser(v.tenantId, v.userId);
    if (!extension) throw new BadRequestException("Sizga ichki raqam biriktirilmagan: Sozlamalar → Telefoniya");
    const creds = this.accounts.open(account);
    if (!creds) throw new ServiceUnavailableException("Telefoniya kalitini ochib bo'lmadi: secret'ni qayta kiriting");
    try {
      await this.providers.get(account.provider).startCallback(creds, { extension, to });
    } catch (e) {
      if (e instanceof TelephonyProviderError) throw new BadRequestException(e.message);
      throw e;
    }
    this.logger.log(JSON.stringify({ op: 'telephony.click_to_call', tenantId: v.tenantId, userId: v.userId, extension }));
    if (account.provider === 'MOCK') this.simulateMockCallback(account, extension, to);
    return { ok: true, extension };
  }

  /**
   * The mock rings nobody: it plays the provider's part, sending what a
   * real callback would (the manager picks up, then the client), through
   * the same ingest path as a webhook.
   */
  private simulateMockCallback(account: NonNullable<Awaited<ReturnType<TelephonyAccountsService['row']>>>, extension: string, to: string) {
    const provider = this.providers.get('MOCK');
    const id = `out_mock_${Date.now()}`;
    const start = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const dest = to.replace(/^\+/, '');
    const steps: Array<[number, Record<string, string>]> = [
      [300, { event: 'NOTIFY_OUT_START', call_start: start, pbx_call_id: id, internal: extension, destination: dest }],
      [1500, { event: 'NOTIFY_ANSWER', call_start: start, pbx_call_id: id, caller_id: extension, destination: dest, internal: extension }],
      [4000, { event: 'NOTIFY_OUT_END', call_start: start, pbx_call_id: id, internal: extension, caller_id: extension, destination: dest, duration: '2', disposition: 'answered', status_code: '16', is_recorded: '0', call_id_with_rec: '' }],
    ];
    for (const [ms, body] of steps) {
      setTimeout(() => {
        const ev = provider.parse(body);
        if (ev) void this.ingestService.ingest(account, ev, body).catch((e: Error) => this.logger.warn(`mock callback: ${e.message}`));
      }, ms).unref?.();
    }
  }

  // ---- Recordings ----

  private async mayPlay(v: CallsViewer) {
    if (isAdmin(v.role)) return true;
    return (await this.accounts.row(v.tenantId))?.recordingsAccess === 'CALL_VIEWERS';
  }

  async recording(v: CallsViewer, id: string) {
    const c = await this.visibleCall(v, id);
    if (!(await this.mayPlay(v))) throw new ForbiddenException("Yozuvlarni faqat direktor va admin tinglaydi");
    if (!c.hasRecording) throw new NotFoundException("Bu qo'ng'iroqning yozuvi yo'q");
    const account = await this.accounts.row(v.tenantId);
    // The recording lives in the account it was made with.
    if (!account || account.provider !== c.provider) throw new NotFoundException("Yozuv saqlangan telefoniya akkaunti endi ulanmagan");
    const creds = this.accounts.open(account);
    if (!creds) throw new ServiceUnavailableException("Telefoniya kalitini ochib bo'lmadi");
    try {
      const link = await this.providers.get(account.provider).recordingLink(creds, { providerCallId: c.providerCallId, recordingRef: c.recordingRef });
      if (!link) throw new NotFoundException('Yozuv hali tayyor emas');
      return link;
    } catch (e) {
      if (e instanceof TelephonyProviderError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  // ---- Statistics ----

  /**
   * Calls per manager, missed calls and average talk time, per day or week,
   * in the center's own timezone. from/to are days (YYYY-MM-DD), to
   * included; at most a year. Center-wide: for owner, admins and whoever was
   * given calls.stats.
   */
  async stats(v: CallsViewer, q: { from?: string; to?: string; period?: string }) {
    const [t] = await this.db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, v.tenantId));
    const tz = isValidTimeZone(t?.timezone) ? t!.timezone : DEFAULT_TIMEZONE;
    const period = q.period === 'week' ? 'week' : 'day';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const to = q.to && DATE.test(q.to) ? q.to : today;
    const defaultFrom = new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    const from = q.from && DATE.test(q.from) ? q.from : defaultFrom;
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const start = zonedTimeToUtc(fy, fm, fd, 0, 0, tz);
    const end = new Date(zonedTimeToUtc(ty, tm, td, 0, 0, tz).getTime() + 86_400_000);
    if (!(start < end) || end.getTime() - start.getTime() > 367 * 86_400_000) throw new BadRequestException("Sana oralig'i noto'g'ri (ko'pi bilan 1 yil)");

    const inRange = and(eq(calls.tenantId, v.tenantId), gte(calls.startedAt, start), lt(calls.startedAt, end))!;
    // Stored as UTC wall-clock time (app-written): read in the center's zone.
    const local = sql`((${calls.startedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;
    const answered = sql<number>`count(*) FILTER (WHERE ${calls.status} = 'ANSWERED')::int`;
    const missed = sql<number>`count(*) FILTER (WHERE ${calls.status} = 'MISSED' AND ${calls.direction} = 'INBOUND')::int`;
    const avgTalk = sql<number>`coalesce(round(avg(${calls.durationSec}) FILTER (WHERE ${calls.status} = 'ANSWERED'))::int, 0)`;
    const talk = sql<number>`coalesce(sum(${calls.durationSec}) FILTER (WHERE ${calls.status} = 'ANSWERED'), 0)::int`;
    const base = {
      total: sql<number>`count(*)::int`,
      inbound: sql<number>`count(*) FILTER (WHERE ${calls.direction} = 'INBOUND')::int`,
      outbound: sql<number>`count(*) FILTER (WHERE ${calls.direction} = 'OUTBOUND')::int`,
      answered, missed, avgTalkSec: avgTalk, talkSec: talk,
    };

    const [totals] = await this.db.select(base).from(calls).where(inRange);
    const byManager = await this.db
      .select({ userId: calls.managerUserId, fullName: users.fullName, ...base })
      .from(calls)
      .leftJoin(users, eq(users.id, calls.managerUserId))
      .where(inRange)
      .groupBy(calls.managerUserId, users.fullName)
      .orderBy(desc(sql`count(*)`));
    const bucket = sql<string>`to_char(date_trunc(${period}, ${local}), 'YYYY-MM-DD')`;
    const series = await this.db
      .select({ bucket, total: base.total, answered, missed, avgTalkSec: avgTalk })
      .from(calls)
      .where(inRange)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return { from, to, period, timezone: tz, totals, byManager, series };
  }
}
