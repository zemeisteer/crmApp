-- Platform billing integrity (card, Click, Payme).
-- 1. One live invoice per center and month: a cancelled invoice stays as
--    history (a provider may still ask about its transaction) and a new one
--    is made. The new index is a weaker form of the old one, so it builds on
--    any data the old one allowed; it is made before the old one goes.
-- 2. One receipt waiting per center and month, and a key per "send" so a
--    retried upload returns the same receipt.
-- Nothing is deleted. If a database already holds two PENDING receipts for
-- one center and month, the migration stops with a message instead of
-- choosing one: resolve them first (scripts/check-platform-billing.ts lists them).
CREATE UNIQUE INDEX IF NOT EXISTS "platform_subs_tenant_month_live_idx" ON "platform_subscriptions" USING btree ("tenant_id","for_month") WHERE status <> 'CANCELLED';--> statement-breakpoint
DROP INDEX IF EXISTS "platform_subs_tenant_month_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_subs_provider_tx_idx" ON "platform_subscriptions" USING btree ("provider_tx_id");--> statement-breakpoint
ALTER TABLE "platform_payment_claims" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
DO $$
DECLARE dup integer;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT tenant_id, for_month FROM platform_payment_claims WHERE status = 'PENDING'
    GROUP BY tenant_id, for_month HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION '0076: % center/month pair(s) have more than one PENDING card receipt. Confirm or reject the extra ones (see scripts/check-platform-billing.ts), then run the migration again.', dup;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_payment_claims_one_pending_idx" ON "platform_payment_claims" USING btree ("tenant_id","for_month") WHERE status = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_payment_claims_idem_idx" ON "platform_payment_claims" USING btree ("tenant_id","idempotency_key") WHERE idempotency_key IS NOT NULL;
