-- Debt reminders: one per student, month and center day, recorded before
-- sending so that a double click or two staff at once send one. New table
-- only; nothing existing is changed.
CREATE TABLE IF NOT EXISTS "debtor_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"for_month" text NOT NULL,
	"day" text NOT NULL,
	"debt" integer NOT NULL,
	"channels" text NOT NULL,
	"sent_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "debtor_reminders" ADD CONSTRAINT "debtor_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "debtor_reminders" ADD CONSTRAINT "debtor_reminders_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "debtor_reminders" ADD CONSTRAINT "debtor_reminders_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "debtor_reminders_once_per_day" ON "debtor_reminders" USING btree ("tenant_id","student_id","for_month","day");
