import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { calendarConnections, calendarEventLinks, calendarOauthStates, organizationMemberships, tenants } from '../db/schema';
import { CalendarChanges } from '../lessons/calendar-changes';
import { addDays } from '../lessons/occurrences';
import { CalendarEventsService, scopeForRole, type CalendarScope } from './calendar-events.service';
import { GOOGLE_CALENDAR_API, GoogleApiError, type GoogleCalendarApi, type GoogleEventBody } from './google-calendar.api';
import type { CalEvent } from './ics';
import { TokenCrypto } from './token-crypto';

type Connection = typeof calendarConnections.$inferSelect;

const sha256 = (s: string) => createHash('sha256').update(s).digest();
/** A Google account, as stored: its primary calendar's id (an address), hashed. */
const accountKeyOf = (primaryCalendarId: string) => sha256(primaryCalendarId.toLowerCase()).toString('hex');
const STATE_TTL_MS = 10 * 60_000;
const LOCK_MS = 5 * 60_000;
const FULL_RESYNC_MS = 6 * 3_600_000;
const MAX_BACKOFF_S = 3600;
// Google: the next 60 days and the past week.
const WINDOW_BACK = 7;
const WINDOW_AHEAD = 60;

// RFC 4648 base32hex, lower case: the characters Google allows in event ids.
function base32hex(buf: Buffer): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/** The same id for the same lesson in the same connection: a retried insert can never make a second event. */
export function providerEventId(connectionId: string, eventKey: string): string {
  return `crm${base32hex(sha256(`${connectionId}:${eventKey}`)).slice(0, 40)}`;
}

function eventBody(e: CalEvent, id?: string): GoogleEventBody {
  return {
    ...(id ? { id } : {}),
    summary: e.title,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
    start: { dateTime: e.start.toISOString() },
    end: { dateTime: e.end.toISOString() },
    status: 'confirmed',
    extendedProperties: { private: { talimcrm: '1', key: e.uid } },
  };
}

const hashOf = (e: CalEvent, calendarId: string) =>
  createHash('sha256').update(JSON.stringify([calendarId, e.title, e.start.toISOString(), e.end.toISOString(), e.location ?? '', e.description ?? ''])).digest('hex');

/**
 * Google Calendar, outbound only: the CRM writes a user's lessons into one
 * chosen calendar of theirs and never reads events back, so nothing edited
 * in Google changes a lesson, a schedule or a bill.
 *
 * Durability: any lesson change marks the center's connections as needing
 * a sync (a row update, awaited by the writer); a poller picks up due
 * connections (claimed with a lease, so several API instances share the
 * work) and also re-syncs every connection every 6 hours. A restart loses
 * nothing: what is pending is in the database.
 *
 * One actor per connection: the lease (lockedUntil + lock_token) is held by
 * whoever writes to Google for it - a sync or a disconnect's clean-up - and
 * every disconnect, reconnect and calendar switch raises the row's epoch.
 * Before each write to Google the worker renews its lease, which succeeds
 * only while the token, the epoch and the status are still the ones it
 * started with: a long sync keeps its lease for as long as it makes
 * progress, and a worker that began before a disconnect or a switch, or
 * that stalled until another one took over, writes nothing more. Whatever a
 * worker writes to the row is conditional on its own token: it can neither
 * free another worker's lease nor overwrite or delete a row it lost.
 *
 * Whose account: the primary calendar's id. A reconnect is one of
 *  - the same account (confirmed): the calendar choice and the events stay;
 *  - another account (confirmed): the old account's events are removed
 *    first, with the old grant, by the ordinary disconnect clean-up (seen
 *    in the status, retried with backoff), and only then does the new grant
 *    become the connection;
 *  - not known (Google would not say - a rate limit, an error, a timeout,
 *    an empty list, no primary calendar): nothing is changed. The old
 *    calendar, tokens and events stay exactly as they were.
 *
 * Disconnect, in this order: (1) the row becomes DISCONNECTING (no new
 * sync); (2) the events we created are deleted from Google - a rate limit,
 * a server error or a timeout keeps the row and its links and the poller
 * tries again with backoff; (3) only when none is left is the grant
 * revoked; (4) the tokens and the row are deleted. When the grant is
 * already gone the events cannot be removed by us: the row stays as
 * CLEANUP_FAILED with the count and the dates until the user has seen it.
 */
@Injectable()
export class CalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarSyncService.name);
  private readonly crypto: TokenCrypto;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(GOOGLE_CALENDAR_API) private readonly google: GoogleCalendarApi,
    private readonly config: ConfigService,
    private readonly events: CalendarEventsService,
    private readonly changes: CalendarChanges,
    private readonly audit: AuditService,
  ) {
    this.crypto = new TokenCrypto({ CALENDAR_TOKEN_KEY: config.get('CALENDAR_TOKEN_KEY'), JWT_SECRET: config.get('JWT_SECRET') });
  }

  onModuleInit() {
    this.changes.onChange((tenantId) => this.markTenantDirty(tenantId));
    const ms = Number(this.config.get('CALENDAR_SYNC_MS') ?? 60_000);
    if (this.configured && ms > 0) {
      if (!this.crypto.dedicated) this.logger.warn('CALENDAR_TOKEN_KEY is not set: OAuth tokens are encrypted with a key derived from JWT_SECRET');
      this.timer = setInterval(() => void this.syncDue().catch((err) => this.logger.warn(`calendar sync: ${(err as Error).message}`)), ms);
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  get configured() {
    return !!(this.config.get('GOOGLE_CLIENT_ID') && this.config.get('GOOGLE_CLIENT_SECRET') && this.config.get('GOOGLE_REDIRECT_URI'));
  }

  async markTenantDirty(tenantId: string) {
    await this.db.update(calendarConnections).set({ syncRequestedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(calendarConnections.tenantId, tenantId), eq(calendarConnections.status, 'ACTIVE')));
  }

  private async scopeOf(tenantId: string, userId: string): Promise<CalendarScope> {
    const [m] = await this.db.select({ role: organizationMemberships.role, status: organizationMemberships.status }).from(organizationMemberships)
      .where(and(eq(organizationMemberships.tenantId, tenantId), eq(organizationMemberships.userId, userId)));
    const scope = m?.status === 'ACTIVE' ? scopeForRole(m.role) : null;
    if (!scope) throw new BadRequestException("Bu hisob uchun kalendar yo'q");
    return scope;
  }

  private async mine(tenantId: string, userId: string) {
    const [c] = await this.db.select().from(calendarConnections)
      .where(and(eq(calendarConnections.tenantId, tenantId), eq(calendarConnections.userId, userId), eq(calendarConnections.provider, 'GOOGLE')));
    return c ?? null;
  }

  // ---- connect / status / settings ---------------------------------------

  async status(tenantId: string, userId: string) {
    const c = await this.mine(tenantId, userId);
    if (!c) return { configured: this.configured, connection: null };
    // What is still to be removed from Google (a disconnect in progress), or
    // was left behind in an account we can no longer reach.
    let cleanup: { events: number; from: string | null; to: string | null } | null = null;
    if (c.status === 'DISCONNECTING' || c.status === 'CLEANUP_FAILED') {
      const [l] = await this.db.select({ n: sql<number>`count(*)::int`, from: sql<string | null>`min(${calendarEventLinks.date})`, to: sql<string | null>`max(${calendarEventLinks.date})` })
        .from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, c.id));
      cleanup = { events: l?.n ?? 0, from: l?.from ?? null, to: l?.to ?? null };
    }
    return {
      configured: this.configured,
      connection: {
        status: c.status, scope: c.scope, calendarId: c.calendarId, calendarName: c.calendarName, lastSyncAt: c.lastSyncAt,
        lastError: c.lastError, pending: !!c.syncRequestedAt, nextAttemptAt: c.nextAttemptAt,
        cleanup,
        // Another Google account is waiting for the old one's events to be removed.
        switching: c.status === 'DISCONNECTING' && !!c.nextRefreshTokenEnc,
        // Events left in a Google account this connection was moved away from.
        leftoverEvents: c.leftoverEvents,
      },
    };
  }

  /** Starts OAuth: a one-time state (hashed) and a PKCE verifier (encrypted) for this user and center. */
  async connectUrl(tenantId: string, userId: string, returnTo?: string) {
    if (!this.configured) throw new BadRequestException({ code: 'GOOGLE_NOT_CONFIGURED', message: "Google Calendar ulanishi serverda sozlanmagan" });
    await this.scopeOf(tenantId, userId);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.db.delete(calendarOauthStates).where(lt(calendarOauthStates.expiresAt, new Date()));
    await this.db.insert(calendarOauthStates).values({
      stateHash: sha256(state).toString('hex'), tenantId, userId, verifierEnc: this.crypto.encrypt(verifier),
      returnTo: returnTo && /^\/[A-Za-z0-9/_-]*$/.test(returnTo) ? returnTo : null, expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    return { url: this.google.authUrl({ clientId: this.config.get('GOOGLE_CLIENT_ID')!, redirectUri: this.config.get('GOOGLE_REDIRECT_URI')!, state, codeChallenge: challenge }) };
  }

  /**
   * The OAuth callback. Who is connecting comes only from the stored state
   * (one use, 10 minutes); the code is exchanged with the stored verifier.
   * Returns where the browser goes next (the center's own address).
   *
   * Two callbacks for one user at the same moment (two tabs) are put in
   * order by an advisory lock around the decision and its write; the one
   * that finds the row changed since it looked decides again.
   */
  async callback(query: { code?: string; state?: string; error?: string }): Promise<string> {
    const front = (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(/\/+$/, '');
    if (!query.state || typeof query.state !== 'string') return `${front}/calendar?google=error`;
    const [row] = await this.db.update(calendarOauthStates).set({ usedAt: new Date() })
      .where(and(eq(calendarOauthStates.stateHash, sha256(query.state).toString('hex')), isNull(calendarOauthStates.usedAt)))
      .returning();
    const back = await this.centerUrl(row?.tenantId, front);
    const to = (code: string) => `${back}${row?.returnTo || '/calendar'}?google=${code}`;
    if (!row || row.expiresAt.getTime() < Date.now()) return to('expired');
    if (query.error || !query.code) return to('denied');
    let scope: CalendarScope;
    try {
      scope = await this.scopeOf(row.tenantId, row.userId);
    } catch {
      return to('error');
    }
    let tokens;
    try {
      tokens = await this.google.exchangeCode(query.code, this.crypto.decrypt(row.verifierEnc), this.config.get('GOOGLE_REDIRECT_URI')!);
    } catch (err) {
      this.logger.warn(`google code exchange failed: ${(err as Error).message}`);
      return to('error');
    }
    if (!tokens.refreshToken) return to('error');
    // Whose calendar this is: the primary calendar's id is the account. The
    // list also says whether a calendar chosen earlier still exists. No
    // answer, an empty list or no primary calendar: the account is not known.
    let calendars: Array<{ id: string; summary: string; primary?: boolean }> | null = null;
    try {
      calendars = await this.google.listCalendars(tokens.accessToken);
    } catch (err) {
      this.logger.warn(`google calendar list failed on connect: ${(err as Error).message}`);
    }
    const primary = calendars?.find((x) => x.primary)?.id ?? null;
    const grant = {
      accountKey: primary ? accountKeyOf(primary) : null,
      calendars: calendars ?? [],
      accessTokenEnc: this.crypto.encrypt(tokens.accessToken), refreshTokenEnc: this.crypto.encrypt(tokens.refreshToken), tokenExpiresAt: tokens.expiresAt,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      const old = await this.mine(row.tenantId, row.userId);
      const verdict = await this.compareAccounts(old, grant.accountKey, grant.calendars);
      const done = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`calendar:${row.tenantId}:${row.userId}`}))`);
        const [now] = await tx.select().from(calendarConnections)
          .where(and(eq(calendarConnections.tenantId, row.tenantId), eq(calendarConnections.userId, row.userId), eq(calendarConnections.provider, 'GOOGLE')));
        // Another callback, a disconnect or a clean-up got in between: decide again on what is there now.
        if ((now?.id ?? null) !== (old?.id ?? null)) return null;
        if (now && old && (now.epoch !== old.epoch || now.status !== old.status || now.accountKey !== old.accountKey || now.nextAccountKey !== old.nextAccountKey)) return null;

        const fresh = {
          accessTokenEnc: grant.accessTokenEnc, refreshTokenEnc: grant.refreshTokenEnc, tokenExpiresAt: grant.tokenExpiresAt, accountKey: grant.accountKey,
          nextAccessTokenEnc: null, nextRefreshTokenEnc: null, nextTokenExpiresAt: null, nextAccountKey: null,
          status: 'ACTIVE', scope, syncRequestedAt: new Date(), nextAttemptAt: null, attempts: 0, lastError: null, lockedUntil: null, lockToken: null, updatedAt: new Date(),
        };
        if (!now) {
          const [conn] = await tx.insert(calendarConnections).values({ tenantId: row.tenantId, userId: row.userId, provider: 'GOOGLE', calendarId: 'primary', calendarName: null, ...fresh }).returning({ id: calendarConnections.id });
          return { code: 'connected', id: conn.id, leftover: 0 };
        }
        if (verdict === 'UNKNOWN') return { code: 'unverified', id: now.id, leftover: now.leftoverEvents };
        if (verdict === 'OTHER') {
          // The new grant waits. The old account is cleaned with its own
          // grant by the disconnect machinery; a sync running now stops
          // (epoch), a clean-up already running goes on.
          await tx.update(calendarConnections).set({
            status: 'DISCONNECTING', epoch: now.status === 'DISCONNECTING' ? now.epoch : now.epoch + 1,
            nextAccessTokenEnc: grant.accessTokenEnc, nextRefreshTokenEnc: grant.refreshTokenEnc, nextTokenExpiresAt: grant.tokenExpiresAt, nextAccountKey: grant.accountKey,
            syncRequestedAt: null, nextAttemptAt: null, attempts: 0, lastError: null, updatedAt: new Date(),
          }).where(eq(calendarConnections.id, now.id));
          return { code: 'switching', id: now.id, leftover: now.leftoverEvents };
        }
        let leftover = now.leftoverEvents;
        if (verdict === 'UNREACHABLE') {
          // What the old grant wrote can no longer be reached by anyone but
          // the user: counted, shown, and never touched with the new grant.
          const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, now.id));
          leftover += n;
          await tx.delete(calendarEventLinks).where(eq(calendarEventLinks.connectionId, now.id));
        }
        // SAME or ASSUMED keep the chosen calendar when it is still there.
        const keepChoice = verdict !== 'UNREACHABLE' && (now.calendarId === 'primary' || grant.calendars.some((x) => x.id === now.calendarId));
        const chosen = grant.calendars.find((x) => x.id === now.calendarId);
        await tx.update(calendarConnections).set({
          ...fresh, leftoverEvents: leftover, epoch: now.epoch + 1,
          ...(keepChoice ? { calendarName: chosen?.summary ?? now.calendarName } : { calendarId: 'primary', calendarName: null }),
        }).where(eq(calendarConnections.id, now.id));
        return { code: 'connected', id: now.id, leftover };
      });
      if (!done) continue;
      this.audit.log({ tenantId: row.tenantId, userId: row.userId, action: 'calendar.google_connect', entityType: 'calendar_connection', entityId: done.id, meta: { account: verdict, result: done.code, leftover: done.leftover } });
      if (done.code !== 'switching') return to(done.code);
      // Usually nobody else is writing for the old account: clean it now.
      const claimed = await this.claim(done.id, 'DISCONNECTING');
      if (claimed) await this.cleanup(claimed).catch((err) => this.logger.warn(`calendar switch clean-up: ${(err as Error).message}`));
      const after = await this.mine(row.tenantId, row.userId);
      return to(after?.status === 'ACTIVE' ? 'connected' : 'switching');
    }
    return to('error');
  }

  /**
   * Is the grant that just arrived for the account the connection already
   * has?
   *  - NEW: there is no connection.
   *  - SAME / OTHER: both accounts are known and compared.
   *  - UNKNOWN: the new account is not known, or the old one could not be
   *    asked right now (Google did not answer): nothing may be changed.
   *  - UNREACHABLE: the old connection has no grant any more and its events
   *    were already given up (CLEANUP_FAILED) under another account.
   *  - ASSUMED: an old connection from before accounts were recorded whose
   *    grant no longer works. Nothing of it can be checked or removed with
   *    the old grant; its events have ids of their own, so the same account
   *    gets them updated in place and another account gets its own copies.
   */
  private async compareAccounts(old: Connection | null, newKey: string | null, calendars: Array<{ id: string }>): Promise<'NEW' | 'SAME' | 'OTHER' | 'UNKNOWN' | 'UNREACHABLE' | 'ASSUMED'> {
    if (!old) return 'NEW';
    if (!newKey) return 'UNKNOWN';
    if (old.accountKey) {
      if (old.accountKey === newKey) return 'SAME';
      return old.status === 'CLEANUP_FAILED' ? 'UNREACHABLE' : 'OTHER';
    }
    // No account on record. A calendar of its own that the new account has too is the same account.
    if (old.calendarId !== 'primary' && calendars.some((x) => x.id === old.calendarId)) return 'SAME';
    if (old.status === 'CLEANUP_FAILED') return 'UNREACHABLE';
    try {
      const list = await this.google.listCalendars(await this.accessToken(old));
      const primary = list.find((x) => x.primary)?.id;
      if (!primary) return 'UNKNOWN';
      return accountKeyOf(primary) === newKey ? 'SAME' : 'OTHER';
    } catch (err) {
      return err instanceof GoogleApiError && err.auth ? 'ASSUMED' : 'UNKNOWN';
    }
  }

  private async centerUrl(tenantId: string | undefined, front: string) {
    const root = this.config.get<string>('ROOT_DOMAIN');
    if (!tenantId || !root) return front;
    const [t] = await this.db.select({ sub: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t) return front;
    try {
      const u = new URL(front);
      return `${u.protocol}//${t.sub}.${root}${u.port ? `:${u.port}` : ''}`;
    } catch {
      return front;
    }
  }

  private async accessToken(c: Connection): Promise<string> {
    if (c.accessTokenEnc && c.tokenExpiresAt && c.tokenExpiresAt.getTime() > Date.now() + 60_000) return this.crypto.decrypt(c.accessTokenEnc);
    if (!c.refreshTokenEnc) throw new GoogleApiError('no refresh token', 401, false, true);
    const t = await this.google.refresh(this.crypto.decrypt(c.refreshTokenEnc));
    await this.db.update(calendarConnections).set({
      accessTokenEnc: this.crypto.encrypt(t.accessToken), tokenExpiresAt: t.expiresAt,
      ...(t.refreshToken ? { refreshTokenEnc: this.crypto.encrypt(t.refreshToken) } : {}), updatedAt: new Date(),
      // Only for the grant this was refreshed from: after a reconnect the row holds other tokens.
    }).where(and(eq(calendarConnections.id, c.id), eq(calendarConnections.epoch, c.epoch)));
    return t.accessToken;
  }

  async calendars(tenantId: string, userId: string) {
    const c = await this.mine(tenantId, userId);
    if (!c) throw new NotFoundException('Google Calendar ulanmagan');
    try {
      return await this.google.listCalendars(await this.accessToken(c));
    } catch (err) {
      await this.failed(c, err);
      throw new ConflictException({ code: 'GOOGLE_UNAVAILABLE', message: 'Google Calendar javob bermadi. Keyinroq urinib ko\'ring yoki qayta ulang.' });
    }
  }

  async setCalendar(tenantId: string, userId: string, calendarId: string) {
    const c = await this.mine(tenantId, userId);
    if (!c) throw new NotFoundException('Google Calendar ulanmagan');
    const list = await this.calendars(tenantId, userId);
    const chosen = list.find((x) => x.id === calendarId);
    if (!chosen) throw new BadRequestException('Bu kalendarga yozish huquqi yo\'q');
    if (c.status !== 'ACTIVE') throw new ConflictException({ code: 'NEEDS_RECONNECT', message: 'Google Calendar qayta ulanishi kerak' });
    // The events move: the next sync deletes them from the old calendar and
    // creates them in the new one. A sync running now stops (epoch) instead
    // of writing more into the calendar that was just left.
    await this.db.update(calendarConnections).set({ calendarId: chosen.id, calendarName: chosen.summary, syncRequestedAt: new Date(), attempts: 0, nextAttemptAt: null, epoch: sql`${calendarConnections.epoch} + 1`, updatedAt: new Date() })
      .where(eq(calendarConnections.id, c.id));
    return this.status(tenantId, userId);
  }

  async requestSync(tenantId: string, userId: string) {
    const c = await this.mine(tenantId, userId);
    if (!c) throw new NotFoundException('Google Calendar ulanmagan');
    if (c.status !== 'ACTIVE') throw new ConflictException({ code: 'NEEDS_RECONNECT', message: 'Google Calendar qayta ulanishi kerak' });
    await this.db.update(calendarConnections).set({ syncRequestedAt: new Date(), attempts: 0, nextAttemptAt: null, updatedAt: new Date() }).where(eq(calendarConnections.id, c.id));
    return this.status(tenantId, userId);
  }

  /**
   * Disconnects (the order is in the class comment). Only the events this
   * integration created are deleted (from the link table); other events in
   * the user's calendar are never touched. The answer says what happened
   * now: removed, still to be removed (retried in the background), or left
   * behind because the grant is gone.
   */
  async disconnect(tenantId: string, userId: string) {
    const c = await this.mine(tenantId, userId);
    if (!c) throw new NotFoundException('Google Calendar ulanmagan');
    if (c.status === 'CLEANUP_FAILED') return this.dismissLeftovers(tenantId, userId);
    // No new sync from here on; one that is running stops at its next write.
    // A grant for another account that was waiting is dropped: disconnect means disconnect.
    await this.db.update(calendarConnections)
      .set({
        status: 'DISCONNECTING', epoch: c.status === 'DISCONNECTING' ? c.epoch : c.epoch + 1, syncRequestedAt: null, nextAttemptAt: null, attempts: 0,
        nextAccessTokenEnc: null, nextRefreshTokenEnc: null, nextTokenExpiresAt: null, nextAccountKey: null, updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, c.id));
    if (c.nextRefreshTokenEnc) await this.google.revoke(this.crypto.decrypt(c.nextRefreshTokenEnc)).catch(() => undefined);
    this.audit.log({ tenantId, userId, action: 'calendar.google_disconnect', entityType: 'calendar_connection', entityId: c.id });
    // Clean up now when nobody else is writing for this connection; a sync
    // in progress finishes its current write first and the poller follows.
    const claimed = await this.claim(c.id, 'DISCONNECTING');
    if (!claimed) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, c.id));
      return { removedEvents: 0, notRemoved: 0, pending: n };
    }
    return this.cleanup(claimed);
  }

  /** The user has seen what was left behind: forget it. */
  async dismissLeftovers(tenantId: string, userId: string) {
    const c = await this.mine(tenantId, userId);
    if (!c) throw new NotFoundException('Google Calendar ulanmagan');
    if (c.status === 'CLEANUP_FAILED') {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, c.id));
      await this.db.delete(calendarConnections).where(and(eq(calendarConnections.id, c.id), eq(calendarConnections.status, 'CLEANUP_FAILED'), eq(calendarConnections.epoch, c.epoch)));
      return { removedEvents: 0, notRemoved: n, pending: 0 };
    }
    await this.db.update(calendarConnections).set({ leftoverEvents: 0, updatedAt: new Date() }).where(eq(calendarConnections.id, c.id));
    return { removedEvents: 0, notRemoved: 0, pending: 0 };
  }

  // ---- the lease ----------------------------------------------------------

  /** Takes the lease of a connection in the given status; null when someone else holds it. */
  private async claim(id: string, status: 'ACTIVE' | 'DISCONNECTING'): Promise<Connection | null> {
    const [c] = await this.db.update(calendarConnections).set({ lockedUntil: new Date(Date.now() + LOCK_MS), lockToken: randomBytes(12).toString('hex') })
      .where(and(eq(calendarConnections.id, id), eq(calendarConnections.status, status), or(isNull(calendarConnections.lockedUntil), lt(calendarConnections.lockedUntil, new Date()))))
      .returning();
    return c ?? null;
  }

  /** The row as this worker claimed it: its own lease, the same epoch and status. */
  private held(c: Connection, status: 'ACTIVE' | 'DISCONNECTING') {
    return and(eq(calendarConnections.id, c.id), eq(calendarConnections.lockToken, c.lockToken ?? ''), eq(calendarConnections.epoch, c.epoch), eq(calendarConnections.status, status));
  }

  /**
   * Before a write to Google: is the connection still this worker's, as it
   * was claimed? Extends the lease when it is (a long sync never runs out of
   * it while it works). False: someone else has it or it changed - stop.
   */
  private async renew(c: Connection, status: 'ACTIVE' | 'DISCONNECTING'): Promise<boolean> {
    if (!c.lockToken) return false;
    const rows = await this.db.update(calendarConnections).set({ lockedUntil: new Date(Date.now() + LOCK_MS) }).where(this.held(c, status)).returning({ id: calendarConnections.id });
    return rows.length === 1;
  }

  /** Hands the lease back - this worker's own, never another's. */
  private async release(c: Connection) {
    if (!c.lockToken) return;
    await this.db.update(calendarConnections).set({ lockedUntil: null, lockToken: null }).where(and(eq(calendarConnections.id, c.id), eq(calendarConnections.lockToken, c.lockToken)));
  }

  /**
   * Steps 2-4 of a disconnect, by the holder of the lease: delete our
   * events, then revoke, then forget - or, when another account is waiting,
   * make it the connection. Stops and keeps everything needed for another
   * try on a retryable failure; stops without a trace when the lease is
   * no longer its own (a reconnect cancelled the disconnect, or another
   * worker took over).
   */
  private async cleanup(c: Connection): Promise<{ removedEvents: number; notRemoved: number; pending: number }> {
    const links = await this.db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, c.id));
    let removed = 0;
    const lost = async () => {
      await this.release(c);
      return { removedEvents: removed, notRemoved: 0, pending: links.length - removed };
    };
    // The last step, on the row as it is now (a grant for another account may have arrived meanwhile).
    const finish = async (left: number) => {
      const [now] = await this.db.select().from(calendarConnections).where(this.held(c, 'DISCONNECTING'));
      if (!now) return lost();
      if (now.nextRefreshTokenEnc) {
        const moved = await this.db.update(calendarConnections).set({
          accessTokenEnc: now.nextAccessTokenEnc, refreshTokenEnc: now.nextRefreshTokenEnc, tokenExpiresAt: now.nextTokenExpiresAt, accountKey: now.nextAccountKey,
          nextAccessTokenEnc: null, nextRefreshTokenEnc: null, nextTokenExpiresAt: null, nextAccountKey: null,
          calendarId: 'primary', calendarName: null, status: 'ACTIVE', epoch: now.epoch + 1, leftoverEvents: now.leftoverEvents + left,
          syncRequestedAt: new Date(), lastSyncAt: null, nextAttemptAt: null, attempts: 0, lastError: null, lockedUntil: null, lockToken: null, updatedAt: new Date(),
        }).where(and(this.held(c, 'DISCONNECTING'), isNotNull(calendarConnections.nextRefreshTokenEnc))).returning({ id: calendarConnections.id });
        if (moved.length === 0) return lost();
        // Whatever is still linked belongs to the account that was left: never touched with the new grant.
        await this.db.delete(calendarEventLinks).where(eq(calendarEventLinks.connectionId, c.id));
        this.audit.log({ tenantId: c.tenantId, userId: c.userId, action: 'calendar.google_account_switched', entityType: 'calendar_connection', entityId: c.id, meta: { removed, left } });
        return { removedEvents: removed, notRemoved: left, pending: 0 };
      }
      if (left === 0) {
        const gone = await this.db.delete(calendarConnections).where(this.held(c, 'DISCONNECTING')).returning({ id: calendarConnections.id });
        if (gone.length === 0) return lost();
        this.audit.log({ tenantId: c.tenantId, userId: c.userId, action: 'calendar.google_cleanup_done', entityType: 'calendar_connection', entityId: c.id, meta: { removed } });
        return { removedEvents: removed, notRemoved: 0, pending: 0 };
      }
      // The grant is gone: nothing more can be deleted by us. Keep the links
      // (count and dates, for the user) and drop the tokens.
      const kept = await this.db.update(calendarConnections)
        .set({ status: 'CLEANUP_FAILED', accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, lockedUntil: null, lockToken: null, nextAttemptAt: null, updatedAt: new Date() })
        .where(this.held(c, 'DISCONNECTING')).returning({ id: calendarConnections.id });
      if (kept.length === 0) return lost();
      this.audit.log({ tenantId: c.tenantId, userId: c.userId, action: 'calendar.google_cleanup_failed', entityType: 'calendar_connection', entityId: c.id, meta: { removed, left } });
      return { removedEvents: removed, notRemoved: left, pending: 0 };
    };
    let token: string;
    try {
      token = await this.accessToken(c);
    } catch (err) {
      if (err instanceof GoogleApiError && err.auth) return finish(links.length - removed);
      return this.retryCleanup(c, err, removed, links.length);
    }
    for (const l of links) {
      if (!(await this.renew(c, 'DISCONNECTING'))) return lost();
      try {
        await this.google.deleteEvent(token, l.calendarId, l.providerEventId);
        await this.db.delete(calendarEventLinks).where(eq(calendarEventLinks.id, l.id));
        removed++;
      } catch (err) {
        if (err instanceof GoogleApiError && err.auth) return finish(links.length - removed);
        // 429, 5xx, a timeout: the remaining links stay, to be tried again.
        return this.retryCleanup(c, err, removed, links.length - removed);
      }
    }
    if (!(await this.renew(c, 'DISCONNECTING'))) return lost();
    // A sync that was mid-write when the disconnect came may have added a link since.
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, c.id));
    if (n > 0) return this.retryCleanup(c, null, removed, n);
    if (c.refreshTokenEnc) await this.google.revoke(this.crypto.decrypt(c.refreshTokenEnc)).catch(() => undefined);
    return finish(0);
  }

  private async retryCleanup(c: Connection, err: unknown, removed: number, pending: number) {
    const attempts = c.attempts + 1;
    const wait = err ? Math.min(60 * 2 ** (attempts - 1), MAX_BACKOFF_S) : 0;
    await this.db.update(calendarConnections).set({
      attempts: err ? attempts : c.attempts, nextAttemptAt: err ? new Date(Date.now() + wait * 1000) : null,
      lastError: err ? ((err as Error)?.message ?? 'error').slice(0, 200) : null, lockedUntil: null, lockToken: null, updatedAt: new Date(),
    }).where(this.held(c, 'DISCONNECTING'));
    return { removedEvents: removed, notRemoved: 0, pending };
  }

  // ---- sync ---------------------------------------------------------------

  /**
   * Syncs connections that are due (a change, a retry time reached, or 6
   * hours since the last sync). `tenantIds`: only these centers' (the
   * poller passes nothing: everyone's).
   */
  async syncDue(limit = 10, tenantIds?: string[]) {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = new Date();
      // Disconnects whose clean-up is still owed come first.
      const only = tenantIds ? inArray(calendarConnections.tenantId, tenantIds) : undefined;
      const leaving = await this.db.select({ id: calendarConnections.id }).from(calendarConnections).where(and(
        only,
        eq(calendarConnections.status, 'DISCONNECTING'),
        or(isNull(calendarConnections.nextAttemptAt), lte(calendarConnections.nextAttemptAt, now)),
        or(isNull(calendarConnections.lockedUntil), lt(calendarConnections.lockedUntil, now)),
      )).limit(limit);
      for (const { id } of leaving) {
        const c = await this.claim(id, 'DISCONNECTING');
        if (c) await this.cleanup(c).catch((err) => this.logger.warn(`calendar clean-up: ${(err as Error).message}`));
      }
      const due = await this.db.select({ id: calendarConnections.id }).from(calendarConnections).where(and(
        only,
        eq(calendarConnections.status, 'ACTIVE'),
        or(isNull(calendarConnections.nextAttemptAt), lte(calendarConnections.nextAttemptAt, now)),
        or(isNull(calendarConnections.lockedUntil), lt(calendarConnections.lockedUntil, now)),
        or(isNotNull(calendarConnections.syncRequestedAt), isNull(calendarConnections.lastSyncAt), lt(calendarConnections.lastSyncAt, new Date(now.getTime() - FULL_RESYNC_MS))),
      )).limit(limit);
      let done = 0;
      for (const { id } of due) {
        // Claim it (another instance may be looking at the same row).
        const c = await this.claim(id, 'ACTIVE');
        if (!c) continue;
        await this.syncOne(c);
        done++;
      }
      return done;
    } finally {
      this.running = false;
    }
  }

  /**
   * Records a failure - on the connection it happened to: the same epoch,
   * and for a worker its own lease (a sync that lost the row says nothing
   * about the one that has it now).
   */
  private async failed(c: Connection, err: unknown) {
    const e = err instanceof GoogleApiError ? err : new GoogleApiError((err as Error)?.message ?? 'error', 0, true, false);
    const mine = c.lockToken
      ? and(eq(calendarConnections.id, c.id), eq(calendarConnections.epoch, c.epoch), eq(calendarConnections.lockToken, c.lockToken))
      : and(eq(calendarConnections.id, c.id), eq(calendarConnections.epoch, c.epoch), eq(calendarConnections.status, 'ACTIVE'));
    const lease = c.lockToken ? { lockedUntil: null, lockToken: null } : {};
    if (e.auth) {
      await this.db.update(calendarConnections).set({ status: 'NEEDS_RECONNECT', lastError: e.message.slice(0, 200), ...lease, updatedAt: new Date() }).where(mine);
      return;
    }
    const attempts = c.attempts + 1;
    const wait = Math.min(60 * 2 ** (attempts - 1), MAX_BACKOFF_S);
    await this.db.update(calendarConnections).set({
      attempts, nextAttemptAt: new Date(Date.now() + wait * 1000), lastError: e.message.slice(0, 200), ...lease, updatedAt: new Date(),
    }).where(mine);
  }

  /** One connection: the lessons it should show, against what it shows (link table); differences written. */
  async syncOne(c: Connection) {
    const requestedAt = c.syncRequestedAt;
    // Before every write to Google: is this still the connection this sync
    // started with? A disconnect, a reconnect or a calendar switch since
    // then (a higher epoch) means the plan in hand is stale.
    // (renew also extends the lease: a sync longer than the lease keeps it.)
    const superseded = async () => !(await this.renew(c, 'ACTIVE'));
    const stop = async () => {
      // Hand back this worker's own lease, if it still has one; whoever
      // changed the row or took it over is left alone.
      await this.release(c);
      return { superseded: true as const };
    };
    try {
      const allowed = await this.events.stillAllowed({ tenantId: c.tenantId, scope: c.scope as CalendarScope, userId: c.userId });
      const token = await this.accessToken(c);
      const today = await this.events.today(c.tenantId);
      const from = addDays(today, -WINDOW_BACK);
      const to = addDays(today, WINDOW_AHEAD);
      // Someone who lost access keeps an empty calendar: their events are removed.
      const wanted = allowed ? (await this.events.events({ tenantId: c.tenantId, scope: c.scope as CalendarScope, userId: c.userId }, from, to)).filter((e) => !e.cancelled) : [];
      const byKey = new Map(wanted.map((e) => [e.uid, e]));
      const links = await this.db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, c.id));
      const linked = new Map(links.map((l) => [l.eventKey, l]));
      let written = 0;

      // Gone (removed, cancelled, moved to another calendar) - or older than the window.
      for (const l of links) {
        const e = byKey.get(l.eventKey);
        if (e && l.calendarId === c.calendarId) continue;
        if (!e && l.date < from) {
          // Past lessons stay in the user's calendar as a record; we only stop tracking them.
          await this.db.delete(calendarEventLinks).where(eq(calendarEventLinks.id, l.id));
          continue;
        }
        if (await superseded()) return await stop();
        await this.google.deleteEvent(token, l.calendarId, l.providerEventId);
        await this.db.delete(calendarEventLinks).where(eq(calendarEventLinks.id, l.id));
        linked.delete(l.eventKey);
        written++;
      }

      for (const e of wanted) {
        const hash = hashOf(e, c.calendarId);
        const l = linked.get(e.uid);
        if (l && l.hash === hash) continue;
        const id = l?.providerEventId ?? providerEventId(c.id, e.uid);
        if (await superseded()) return await stop();
        if (l) {
          try {
            await this.google.patchEvent(token, c.calendarId, id, eventBody(e));
          } catch (err) {
            // Deleted by hand in Google: put it back.
            if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) await this.google.insertEvent(token, c.calendarId, eventBody(e, id));
            else throw err;
          }
        } else {
          try {
            await this.google.insertEvent(token, c.calendarId, eventBody(e, id));
          } catch (err) {
            // Created by an earlier attempt whose answer was lost: same id, so update it.
            if (err instanceof GoogleApiError && err.status === 409) await this.google.patchEvent(token, c.calendarId, id, eventBody(e));
            else throw err;
          }
        }
        await this.db.insert(calendarEventLinks).values({ connectionId: c.id, eventKey: e.uid, calendarId: c.calendarId, providerEventId: id, hash, date: e.date })
          .onConflictDoUpdate({ target: [calendarEventLinks.connectionId, calendarEventLinks.eventKey], set: { calendarId: c.calendarId, providerEventId: id, hash, date: e.date, updatedAt: new Date() } });
        written++;
      }

      // Done. A change that arrived while syncing keeps the connection due.
      const finished = await this.db.update(calendarConnections).set({
        lastSyncAt: new Date(), attempts: 0, nextAttemptAt: null, lastError: null, lockedUntil: null, lockToken: null, updatedAt: new Date(),
        // (timestamps are stored as UTC wall time, as drizzle writes them)
        syncRequestedAt: sql`CASE WHEN ${calendarConnections.syncRequestedAt} > ${(requestedAt ?? new Date(0)).toISOString()}::timestamp THEN ${calendarConnections.syncRequestedAt} ELSE NULL END`,
      }).where(this.held(c, 'ACTIVE')).returning({ id: calendarConnections.id });
      if (finished.length === 0) return await stop();
      return { written };
    } catch (err) {
      // A failure of a plan that is no longer current is not the connection's failure.
      if (await superseded().catch(() => true)) return await stop();
      await this.failed(c, err);
      return { error: (err as Error).message };
    }
  }

  /** For tests and the admin: the connections of a center and their state. */
  async connectionsOf(tenantId: string) {
    return this.db.select({ id: calendarConnections.id, userId: calendarConnections.userId, status: calendarConnections.status, attempts: calendarConnections.attempts })
      .from(calendarConnections).where(eq(calendarConnections.tenantId, tenantId));
  }

  /** Links of a connection (tests). */
  linksOf(connectionId: string) {
    return this.db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, connectionId));
  }

  async connectionIdsFor(tenantId: string, userIds: string[]) {
    if (!userIds.length) return [];
    return this.db.select({ id: calendarConnections.id }).from(calendarConnections).where(and(eq(calendarConnections.tenantId, tenantId), inArray(calendarConnections.userId, userIds)));
  }
}
