-- Trial deletion notices go through an outbox (trial/trial-lifecycle.service.ts):
-- each is retried until the provider accepts it. The deletion date the notices
-- name and the trial end it was counted from are kept on the center.
-- Older warnings (sent without knowing whether they arrived) count for nothing:
-- a center already warned starts a new cycle the next time the scanner runs.
CREATE TABLE IF NOT EXISTS "trial_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"locked_until" timestamp,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_purge_on" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_purge_basis" timestamp;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trial_notices" ADD CONSTRAINT "trial_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_notices_tenant_kind_recipient_idx" ON "trial_notices" USING btree ("tenant_id","kind","recipient");
