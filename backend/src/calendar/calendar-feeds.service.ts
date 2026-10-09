import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { calendarFeeds } from '../db/schema';
import { CalendarEventsService, type CalendarOwner, type CalendarScope } from './calendar-events.service';
import { buildCalendar } from './ics';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Read-only ICS subscriptions. The link's key (32 random bytes) is shown
 * once; only its hash is stored. Making a new link revokes the previous one
 * of the same owner. Every fetch re-checks that the owner may still see
 * these lessons (membership, role, teacher record, guardian links, the
 * student and their PIN), so removing someone ends their calendar.
 */
@Injectable()
export class CalendarFeedsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: CalendarEventsService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Where links point: PUBLIC_API_URL, else FRONTEND_URL + /api (never a hard-coded host). */
  apiBase(): string {
    const explicit = this.config.get<string>('PUBLIC_API_URL');
    if (explicit) return explicit.replace(/\/+$/, '');
    const front = this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    return `${front.replace(/\/+$/, '')}/api`;
  }

  private urlFor(token: string) {
    return `${this.apiBase()}/calendar/feed/${token}.ics`;
  }

  private ownerWhere(owner: CalendarOwner) {
    return and(
      eq(calendarFeeds.tenantId, owner.tenantId),
      owner.studentId ? eq(calendarFeeds.studentId, owner.studentId) : isNull(calendarFeeds.studentId),
      owner.userId ? eq(calendarFeeds.userId, owner.userId) : isNull(calendarFeeds.userId),
      isNull(calendarFeeds.revokedAt),
    );
  }

  async current(owner: CalendarOwner) {
    const [f] = await this.db.select({ id: calendarFeeds.id, scope: calendarFeeds.scope, tokenHint: calendarFeeds.tokenHint, createdAt: calendarFeeds.createdAt, lastFetchedAt: calendarFeeds.lastFetchedAt })
      .from(calendarFeeds).where(this.ownerWhere(owner)).orderBy(desc(calendarFeeds.createdAt)).limit(1);
    return f ?? null;
  }

  /** A new link (the old one, if any, stops working). The URL is returned only here. */
  async rotate(owner: CalendarOwner, actorUserId: string | null) {
    if (!(await this.events.stillAllowed(owner))) throw new BadRequestException("Bu kalendar uchun ruxsat yo'q");
    const token = randomBytes(32).toString('base64url');
    const feed = await this.db.transaction(async (tx) => {
      await tx.update(calendarFeeds).set({ revokedAt: new Date() }).where(this.ownerWhere(owner));
      const [row] = await tx.insert(calendarFeeds).values({
        tenantId: owner.tenantId, scope: owner.scope, userId: owner.userId ?? null, studentId: owner.studentId ?? null,
        tokenHash: sha256(token), tokenHint: token.slice(0, 4),
      }).returning();
      return row;
    });
    this.audit.log({ tenantId: owner.tenantId, userId: actorUserId, action: 'calendar_feed.rotate', entityType: 'calendar_feed', entityId: feed.id, meta: { scope: owner.scope } });
    return { id: feed.id, scope: feed.scope, tokenHint: feed.tokenHint, createdAt: feed.createdAt, url: this.urlFor(token) };
  }

  async revoke(owner: CalendarOwner, actorUserId: string | null) {
    const done = await this.db.update(calendarFeeds).set({ revokedAt: new Date() }).where(this.ownerWhere(owner)).returning({ id: calendarFeeds.id });
    if (done.length === 0) throw new NotFoundException("Kalendar havolasi yo'q");
    this.audit.log({ tenantId: owner.tenantId, userId: actorUserId, action: 'calendar_feed.revoke', entityType: 'calendar_feed', entityId: done[0].id });
    return { success: true };
  }

  /** The ICS body for a link, or null (unknown, revoked, or the owner lost access). */
  async render(rawToken: string): Promise<string | null> {
    const token = rawToken.replace(/\.ics$/, '');
    if (!TOKEN_RE.test(token)) return null;
    const [feed] = await this.db.select().from(calendarFeeds).where(and(eq(calendarFeeds.tokenHash, sha256(token)), isNull(calendarFeeds.revokedAt)));
    if (!feed) return null;
    const owner: CalendarOwner = { tenantId: feed.tenantId, scope: feed.scope as CalendarScope, userId: feed.userId, studentId: feed.studentId };
    if (!(await this.events.stillAllowed(owner, feed.createdAt))) return null;
    const { from, to } = await this.events.window(feed.tenantId);
    const [events, tenant] = await Promise.all([this.events.events(owner, from, to), this.events.tenantInfo(feed.tenantId)]);
    void this.db.update(calendarFeeds).set({ lastFetchedAt: new Date() }).where(eq(calendarFeeds.id, feed.id)).catch(() => undefined);
    let domain = 'talimcrm';
    try {
      domain = new URL(this.apiBase()).hostname || domain;
    } catch {
      // keep the default
    }
    return buildCalendar({ name: tenant?.name ?? 'TalimCRM', domain, events });
  }
}
