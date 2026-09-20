import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { platformSubscriptions, tenants } from '../db/schema';
import { GeneratePlatformLinkDto } from './dto/platform-billing.dto';
import { PlansService } from '../plans/plans.service';

function md5(input: string) {
  return createHash('md5').update(input).digest('hex');
}

@Injectable()
export class PlatformBillingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly plansService: PlansService,
  ) {}

  private async priceFor(planKey: string) {
    const plan = await this.plansService.getByKey(planKey).catch(() => null);
    if (!plan) throw new NotFoundException('Tarif topilmadi');
    return plan.price;
  }

  async generateClickLink(tenantId: string, dto: GeneratePlatformLinkDto) {
    const merchantId = this.config.get<string>('PLATFORM_CLICK_MERCHANT_ID');
    const serviceId = this.config.get<string>('PLATFORM_CLICK_SERVICE_ID');
    if (!merchantId || !serviceId) {
      throw new ServiceUnavailableException(
        "Platforma Click integratsiyasi sozlanmagan: PLATFORM_CLICK_MERCHANT_ID / PLATFORM_CLICK_SERVICE_ID",
      );
    }
    const amount = await this.priceFor(dto.plan);
    const [sub] = await this.db
      .insert(platformSubscriptions)
      .values({ tenantId, plan: dto.plan as any, amount, forMonth: dto.forMonth, status: 'CREATED', provider: 'CLICK' })
      .onConflictDoUpdate({
        target: [platformSubscriptions.tenantId, platformSubscriptions.forMonth],
        set: { plan: dto.plan as any, amount, provider: 'CLICK', status: 'CREATED' },
      })
      .returning();
    const url = `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${sub.id}`;
    return { url, subscriptionId: sub.id, amount };
  }

  async generatePaymeLink(tenantId: string, dto: GeneratePlatformLinkDto) {
    const merchantId = this.config.get<string>('PLATFORM_PAYME_MERCHANT_ID');
    if (!merchantId) {
      throw new ServiceUnavailableException("Platforma Payme integratsiyasi sozlanmagan: PLATFORM_PAYME_MERCHANT_ID");
    }
    const amount = await this.priceFor(dto.plan);
    const [sub] = await this.db
      .insert(platformSubscriptions)
      .values({ tenantId, plan: dto.plan as any, amount, forMonth: dto.forMonth, status: 'CREATED', provider: 'PAYME' })
      .onConflictDoUpdate({
        target: [platformSubscriptions.tenantId, platformSubscriptions.forMonth],
        set: { plan: dto.plan as any, amount, provider: 'PAYME', status: 'CREATED' },
      })
      .returning();
    const amountTiyin = amount * 100;
    const params = `m=${merchantId};ac.transaction_param=${sub.id};a=${amountTiyin}`;
    const url = `https://checkout.paycom.uz/${Buffer.from(params).toString('base64')}`;
    return { url, subscriptionId: sub.id, amount };
  }

  private async activate(subId: string) {
    const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.id, subId) });
    if (!sub || sub.status === 'PAID') return sub;
    const [updated] = await this.db
      .update(platformSubscriptions)
      .set({ status: 'PAID', paidAt: new Date() })
      .where(eq(platformSubscriptions.id, subId))
      .returning();
    await this.db
      .update(tenants)
      .set({ plan: sub.plan, status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(tenants.id, sub.tenantId));
    return updated;
  }

  async handleClickWebhook(body: Record<string, string>) {
    const secret = this.config.get<string>('PLATFORM_CLICK_SECRET_KEY');
    if (!secret) return { error: -3, error_note: "Platforma Click sozlanmagan" };

    const { click_trans_id, service_id, merchant_trans_id, amount, action, sign_time, sign_string, merchant_prepare_id } = body;
    const expected =
      action === '0'
        ? md5(`${click_trans_id}${service_id}${secret}${merchant_trans_id}${amount}${action}${sign_time}`)
        : md5(`${click_trans_id}${service_id}${secret}${merchant_trans_id}${merchant_prepare_id}${amount}${action}${sign_time}`);
    if (expected !== sign_string) {
      return { click_trans_id, merchant_trans_id, error: -1, error_note: 'SIGN CHECK FAILED' };
    }
    const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.id, merchant_trans_id) });
    if (!sub) return { click_trans_id, merchant_trans_id, error: -6, error_note: 'Transaction not found' };
    if (Number(amount) !== sub.amount) return { click_trans_id, merchant_trans_id, error: -2, error_note: 'Incorrect amount' };

    if (action === '0') {
      return { click_trans_id, merchant_trans_id, merchant_prepare_id: sub.id, error: 0, error_note: 'Success' };
    }
    if (action === '1') {
      await this.activate(sub.id);
      return { click_trans_id, merchant_trans_id, merchant_confirm_id: sub.id, error: 0, error_note: 'Success' };
    }
    return { click_trans_id, merchant_trans_id, error: -3, error_note: 'Action not found' };
  }

  async handlePaymeWebhook(authHeader: string | undefined, body: any) {
    const key = this.config.get<string>('PLATFORM_PAYME_KEY');
    const expected = 'Basic ' + Buffer.from(`Paycom:${key}`).toString('base64');
    if (!key || authHeader !== expected) {
      return { error: { code: -32504, message: 'Insufficient privilege' }, id: body?.id };
    }
    const { method, params, id } = body;
    const subId: string | undefined = params?.account?.transaction_param;
    switch (method) {
      case 'CheckPerformTransaction': {
        const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.id, subId!) });
        if (!sub) return { error: { code: -31050, message: 'Not found' }, id };
        if (params.amount !== sub.amount * 100) return { error: { code: -31001, message: 'Incorrect amount' }, id };
        return { result: { allow: true }, id };
      }
      case 'CreateTransaction': {
        const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.id, subId!) });
        if (!sub) return { error: { code: -31050, message: 'Not found' }, id };
        await this.db.update(platformSubscriptions).set({ providerTxId: params.id }).where(eq(platformSubscriptions.id, sub.id));
        return { result: { create_time: Date.now(), transaction: sub.id, state: 1 }, id };
      }
      case 'PerformTransaction': {
        const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.providerTxId, params.id) });
        if (!sub) return { error: { code: -31003, message: 'Not found' }, id };
        await this.activate(sub.id);
        return { result: { transaction: sub.id, perform_time: Date.now(), state: 2 }, id };
      }
      case 'CancelTransaction': {
        const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.providerTxId, params.id) });
        if (!sub) return { error: { code: -31003, message: 'Not found' }, id };
        await this.db.update(platformSubscriptions).set({ status: 'CANCELLED' }).where(eq(platformSubscriptions.id, sub.id));
        return { result: { transaction: sub.id, cancel_time: Date.now(), state: -1 }, id };
      }
      case 'CheckTransaction': {
        const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.providerTxId, params.id) });
        if (!sub) return { error: { code: -31003, message: 'Not found' }, id };
        return {
          result: {
            transaction: sub.id,
            state: sub.status === 'PAID' ? 2 : sub.status === 'CANCELLED' ? -1 : 1,
            create_time: new Date(sub.createdAt).getTime(),
            perform_time: sub.paidAt ? new Date(sub.paidAt).getTime() : 0,
            cancel_time: 0,
          },
          id,
        };
      }
      default:
        return { error: { code: -32601, message: 'Method not found' }, id };
    }
  }
}
