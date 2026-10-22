-- Sign-up integrity: a code is bound to its sign-up attempt, purpose and
-- channel, and the newest one alone counts; a center remembers the attempt
-- that made it (a retry gets it back); phones that had a free trial are kept
-- apart from the centers (a keyed fingerprint, never the number).
CREATE TABLE IF NOT EXISTS "trial_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_fingerprint" text NOT NULL,
	"first_tenant_id" text,
	"last_tenant_id" text,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"released_at" timestamp,
	"released_by" text,
	"release_reason" text
);
--> statement-breakpoint
ALTER TABLE "signup_phone_codes" ADD COLUMN IF NOT EXISTS "attempt_id" text;--> statement-breakpoint
ALTER TABLE "signup_phone_codes" ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'SIGNUP' NOT NULL;--> statement-breakpoint
ALTER TABLE "signup_phone_codes" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'SMS' NOT NULL;--> statement-breakpoint
ALTER TABLE "signup_phone_codes" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'SENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "signup_phone_codes" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp;--> statement-breakpoint
-- Codes from before (no attempt; some went by e-mail): no longer usable.
UPDATE "signup_phone_codes" SET "superseded_at" = now() WHERE "attempt_id" IS NULL AND "used_at" IS NULL AND "superseded_at" IS NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "signup_attempt_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_claims_fingerprint_idx" ON "trial_claims" USING btree ("phone_fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signup_phone_codes_ip_idx" ON "signup_phone_codes" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_signup_attempt_idx" ON "tenants" USING btree ("signup_attempt_id") WHERE signup_attempt_id IS NOT NULL;
