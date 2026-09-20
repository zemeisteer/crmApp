import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { and, eq, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { webhooks } from '../db/schema';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string) {
    return this.db.query.webhooks.findMany({
      where: eq(webhooks.tenantId, tenantId),
      orderBy: (w, { desc }) => desc(w.createdAt),
    });
  }

  async create(tenantId: string, dto: CreateWebhookDto) {
    const secret = randomBytes(24).toString('hex');
    const [wh] = await this.db.insert(webhooks).values({ tenantId, url: dto.url, event: dto.event, secret }).returning();
    return wh;
  }

  async update(tenantId: string, id: string, dto: UpdateWebhookDto) {
    const [wh] = await this.db
      .update(webhooks)
      .set(dto)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)))
      .returning();
    return wh;
  }

  async remove(tenantId: string, id: string) {
    await this.db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)));
    return { success: true };
  }

  // Fire-and-forget: called from other services after a mutation. Never
  // let a slow/broken subscriber URL affect the request that triggered it.
  async dispatch(tenantId: string, event: string, payload: unknown) {
    const subs = await this.db.query.webhooks.findMany({
      where: and(eq(webhooks.tenantId, tenantId), eq(webhooks.active, true), or(eq(webhooks.event, event), eq(webhooks.event, '*'))),
    });
    for (const sub of subs) {
      const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });
      const signature = createHmac('sha256', sub.secret).update(body).digest('hex');
      fetch(sub.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TalimCRM-Signature': signature },
        body,
      }).catch((err) => this.logger.warn(`Webhook delivery failed for ${sub.url}: ${err.message}`));
    }
  }
}
