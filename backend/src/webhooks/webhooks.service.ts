import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { and, eq, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { webhooks } from '../db/schema';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { assertPublicHttpUrl, OutboundUrlError, postToPublicUrl, privateTargetsAllowed, urlForLog } from '../common/outbound-url';

// A subscriber gets this long to answer; the request that triggered the
// event never waits for it (dispatch is fire-and-forget).
const DELIVERY_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  // Local development may point a webhook at a receiver on the same machine
  // (never in production).
  private get allowPrivate() {
    return privateTargetsAllowed();
  }

  // The URL is the center's own choice, but the request comes from our
  // server: never towards the server's own network (SSRF).
  private async checkUrl(url: string) {
    try {
      await assertPublicHttpUrl(url, this.allowPrivate);
    } catch (err) {
      if (err instanceof OutboundUrlError) throw new BadRequestException(`Webhook manzili: ${err.message}`);
      throw err;
    }
  }

  findAll(tenantId: string) {
    return this.db.query.webhooks.findMany({
      where: eq(webhooks.tenantId, tenantId),
      orderBy: (w, { desc }) => desc(w.createdAt),
    });
  }

  async create(tenantId: string, dto: CreateWebhookDto) {
    await this.checkUrl(dto.url);
    const secret = randomBytes(24).toString('hex');
    const [wh] = await this.db.insert(webhooks).values({ tenantId, url: dto.url, event: dto.event, secret }).returning();
    return wh;
  }

  async update(tenantId: string, id: string, dto: UpdateWebhookDto) {
    const existing = await this.db.query.webhooks.findFirst({ where: and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)) });
    if (!existing) throw new NotFoundException('Webhook topilmadi');
    if (dto.url !== undefined) await this.checkUrl(dto.url);
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (Object.keys(changes).length === 0) return existing;
    const [wh] = await this.db
      .update(webhooks)
      .set(changes)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)))
      .returning();
    return wh;
  }

  async remove(tenantId: string, id: string) {
    const removed = await this.db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId))).returning({ id: webhooks.id });
    if (removed.length === 0) throw new NotFoundException('Webhook topilmadi');
    return { success: true };
  }

  // Fire-and-forget: called from other services after a mutation. Never
  // let a slow/broken subscriber URL affect the request that triggered it.
  async dispatch(tenantId: string, event: string, payload: unknown) {
    const subs = await this.db.query.webhooks.findMany({
      where: and(eq(webhooks.tenantId, tenantId), eq(webhooks.active, true), or(eq(webhooks.event, event), eq(webhooks.event, '*'))),
    });
    for (const sub of subs) {
      void this.deliver(sub, event, payload);
    }
  }

  private async deliver(sub: { url: string; secret: string }, event: string, payload: unknown) {
    try {
      // Checked again at delivery time, on the connection itself: the name
      // may resolve elsewhere now.
      const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });
      const signature = createHmac('sha256', sub.secret).update(body).digest('hex');
      const status = await postToPublicUrl(sub.url, body, { 'Content-Type': 'application/json', 'X-TalimCRM-Signature': signature }, {
        allowPrivate: this.allowPrivate,
        timeoutMs: DELIVERY_TIMEOUT_MS,
      });
      if (status < 200 || status >= 300) this.logger.warn(`Webhook delivery to ${urlForLog(sub.url)} answered ${status}`);
    } catch (err) {
      this.logger.warn(`Webhook delivery failed for ${urlForLog(sub.url)}: ${(err as Error).message}`);
    }
  }
}
