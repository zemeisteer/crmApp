import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Client } from 'pg';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, sessions, studentGuardians, studentPortalPins, students } from '../db/schema';
import { effectiveAccess } from '../access/catalog';
import type { ChatActor } from './chat-access';
import { ChatService } from './chat.service';

const CHANNEL = 'chat_events';

interface Subscriber {
  id: string;
  actor: ChatActor;
  /** Staff: the session id; cabinet: the token's issue time (seconds). */
  sid?: string;
  iat?: number;
  res: Response;
  heartbeat: NodeJS.Timeout;
}

/**
 * New-message delivery. A server-sent event stream per signed-in client
 * (fetched with its bearer token, never a token in the URL). Events carry
 * only {conversationId, seq}; the client then fetches the messages, which
 * checks access again. Messages are announced through PostgreSQL
 * NOTIFY, so every API instance tells its own clients.
 *
 * Before an event goes to a client two things are checked against the
 * database, with no cache: that the client may still use chat at all
 * (staff: the session, still on this center; the active membership; chat.use
 * in the access list - cabinet: the student, the PIN, a parent's guardian
 * link), and that it may read that conversation. A client that fails the
 * first is told "revoked" and its stream is closed, so nothing is announced
 * after a sign-out, a switch to another center, a removed permission or a
 * removed link. The heartbeat makes the same check for streams that are
 * idle.
 *
 * Losing the LISTEN connection loses whatever was announced meanwhile. A
 * sender always announces through NOTIFY (which needs no listener), and
 * tells its own clients directly while its listener is down; when the
 * listener is back every client is told "resync" and fetches what it missed
 * (the history is read by sequence number, so nothing is skipped or shown
 * twice).
 */
@Injectable()
export class ChatHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatHub.name);
  private readonly subs = new Map<string, Subscriber>();
  private listener: Client | null = null;
  private stopped = false;
  private readonly heartbeatMs: number;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chat: ChatService,
    private readonly config: ConfigService,
  ) {
    this.heartbeatMs = Number(config.get('CHAT_HEARTBEAT_MS') ?? 25_000);
  }

  async onModuleInit() {
    this.chat.onMessage((tenantId, conversationId, seq) => this.publish(tenantId, conversationId, seq));
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
      this.logger.warn(`chat listener lost: ${err.message}`);
      this.listener = null;
      setTimeout(() => void this.listen(), 2000).unref?.();
    });
    client.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        const p = JSON.parse(n.payload) as { t: string; c: string; s: number };
        void this.deliver(p.t, p.c, p.s);
      } catch {
        // not ours
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.listener = client;
      // Back after a gap (or for the first time, with nobody connected yet):
      // whatever was announced meanwhile is fetched by the clients.
      for (const s of this.subs.values()) this.write(s, 'resync', {});
    } catch (err) {
      this.logger.warn(`chat listener could not start: ${(err as Error).message}`);
      await client.end().catch(() => undefined);
      setTimeout(() => void this.listen(), 5000).unref?.();
    }
  }

  private async publish(tenantId: string, conversationId: string, seq: number) {
    const payload = JSON.stringify({ t: tenantId, c: conversationId, s: seq });
    // NOTIFY goes out through the pool whether or not this instance is
    // listening: the other instances must hear it either way.
    const heardHere = !!this.listener;
    await this.db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
    // This instance would not hear its own announcement: tell its clients directly.
    if (!heardHere) await this.deliver(tenantId, conversationId, seq);
  }

  private async deliver(tenantId: string, conversationId: string, seq: number) {
    // (dropping a client while iterating is safe for a Map)
    // Each client is checked on its own, side by side: one slow check does
    // not hold the announcement back from the others.
    await Promise.all([...this.subs.values()].filter((s) => s.actor.tenantId === tenantId).map(async (s) => {
      // Asked now, not remembered: a permission that ended a moment ago must
      // not let one more announcement through.
      const valid = await this.stillValid(s.actor, s.sid, s.iat).catch(() => false);
      if (!this.subs.has(s.id)) return;
      if (!valid) {
        this.write(s, 'revoked', {});
        this.drop(s);
        return;
      }
      if (await this.chat.canRead(s.actor, conversationId).catch(() => false)) this.write(s, 'message', { conversationId, seq });
    }));
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

  /** Whether the client behind a stream may still use chat at all. */
  async stillValid(actor: ChatActor, sid?: string, iat?: number): Promise<boolean> {
    if (actor.kind === 'staff') {
      if (sid) {
        const [s] = await this.db.select({ id: sessions.id, tenantId: sessions.tenantId }).from(sessions).where(and(eq(sessions.id, sid), eq(sessions.userId, actor.userId)));
        // Signed out, or the session moved to another center (a workspace switch keeps the session).
        if (!s || (s.tenantId && s.tenantId !== actor.tenantId)) return false;
      }
      const [m] = await this.db.select({ status: organizationMemberships.status, role: organizationMemberships.role, access: organizationMemberships.access }).from(organizationMemberships)
        .where(and(eq(organizationMemberships.userId, actor.userId), eq(organizationMemberships.tenantId, actor.tenantId)));
      if (!m || m.status !== 'ACTIVE') return false;
      // Role or list changed meanwhile: later checks use the current ones.
      actor.role = m.role;
      actor.access = m.access;
      // The page itself needs chat.use: without it there is no stream either.
      return effectiveAccess(m.role, m.access).includes('chat.use');
    }
    const [row] = await this.db.select({ id: students.id, pin: studentPortalPins.updatedAt }).from(students)
      .leftJoin(studentPortalPins, eq(studentPortalPins.studentId, students.id))
      .where(and(eq(students.id, actor.studentId), eq(students.tenantId, actor.tenantId), isNull(students.deletedAt)));
    if (!row) return false;
    if (row.pin && iat !== undefined && iat < Math.floor(row.pin.getTime() / 1000)) return false;
    if (actor.parentUserId) {
      const [g] = await this.db.select({ id: studentGuardians.id }).from(studentGuardians)
        .innerJoin(organizationMemberships, and(eq(organizationMemberships.userId, studentGuardians.userId), eq(organizationMemberships.tenantId, studentGuardians.tenantId)))
        .where(and(eq(studentGuardians.studentId, actor.studentId), eq(studentGuardians.userId, actor.parentUserId), eq(studentGuardians.tenantId, actor.tenantId), eq(organizationMemberships.status, 'ACTIVE')));
      if (!g) return false;
    }
    return true;
  }

  /** Opens an event stream for a signed-in client. */
  subscribe(actor: ChatActor, auth: { sid?: string; iat?: number }, req: Request, res: Response) {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx: do not buffer the stream.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const s: Subscriber = {
      id: randomUUID(), actor, sid: auth.sid, iat: auth.iat, res,
      heartbeat: setInterval(() => {
        void this.stillValid(actor, auth.sid, auth.iat).then((ok) => {
          if (!ok) {
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
    res.write(`event: ready\ndata: {}\n\n`);
    req.on('close', () => this.drop(s));
  }

  /** For tests: open streams. */
  get size() {
    return this.subs.size;
  }
}
