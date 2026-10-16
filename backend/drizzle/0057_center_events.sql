-- Meetings, competitions and other one-off events beside the timetable.
CREATE TABLE IF NOT EXISTS "center_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'MEETING' NOT NULL,
	"format" text DEFAULT 'OFFLINE' NOT NULL,
	"date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text,
	"room_id" text,
	"location" text,
	"meeting_url" text,
	"audience" text DEFAULT 'STAFF' NOT NULL,
	"description" text,
	"created_by_user_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "center_events" ADD CONSTRAINT "center_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "center_events" ADD CONSTRAINT "center_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "center_events" ADD CONSTRAINT "center_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "center_events_tenant_date_idx" ON "center_events" USING btree ("tenant_id","date");
