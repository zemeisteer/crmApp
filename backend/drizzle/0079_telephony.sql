-- IP telephony (telephony/): a center's own provider account (the secret
-- sealed with SETTINGS_KEY), its managers' extensions, the call log and every
-- webhook event once (call_events.dedupe_key: a repeated delivery is ignored).
-- students gets phone_normalized / parent_phone_normalized, computed by the
-- database on every write with the rule of normalizePhone() (as 0003 does for
-- leads), so an incoming number is matched exactly.
-- Additive only: nothing existing changes or is deleted.
DO $$ BEGIN
  CREATE TYPE "public"."call_contact_kind" AS ENUM('LEAD', 'STUDENT', 'PARENT', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."call_direction" AS ENUM('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."call_status" AS ENUM('RINGING', 'ANSWERED', 'MISSED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."telephony_provider" AS ENUM('ZADARMA', 'MOCK');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" "telephony_provider" NOT NULL,
	"call_id" text,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" "telephony_provider" NOT NULL,
	"provider_call_id" text NOT NULL,
	"direction" "call_direction" NOT NULL,
	"status" "call_status" DEFAULT 'RINGING' NOT NULL,
	"caller_number" text,
	"called_number" text,
	"client_number" text,
	"extension" text,
	"manager_user_id" text,
	"contact_kind" "call_contact_kind" DEFAULT 'UNKNOWN' NOT NULL,
	"lead_id" text,
	"student_id" text,
	"created_lead" boolean DEFAULT false NOT NULL,
	"disposition" text,
	"duration_sec" integer,
	"started_at" timestamp NOT NULL,
	"answered_at" timestamp,
	"ended_at" timestamp,
	"recording_ref" text,
	"has_recording" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calls_duration_check" CHECK ("calls"."duration_sec" IS NULL OR "calls"."duration_sec" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telephony_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" "telephony_provider" NOT NULL,
	"api_key" text NOT NULL,
	"api_secret" text NOT NULL,
	"webhook_token" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"calls_visibility" text DEFAULT 'OWN' NOT NULL,
	"recordings_access" text DEFAULT 'ADMINS' NOT NULL,
	"last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telephony_accounts_visibility_check" CHECK ("telephony_accounts"."calls_visibility" IN ('OWN', 'ALL')),
	CONSTRAINT "telephony_accounts_recordings_check" CHECK ("telephony_accounts"."recordings_access" IN ('ADMINS', 'CALL_VIEWERS'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telephony_extensions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"extension" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "phone_normalized" text GENERATED ALWAYS AS (CASE WHEN length(regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '')) = 9 AND "phone" !~ '^\s*\+' THEN '+998' || regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '') WHEN length(regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '')) BETWEEN 8 AND 15 THEN '+' || regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '') ELSE NULL END) STORED;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "parent_phone_normalized" text GENERATED ALWAYS AS (CASE WHEN length(regexp_replace(regexp_replace("parent_phone", '\D', '', 'g'), '^00', '')) = 9 AND "parent_phone" !~ '^\s*\+' THEN '+998' || regexp_replace(regexp_replace("parent_phone", '\D', '', 'g'), '^00', '') WHEN length(regexp_replace(regexp_replace("parent_phone", '\D', '', 'g'), '^00', '')) BETWEEN 8 AND 15 THEN '+' || regexp_replace(regexp_replace("parent_phone", '\D', '', 'g'), '^00', '') ELSE NULL END) STORED;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "call_events" ADD CONSTRAINT "call_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telephony_accounts" ADD CONSTRAINT "telephony_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telephony_extensions" ADD CONSTRAINT "telephony_extensions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telephony_extensions" ADD CONSTRAINT "telephony_extensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "call_events_tenant_dedupe_uniq" ON "call_events" USING btree ("tenant_id","provider","dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_events_tenant_call_idx" ON "call_events" USING btree ("tenant_id","call_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calls_tenant_provider_call_uniq" ON "calls" USING btree ("tenant_id","provider","provider_call_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_tenant_started_idx" ON "calls" USING btree ("tenant_id","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_tenant_manager_started_idx" ON "calls" USING btree ("tenant_id","manager_user_id","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_tenant_lead_idx" ON "calls" USING btree ("tenant_id","lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_tenant_student_idx" ON "calls" USING btree ("tenant_id","student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_tenant_client_number_idx" ON "calls" USING btree ("tenant_id","client_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_accounts_tenant_uniq" ON "telephony_accounts" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_accounts_webhook_token_uniq" ON "telephony_accounts" USING btree ("webhook_token");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_extensions_tenant_ext_uniq" ON "telephony_extensions" USING btree ("tenant_id","extension");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telephony_extensions_tenant_user_idx" ON "telephony_extensions" USING btree ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_tenant_phone_norm_idx" ON "students" USING btree ("tenant_id","phone_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_tenant_parent_phone_norm_idx" ON "students" USING btree ("tenant_id","parent_phone_normalized");
