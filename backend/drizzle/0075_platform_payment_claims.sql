-- A center paying the platform by card transfer: the receipt waits for the platform admin.
CREATE TABLE IF NOT EXISTS "platform_payment_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan" text NOT NULL,
	"for_month" text NOT NULL,
	"amount" integer NOT NULL,
	"receipt_file" text NOT NULL,
	"note" text,
	"sent_by_user_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reject_reason" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp,
	"subscription_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_payment_claims" ADD CONSTRAINT "platform_payment_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_payment_claims" ADD CONSTRAINT "platform_payment_claims_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_payment_claims" ADD CONSTRAINT "platform_payment_claims_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_payment_claims" ADD CONSTRAINT "platform_payment_claims_subscription_id_platform_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."platform_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_payment_claims_status_idx" ON "platform_payment_claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_payment_claims_tenant_idx" ON "platform_payment_claims" USING btree ("tenant_id");