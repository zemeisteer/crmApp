-- Free trial protection: a phone confirmed with a code at sign-up (one trial
-- per number), the trial's daily AI allowance, and the two notices before an
-- unpaid trial that ended long ago is deleted.
CREATE TABLE IF NOT EXISTS "signup_phone_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_ai_usage" (
	"tenant_id" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "signup_phone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_warned_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_final_warned_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trial_ai_usage" ADD CONSTRAINT "trial_ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signup_phone_codes_phone_idx" ON "signup_phone_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_ai_usage_tenant_day_idx" ON "trial_ai_usage" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_signup_phone_idx" ON "tenants" USING btree ("signup_phone") WHERE signup_phone IS NOT NULL;
