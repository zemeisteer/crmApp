import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Client } from 'pg';
import { effectiveAccess } from '../access/catalog';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, sessions } from '../db/schema';

const CHANNEL = 'telephony_events';
/** How long a call's popup recipients are remembered (to close it on every screen it opened on). */
const CALL_MEMORY_MS = 30 * 60_000;

export type CallPhase = 'ringing' | 'answered' | 'ended';

interface Subscriber {
  id: string;
  tenantId: string;
  userId: string;
  sid?: string;
  res: Response;
  heartbeat: NodeJS.Timeout;
}

/**
 * The incoming-call popup. One server-sent event stream per signed-in staff
 * tab (fetched with its bearer token, as the chat stream is). Events carry
 * only {callId, phase}; the page then asks for the caller's card, which
 * checks access again.
 *
 * - ringing: to the staff member whose extension is ringing (several, for
 *   a ring group).
 * - answered / ended: to every tab the ringing went to, so the popup closes
 *   (or says who took the call) everywhere, plus the one who answered.
 *
 * Announcements go through PostgreSQL NOTIFY, so every API instance tells
 * its own clients. Before anything is written to a client, its session (not
 * signed out, still on this center), its membership and calls.view are
 * checked against the database; a client that fails is told "revoked" and
 * its stream is closed. The heartbeat makes the same check for idle streams.
 */
@Injectable()
export class CallsHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallsHub.name);
  private readonly subs = new Map<string, Subscriber>();
  /** callId -> subscriber ids its ringing reached on this instance. */
  private readonly rang = new Map<string, { subs: Set<string>; at: number }>();
  private listener: Client | null = null;
  private stopped = false;
  private readonly heartbeatMs: number;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    this.heartbeatMs = Number(config.get('CALLS_HEARTBEAT_MS') ?? 25_000);
  }

  async onModuleInit() {
    await this.listen();
  }

  async onModuleDestroy() {
    this.stopped = true;
    for (const s of this.subs.values()) this.drop(s);
    await this.listener?.end().catch(() => undefined);
  }

  private async listen() {
    if (this.stopped) return;
    const url = this.config.get<string>('DATABASE_URL');
    if (!url) return;
    const client = new Client({ connectionString: url });
    client.on('error', (err) => {
      this.logger.warn(`calls listener lost: ${err.message}`);
      this.listener = null;
      setTimeout(() => void this.listen(), 2000).unref?.();
    });
    client.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        const p = JSON.parse(n.payload) as { t: string; c: string; p: CallPhase; u: string[] };
        void this.deliver(p.t, p.c, p.p, p.u);
      } catch {
        // not ours
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.listener = client;
    } catch (err) {
      this.logger.warn(`calls listener could not start: ${(err as Error).message}`);
      await client.end().catch(() => undefined);
      setTimeout(() => void this.listen(), 5000).unref?.();
    }
  }

  /** Tells the center's staff (userIds, plus whoever saw this call ring) about a call. */
  async publish(tenantId: string, callId: string, phase: CallPhase, userIds: string[]) {
    const payload = JSON.stringify({ t: tenantId, c: callId, p: phase, u: [...new Set(userIds)] });
    const heardHere = !!this.listener;
    try {
      await this.db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
    } catch (err) {
      this.logger.warn(`calls announce failed: ${(err as Error).message}`);
    }
    // This instance would not hear its own announcement while its listener is down.
    if (!heardHere) await this.deliver(tenantId, callId, phase, userIds);
  }

  private async deliver(tenantId: string, callId: string, phase: CallPhase, userIds: string[]) {
    const now = Date.now();
    for (const [id, r] of this.rang) if (now - r.at > CALL_MEMORY_MS) this.rang.delete(id);
    const seen = this.rang.get(callId);
    const targets = [...this.subs.values()].filter(
      (s) => s.tenantId === tenantId && (userIds.includes(s.userId) || (phase !== 'ringing' && seen?.subs.has(s.id))),
    );
    if (targets.length === 0) {
      if (phase === 'ended') this.rang.delete(callId);
      return;
    }
    const valid = await this.validUsers(tenantId, targets);
    for (const s of targets) {
      if (!this.subs.has(s.id)) continue;
      if (!valid(s)) {
        this.write(s, 'revoked', {});
        this.drop(s);
        continue;
      }
      this.write(s, 'call', { callId, phase });
      if (phase === 'ringing') {
        const r = this.rang.get(callId) ?? { subs: new Set<string>(), at: now };
        r.subs.add(s.id);
        this.rang.set(callId, r);
      }
    }
    if (phase === 'ended') this.rang.delete(callId);
  }

  /** One look-up for all the streams of one delivery: sessions and memberships, as they are now. */
  private async validUsers(tenantId: string, subs: Subscriber[]): Promise<(s: Subscriber) => boolean> {
    const sids = [...new Set(subs.map((s) => s.sid).filter((x): x is string => !!x))];
    const userIds = [...new Set(subs.map((s) => s.userId))];
    try {
      const [ss, ms] = await Promise.all([
        sids.length ? this.db.select({ id: sessions.id, userId: sessions.userId, tenantId: sessions.tenantId }).from(sessions).where(inArray(sessions.id, sids)) : [],
        this.db.select({ userId: organizationMemberships.userId, status: organizationMemberships.status, role: organizationMemberships.role, access: organizationMemberships.access })
          .from(organizationMemberships).where(and(inArray(organizationMemberships.userId, userIds), eq(organizationMemberships.tenantId, tenantId))),
      ]);
      const sessionsById = new Map(ss.map((x) => [x.id, x]));
      const members = new Map(ms.map((x) => [x.userId, x]));
      return (s) => {
        if (s.sid) {
          const session = sessionsById.get(s.sid);
          if (!session || session.userId !== s.userId || (session.tenantId && session.tenantId !== tenantId)) return false;
        }
        const m = members.get(s.userId);
        return !!m && m.status === 'ACTIVE' && effectiveAccess(m.role, m.access).includes('calls.view');
      };
    } catch {
      return () => false;
    }
  }

  private write(s: Subscriber, event: string, data: unknown) {
    try {
      s.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.drop(s);
    }
  }

  private drop(s: Subscriber) {
    clearInterval(s.heartbeat);
    this.subs.delete(s.id);
    try {
      s.res.end();
    } catch {
      // already closed
    }
  }

  /** Opens the stream for a signed-in staff member of a center. */
  subscribe(user: { tenantId: string; userId: string; sid?: string }, req: Request, res: Response) {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const s: Subscriber = {
      id: randomUUID(), tenantId: user.tenantId, userId: user.userId, sid: user.sid, res,
      heartbeat: setInterval(() => {
        void this.validUsers(s.tenantId, [s]).then((valid) => {
          if (!this.subs.has(s.id)) return;
          if (!valid(s)) {
            this.write(s, 'revoked', {});
            this.drop(s);
            return;
          }
          try {
            res.write(': ping\n\n');
          } catch {
            this.drop(s);
          }
        }, () => undefined);
      }, this.heartbeatMs),
    };
    s.heartbeat.unref?.();
    this.subs.set(s.id, s);
    res.write('event: ready\ndata: {}\n\n');
    req.on('close', () => this.drop(s));
  }

  /** For tests: open streams. */
  get size() {
    return this.subs.size;
  }
}
