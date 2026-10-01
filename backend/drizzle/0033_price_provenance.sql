-- CRMAPP: where a group's past price comes from
-- Migration: 0033_price_provenance.sql (idempotent)
ALTER TABLE "group_price_history" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'RECORDED' NOT NULL;
--> statement-breakpoint
ALTER TABLE "group_price_history" ADD COLUMN IF NOT EXISTS "confirmed_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "group_price_history" ADD COLUMN IF NOT EXISTS "note" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "group_price_history" ADD CONSTRAINT "group_price_history_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Migration 0030 wrote one row per existing group: today's price, dated
-- back to the group's creation (ids 'gph_<group id>'). Only the first half
-- of that is a fact. The rows are kept as they are - price and dates
-- untouched - and labelled: what the group cost when the row was written is
-- known, what it cost before that is not. Months before it are reported as
-- unverified estimates until someone confirms the price or issues an
-- invoice. Prices recorded since (changes made in the app) are not touched.
UPDATE "group_price_history" SET "source" = 'ASSUMED' WHERE "id" LIKE 'gph\_%' AND "source" = 'RECORDED' AND "confirmed_by_user_id" IS NULL;
