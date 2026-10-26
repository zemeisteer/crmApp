-- Payment messages through an outbox (src/notice-outbox/): written in the
-- transaction of the change they announce, sent by a worker afterwards.
-- Platform card receipts remember what a send carried (request_hash) and the
-- receipt's own content hash, so a reused Idempotency-Key with other content
-- is a conflict. Additive only: nothing existing changes or is deleted.
CREATE TABLE IF NOT EXISTS "notice_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"locked_until" timestamp,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_payment_claims" ADD COLUMN IF NOT EXISTS "request_hash" text;--> statement-breakpoint
ALTER TABLE "platform_payment_claims" ADD COLUMN IF NOT EXISTS "receipt_sha256" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notice_outbox" ADD CONSTRAINT "notice_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notice_outbox_dedupe_idx" ON "notice_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notice_outbox_due_idx" ON "notice_outbox" USING btree ("status","next_attempt_at");
