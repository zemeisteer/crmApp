import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { callEvents, calls, telephonyExtensions } from '../db/schema';
import { maskPhone, normalizePhone } from '../leads/phone';
import { LeadsService } from '../leads/leads.service';
import { CallsHub, type CallPhase } from './calls-hub.service';
import { matchContact } from './contact-match';
import type { CallEvent } from './providers/telephony-provider.interface';
import type { TelephonyAccountRow } from './telephony-accounts.service';

type CallRow = typeof calls.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface IngestResult {
  duplicate: boolean;
  callId: string | null;
  /** The event that changed the call (for the live popup, telephony step 3). */
  event?: CallEvent['kind'];
}

const fmtDuration = (s: number | null | undefined) => {
  const v = Math.max(0, s ?? 0);
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

/**
 * Turns provider events into the call log. Each event is stored once
 * (call_events.dedupe_key, in the same transaction that changes the call), so
 * a repeated delivery changes nothing. Events may arrive in any order: the
 * call row is created by whichever comes first and locked while an event is
 * applied, and a call that was answered is never turned back into a missed
 * one by a later leg's end.
 *
 * After that, the other party is matched to this center's people
 * (contact-match.ts); an incoming call from an unknown number opens a lead
 * with source PHONE, answered or not. Matching runs again on every event of
 * a call that is still UNKNOWN, so a failure in the middle heals itself on
 * the next event.
 */
@Injectable()
export class CallIngestService {
  private readonly logger = new Logger(CallIngestService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly leadsService: LeadsService,
    private readonly hub: CallsHub,
  ) {}

  async ingest(account: TelephonyAccountRow, ev: CallEvent, payload: Record<string, string>): Promise<IngestResult> {
    const tenantId = account.tenantId;
    const provider = account.provider;
    const now = new Date();

    const applied = await this.db.transaction(async (tx) => {
      const [stored] = await tx
        .insert(callEvents)
        .values({ tenantId, provider, eventType: ev.eventType, dedupeKey: ev.dedupeKey, payload, receivedAt: now })
        .onConflictDoNothing()
        .returning({ id: callEvents.id });
      if (!stored) return null; // already received: nothing to do
      if (ev.kind === 'IGNORED') return { call: null as CallRow | null, finished: false };

      const clientNumber = normalizePhone(ev.clientNumber);
      await tx
        .insert(calls)
        .values({
          tenantId,
          provider,
          providerCallId: ev.providerCallId,
          direction: ev.kind.startsWith('OUTBOUND') ? 'OUTBOUND' : 'INBOUND',
          callerNumber: ev.callerNumber ?? null,
          calledNumber: ev.calledNumber ?? null,
          clientNumber,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const [call] = await tx
        .select()
        .from(calls)
        .where(and(eq(calls.tenantId, tenantId), eq(calls.provider, provider), eq(calls.providerCallId, ev.providerCallId)))
        .for('update');

      const patch = await this.patchFor(tx, tenantId, call, ev, clientNumber, now);
      const [updated] = await tx.update(calls).set({ ...patch, updatedAt: now }).where(eq(calls.id, call.id)).returning();
      await tx.update(callEvents).set({ callId: call.id }).where(eq(callEvents.id, stored.id));
      return { call: updated, finished: !call.endedAt && Boolean(updated.endedAt) };
    });

    if (!applied) return { duplicate: true, callId: null };
    if (!applied.call) return { duplicate: false, callId: null, event: ev.kind };
    let call = applied.call;

    if (call.contactKind === 'UNKNOWN' && call.clientNumber) call = await this.linkContact(call);
    // A lead this call opened goes to whoever answered it.
    if (call.createdLead && call.leadId && call.status === 'ANSWERED' && call.managerUserId) {
      await this.leadsService.assignFromCall(call.tenantId, call.leadId, call.managerUserId, call.id).catch((e: Error) =>
        this.logger.warn(JSON.stringify({ op: 'telephony.assign_failed', tenantId: call.tenantId, callId: call.id, error: e.message })));
    }
    if (applied.finished && call.leadId) await this.noteOnLead(call);
    await this.announce(call, ev);
    return { duplicate: false, callId: call.id, event: ev.kind };
  }

  /** The live popup: who should hear about this event (calls-hub.service.ts). */
  private async announce(call: CallRow, ev: CallEvent) {
    let phase: CallPhase | null = null;
    const users: string[] = [];
    if (ev.kind === 'RINGING_EXTENSION' && call.direction === 'INBOUND' && call.status === 'RINGING' && !call.endedAt && ev.extension) {
      phase = 'ringing';
      const u = await this.userForExtension(this.db, call.tenantId, ev.extension);
      if (u) users.push(u);
    } else if (ev.kind === 'ANSWERED' && !call.endedAt) {
      phase = 'answered';
    } else if (ev.kind === 'INBOUND_END' || ev.kind === 'OUTBOUND_END') {
      phase = 'ended';
    }
    if (!phase) return;
    if (call.managerUserId) users.push(call.managerUserId);
    await this.hub.publish(call.tenantId, call.id, phase, users);
  }

  /** What this event changes on the call. */
  private async patchFor(tx: Tx, tenantId: string, call: CallRow, ev: CallEvent, clientNumber: string | null, now: Date): Promise<Partial<CallRow>> {
    const p: Partial<CallRow> = {};
    if (!call.clientNumber && clientNumber) p.clientNumber = clientNumber;
    if (!call.callerNumber && ev.callerNumber) p.callerNumber = ev.callerNumber;
    if (!call.calledNumber && ev.calledNumber) p.calledNumber = ev.calledNumber;
    // The event that names the direction wins over a guess made by an earlier, out-of-order one.
    if (ev.kind.startsWith('OUTBOUND')) p.direction = 'OUTBOUND';
    if (ev.kind === 'INBOUND_START' || ev.kind === 'INBOUND_END' || ev.kind === 'RINGING_EXTENSION') p.direction = 'INBOUND';

    const setExtension = async (ext: string | null | undefined) => {
      if (!ext) return;
      p.extension = ext;
      p.managerUserId = await this.userForExtension(tx, tenantId, ext);
    };
    const answered = call.status === 'ANSWERED';

    switch (ev.kind) {
      case 'RINGING_EXTENSION':
      case 'OUTBOUND_START':
        if (!answered && !call.endedAt) await setExtension(ev.extension);
        break;
      case 'ANSWERED':
        if (!call.endedAt) {
          p.status = 'ANSWERED';
          p.answeredAt = call.answeredAt ?? now;
          await setExtension(ev.extension);
        }
        break;
      case 'INBOUND_END':
      case 'OUTBOUND_END': {
        const talked = Boolean(ev.answered);
        // A second leg's end (a transfer, a ring group) never undoes a conversation.
        if (talked || !answered) {
          p.status = talked || answered ? 'ANSWERED' : 'MISSED';
          p.disposition = ev.disposition ?? null;
          if (talked) {
            p.durationSec = Math.max(call.durationSec ?? 0, ev.durationSec ?? 0);
            p.answeredAt = call.answeredAt ?? now;
            await setExtension(ev.extension);
          } else if (!answered) {
            p.durationSec = ev.durationSec ?? 0;
            if (!call.extension) await setExtension(ev.extension);
          }
        }
        p.endedAt = call.endedAt ?? now;
        if (ev.hasRecording) {
          p.hasRecording = true;
          p.recordingRef = ev.recordingRef ?? call.recordingRef;
        }
        break;
      }
      case 'RECORDING_READY':
        if (ev.recordingRef) {
          p.hasRecording = true;
          p.recordingRef = ev.recordingRef;
        }
        break;
    }
    return p;
  }

  private async userForExtension(tx: Tx | Database, tenantId: string, extension: string) {
    const [r] = await tx
      .select({ userId: telephonyExtensions.userId })
      .from(telephonyExtensions)
      .where(and(eq(telephonyExtensions.tenantId, tenantId), eq(telephonyExtensions.extension, extension)));
    return r?.userId ?? null;
  }

  /** Links the call to the center's lead or student; an unknown incoming number opens a lead. */
  private async linkContact(call: CallRow): Promise<CallRow> {
    const m = await matchContact(this.db, call.tenantId, call.clientNumber!);
    let next: Partial<CallRow>;
    if (m.kind !== 'UNKNOWN') {
      next = { contactKind: m.kind, leadId: m.leadId, studentId: m.studentId };
    } else if (call.direction === 'INBOUND') {
      const lead = await this.leadsService.createFromCall(call.tenantId, { phoneNormalized: call.clientNumber!, callId: call.id });
      next = { contactKind: 'LEAD', leadId: lead.id, createdLead: lead.created };
      if (lead.created) {
        this.logger.log(JSON.stringify({ op: 'telephony.lead_from_call', tenantId: call.tenantId, callId: call.id, leadId: lead.id, phone: maskPhone(call.clientNumber) }));
      }
    } else {
      return call; // an outgoing call to a number nobody has: left as is
    }
    // Only while still unlinked: a concurrent event of the same call may have linked it first.
    const [row] = await this.db
      .update(calls)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(calls.id, call.id), eq(calls.tenantId, call.tenantId), eq(calls.contactKind, 'UNKNOWN')))
      .returning();
    if (row) return row;
    const [current] = await this.db.select().from(calls).where(and(eq(calls.id, call.id), eq(calls.tenantId, call.tenantId)));
    return current ?? call;
  }

  /** The finished call on the lead's timeline (once per call: only the event that ended it writes it). */
  private async noteOnLead(call: CallRow) {
    const incoming = call.direction === 'INBOUND';
    const body = call.status === 'ANSWERED'
      ? `${incoming ? "Kiruvchi" : "Chiquvchi"} qo'ng'iroq, ${fmtDuration(call.durationSec)}`
      : incoming ? "Javobsiz kiruvchi qo'ng'iroq" : "Chiquvchi qo'ng'iroqqa javob berilmadi";
    try {
      await this.leadsService.recordActivity(this.db, {
        tenantId: call.tenantId,
        leadId: call.leadId!,
        actorUserId: call.managerUserId,
        type: 'CALL',
        body,
        metadata: { kind: 'PHONE_CALL', callId: call.id, direction: call.direction, status: call.status, durationSec: call.durationSec },
        occurredAt: call.startedAt,
      });
    } catch (e) {
      // The call log is the record; a missing timeline note is logged, not fatal.
      this.logger.warn(JSON.stringify({ op: 'telephony.lead_note_failed', tenantId: call.tenantId, callId: call.id, error: (e as Error).message }));
    }
  }
}
