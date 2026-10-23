-- A center pays CRMAPP for a period (platform-billing): tenants.paid_until is
-- where the paid time ends; each payment records the period it bought.
ALTER TABLE "platform_subscriptions" ADD COLUMN IF NOT EXISTS "provider_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN IF NOT EXISTS "period_start" timestamp;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN IF NOT EXISTS "period_end" timestamp;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_subscriptions" ADD COLUMN IF NOT EXISTS "cancel_reason" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "paid_until" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "suspended_reason" text;--> statement-breakpoint
-- Centers that already paid: their paid time ends where their latest paid
-- month ends ("2026-10" -> 2026-11-01). Centers that never paid through
-- billing keep null, which the renewal pass (BILLING_ENFORCE) never touches.
UPDATE "tenants" t SET "paid_until" = p.until
FROM (
  SELECT "tenant_id", (to_date(max("for_month") || '-01', 'YYYY-MM-DD') + interval '1 month')::timestamp AS until
  FROM "platform_subscriptions" WHERE "status" = 'PAID' GROUP BY "tenant_id"
) p
WHERE t."id" = p."tenant_id" AND t."paid_until" IS NULL;
