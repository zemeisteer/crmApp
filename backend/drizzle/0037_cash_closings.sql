-- Closing the cash desk at the end of a center's day, and who took each
-- payment at the desk from now on. Existing payments keep recorded_by_id
-- NULL ("not recorded"); nothing else is changed.
CREATE TABLE IF NOT EXISTS "cash_closings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"date" text NOT NULL,
	"expected_cash" integer NOT NULL,
	"counted_cash" integer NOT NULL,
	"difference" integer NOT NULL,
	"totals" text NOT NULL,
	"note" text,
	"closed_by_id" text,
	"closed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "recorded_by_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_closings_tenant_date_uniq" ON "cash_closings" USING btree ("tenant_id","date");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
