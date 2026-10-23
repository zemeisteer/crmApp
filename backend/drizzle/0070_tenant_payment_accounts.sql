-- A center's own Click / Payme merchant account: students pay the center
-- directly. The secret is sealed with SETTINGS_KEY (billing/payment-accounts).
CREATE TABLE IF NOT EXISTS "tenant_payment_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"merchant_id" text NOT NULL,
	"service_id" text,
	"secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenant_payment_accounts" ADD CONSTRAINT "tenant_payment_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_payment_accounts_tenant_provider_idx" ON "tenant_payment_accounts" USING btree ("tenant_id","provider");
