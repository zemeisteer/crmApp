import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Client } from 'pg';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, sessions, studentGuardians, studentPortalPins, students } from '../db/schema';
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
  allowed: Map<string, { ok: boolean; at: number }>;
}

/**
 * New-message delivery. A server-sent event stream per signed-in client
 * (fetched with its bearer token, never a token in the URL). Events carry
 * only {conversationId, seq}; the client then fetches the messages, which
 * checks access again. Messages are announced through PostgreSQL
 * NOTIFY, so every API instance tells its own clients.
 *
 * Before an event goes to a client its access to that conversation is
 * checked (cached a few seconds); every heartbeat re-checks the client
 * itself (staff: the session and the active membership; cabinet: the
 * student, the PIN, a parent's guardian link) and closes the stream when it
 * no longer holds.
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
    } catch (err) {
      this.logger.warn(`chat listener could not start: ${(err as Error).message}`);
      await client.end().catch(() => undefined);
      setTimeout(() => void this.listen(), 5000).unref?.();
    }
  }

  private async publish(tenantId: string, conversationId: string, seq: number) {
    const payload = JSON.stringify({ t: tenantId, c: conversationId, s: seq });
    if (this.listener) {
      await this.db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
    } else {
      // No listener (it is reconnecting): at least this instance's clients hear it.
      await this.deliver(tenantId, conversationId, seq);
    }
  }

  private async deliver(tenantId: string, conversationId: string, seq: number) {
    // (dropping a client while iterating is safe for a Map)
    for (const s of this.subs.values()) {
      if (s.actor.tenantId !== tenantId) continue;
      const cached = s.allowed.get(conversationId);
      let ok = cached && Date.now() - cached.at < 5000 ? cached.ok : undefined;
      if (ok === undefined) {
        ok = await this.chat.canRead(s.actor, conversationId).catch(() => false);
        s.allowed.set(conversationId, { ok, at: Date.now() });
      }
      if (ok) this.write(s, 'message', { conversationId, seq });
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

  /** Whether the client behind a stream may still use chat at all. */
  async stillValid(actor: ChatActor, sid?: string, iat?: number): Promise<boolean> {
    if (actor.kind === 'staff') {
      if (sid) {
        const [s] = await this.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, sid), eq(sessions.userId, actor.userId)));
        if (!s) return false;
      }
      const [m] = await this.db.select({ status: organizationMemberships.status, role: organizationMemberships.role, access: organizationMemberships.access }).from(organizationMemberships)
        .where(and(eq(organizationMemberships.userId, actor.userId), eq(organizationMemberships.tenantId, actor.tenantId)));
      if (!m || m.status !== 'ACTIVE') return false;
      // Role or list changed meanwhile: later checks use the current ones.
      actor.role = m.role;
      actor.access = m.access;
      return true;
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
      id: randomUUID(), actor, sid: auth.sid, iat: auth.iat, res, allowed: new Map(),
      heartbeat: setInterval(() => {
        void this.stillValid(actor, auth.sid, auth.iat).then((ok) => {
          if (!ok) {
            this.write(s, 'revoked', {});
            this.drop(s);
            return;
          }
          s.allowed.clear();
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
