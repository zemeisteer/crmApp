-- Calendar sync: subscription links (calendar_feeds: only a hash of each key is
-- kept), Google Calendar connections (tokens encrypted by the application),
-- one-time OAuth states, and which provider event each lesson became
-- (calendar_event_links). New tables only; nothing existing is changed.
CREATE TABLE IF NOT EXISTS "calendar_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'GOOGLE' NOT NULL,
	"scope" text NOT NULL,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"calendar_name" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"sync_requested_at" timestamp,
	"next_attempt_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"last_sync_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_event_links" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"event_key" text NOT NULL,
	"calendar_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"hash" text NOT NULL,
	"date" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"scope" text NOT NULL,
	"user_id" text,
	"student_id" text,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"last_fetched_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"verifier_enc" text NOT NULL,
	"return_to" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_oauth_states" ADD CONSTRAINT "calendar_oauth_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calendar_oauth_states" ADD CONSTRAINT "calendar_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_connections_user_provider_uniq" ON "calendar_connections" USING btree ("tenant_id","user_id","provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_connections_due_idx" ON "calendar_connections" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_event_links_key_uniq" ON "calendar_event_links" USING btree ("connection_id","event_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_feeds_token_uniq" ON "calendar_feeds" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_feeds_user_idx" ON "calendar_feeds" USING btree ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_feeds_student_idx" ON "calendar_feeds" USING btree ("tenant_id","student_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_oauth_states_state_uniq" ON "calendar_oauth_states" USING btree ("state_hash");
