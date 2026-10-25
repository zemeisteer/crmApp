-- Rule signals: what a rule decided and why, and the per-center rule settings.
CREATE TABLE IF NOT EXISTS "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"rule" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"key" text NOT NULL,
	"reason" text NOT NULL,
	"facts" jsonb NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolved_by_user_id" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "absence_streak_alert" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_follow_up_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signals" ADD CONSTRAINT "signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signals" ADD CONSTRAINT "signals_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signals_once_idx" ON "signals" USING btree ("tenant_id","rule","subject_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_tenant_status_idx" ON "signals" USING btree ("tenant_id","status","created_at");