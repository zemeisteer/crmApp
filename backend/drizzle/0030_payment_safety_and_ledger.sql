-- CRMAPP: retry-safe manual payments, and what a past month's tuition was
-- Migration: 0030_payment_safety_and_ledger.sql (idempotent)
CREATE TABLE IF NOT EXISTS "group_price_history" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"monthly_price" integer NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "request_hash" text;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_price_history" ADD CONSTRAINT "group_price_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_price_history" ADD CONSTRAINT "group_price_history_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_price_history_group_idx" ON "group_price_history" USING btree ("group_id","effective_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_price_history_tenant_idx" ON "group_price_history" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_tenant_idem_uniq" ON "payments" USING btree ("tenant_id","idempotency_key");
--> statement-breakpoint
-- Prices were not versioned before: the only price known for an existing
-- group is today's, recorded as in force since the group was created.
-- Later changes add rows; nothing existing is modified.
INSERT INTO "group_price_history" ("id", "tenant_id", "group_id", "monthly_price", "effective_from")
SELECT 'gph_' || g."id", g."tenant_id", g."id", g."monthly_price", g."created_at"
FROM "groups" g
WHERE NOT EXISTS (SELECT 1 FROM "group_price_history" h WHERE h."group_id" = g."id");
