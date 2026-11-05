import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpException, HttpStatus, Inject, Logger, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { DB, Database } from '../db/db.module';
import { allows, entitlementsOf } from '../plans/entitlements';
import { CallIngestService } from './call-ingest.service';
import { ipAllowed, parseCidrs } from './ip-allow';
import { TelephonyProviders } from './providers/telephony-providers';
import { TelephonyAccountsService } from './telephony-accounts.service';

/** Form fields as plain strings (a provider sends flat fields; anything nested is dropped). */
function flat(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body || typeof body !== 'object') return out;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/**
 * Called by the provider's servers, so no JWT. The address carries the
 * center's own webhook token (shown in its settings); the event must be
 * signed with that center's secret. A center is never identified from the
 * event's contents.
 *
 * Answers:
 *   404  unknown token
 *   403  bad signature, or not from the provider's addresses (when
 *        TELEPHONY_ZADARMA_IPS is set)
 *   200  everything else, including events that are ignored (a duplicate,
 *        an event type we do not use, a switched-off account): the provider
 *        has nothing to retry. Zadarma reads the answer to NOTIFY_START as
 *        routing instructions, so the body is always empty.
 *
 * Rate limit: counted per webhook token (common/user-throttler.guard.ts),
 * not per address - every center's events come from the same few provider
 * addresses. Made-up tokens would each get a fresh allowance that way, so
 * unknown tokens are also counted per address here (UNKNOWN_TOKEN_LIMIT a
 * minute, then 429).
 */
const UNKNOWN_TOKEN_LIMIT = 30;
const MINUTE = 60_000;
@Controller('telephony/webhook')
export class TelephonyWebhookController {
  private readonly logger = new Logger(TelephonyWebhookController.name);
  private readonly zadarmaIps: ReturnType<typeof parseCidrs>;
  private readonly unknownTokenHits = new Map<string, { count: number; since: number }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accounts: TelephonyAccountsService,
    private readonly providers: TelephonyProviders,
    private readonly ingestService: CallIngestService,
    config: ConfigService,
  ) {
    // Zadarma's own advice: accept its notifications from 185.45.152.40/30 only.
    // Off unless set, as it depends on the proxy passing the real address.
    this.zadarmaIps = parseCidrs(config.get<string>('TELEPHONY_ZADARMA_IPS'));
  }

  // The provider's URL check when the address is saved in its cabinet.
  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async handshake(@Param('token') token: string, @Query() query: Record<string, unknown>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const account = await this.account(token, req);
    res.type('text/plain');
    return this.providers.get(account.provider).handshake(query) ?? 'ok';
  }

  @Post(':token')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async receive(
    @Param('token') token: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.type('text/plain');
    const account = await this.account(token, req);
    if (account.provider === 'ZADARMA' && this.zadarmaIps.length && !ipAllowed(req.ip, this.zadarmaIps)) {
      this.logger.warn(JSON.stringify({ op: 'telephony.webhook_ip_refused', tenantId: account.tenantId, ip: req.ip }));
      throw new ForbiddenException();
    }
    const provider = this.providers.get(account.provider);
    const body = flat(rawBody);
    const event = provider.parse(body);
    if (!event) return ''; // not a call event (or one it does not sign): nothing to do

    const creds = this.accounts.open(account);
    if (!creds || !provider.verify(body, headers, creds)) {
      this.logger.warn(JSON.stringify({ op: 'telephony.webhook_bad_signature', tenantId: account.tenantId, event: event.eventType }));
      throw new ForbiddenException();
    }
    await this.accounts.touch(account.id);
    if (!account.enabled) return '';
    if (!allows(await entitlementsOf(this.db, account.tenantId), 'TELEPHONY')) return '';

    const r = await this.ingestService.ingest(account, event, body);
    if (r.duplicate) this.logger.log(JSON.stringify({ op: 'telephony.webhook_duplicate', tenantId: account.tenantId, event: event.eventType }));
    return '';
  }

  /** The account of this token; 404 for an unknown one, 429 after too many unknown ones from one address. */
  private async account(token: string, req: Request) {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const hits = this.unknownTokenHits.get(ip);
    if (hits && now - hits.since < MINUTE && hits.count >= UNKNOWN_TOKEN_LIMIT) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    const account = await this.accounts.byWebhookToken(token);
    if (account) return account;
    if (!hits || now - hits.since >= MINUTE) this.unknownTokenHits.set(ip, { count: 1, since: now });
    else hits.count++;
    if (this.unknownTokenHits.size > 10_000) {
      for (const [k, v] of this.unknownTokenHits) if (now - v.since >= MINUTE) this.unknownTokenHits.delete(k);
    }
    throw new NotFoundException();
  }
}
