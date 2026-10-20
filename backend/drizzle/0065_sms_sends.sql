-- Every SMS a center sends, by idempotency key: sent once, and counted
-- against the platform account's monthly budget (notifications.service.ts).
CREATE TABLE IF NOT EXISTS "sms_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"month" text NOT NULL,
	"platform_account" boolean NOT NULL,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sms_sends" ADD CONSTRAINT "sms_sends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_sends_tenant_key_idx" ON "sms_sends" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_sends_month_idx" ON "sms_sends" USING btree ("month","platform_account");
