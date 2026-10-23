-- A center's own domain for its public site (custom-domains/), proved by a
-- DNS TXT record; a domain is verified by one center only.
CREATE TABLE IF NOT EXISTS "tenant_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_domains_tenant_domain_idx" ON "tenant_domains" USING btree ("tenant_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_domains_verified_idx" ON "tenant_domains" USING btree ("domain") WHERE "tenant_domains"."verified_at" is not null;
