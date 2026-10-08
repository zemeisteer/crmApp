-- Make-up lessons: a dated lesson called off (lesson_cancellations), credits owed
-- for a missed lesson (makeup_credits, one live credit per student and missed
-- lesson) and where each is used (makeup_bookings, one live booking per credit),
-- plus an optional expiry policy per center (tenants.makeup_credit_days, null =
-- never). New tables and one nullable column; nothing existing is changed.
CREATE TABLE IF NOT EXISTS "lesson_cancellations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"group_id" text NOT NULL,
	"date" text NOT NULL,
	"reason" text,
	"cancelled_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "makeup_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"credit_id" text NOT NULL,
	"student_id" text NOT NULL,
	"mode" text NOT NULL,
	"target_group_id" text,
	"date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"teacher_id" text,
	"room_id" text,
	"branch_id" text,
	"status" text DEFAULT 'BOOKED' NOT NULL,
	"note" text,
	"created_by_user_id" text,
	"marked_by_user_id" text,
	"marked_at" timestamp,
	"cancelled_at" timestamp,
	"cancelled_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "makeup_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"origin_group_id" text NOT NULL,
	"origin_date" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"note" text,
	"issued_by_user_id" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"closed_at" timestamp,
	"closed_by_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "makeup_credit_days" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lesson_cancellations" ADD CONSTRAINT "lesson_cancellations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lesson_cancellations" ADD CONSTRAINT "lesson_cancellations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lesson_cancellations" ADD CONSTRAINT "lesson_cancellations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_credit_id_makeup_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."makeup_credits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_target_group_id_groups_id_fk" FOREIGN KEY ("target_group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_origin_group_id_groups_id_fk" FOREIGN KEY ("origin_group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_credits" ADD CONSTRAINT "makeup_credits_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_cancellations_group_date_uniq" ON "lesson_cancellations" USING btree ("group_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_cancellations_tenant_idx" ON "lesson_cancellations" USING btree ("tenant_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "makeup_bookings_one_live_per_credit" ON "makeup_bookings" USING btree ("credit_id") WHERE status IN ('BOOKED', 'ATTENDED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "makeup_bookings_tenant_date_idx" ON "makeup_bookings" USING btree ("tenant_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "makeup_bookings_group_date_idx" ON "makeup_bookings" USING btree ("target_group_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "makeup_bookings_teacher_idx" ON "makeup_bookings" USING btree ("teacher_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "makeup_bookings_student_idx" ON "makeup_bookings" USING btree ("student_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "makeup_credits_once_per_occurrence" ON "makeup_credits" USING btree ("student_id","origin_group_id","origin_date") WHERE status <> 'CANCELLED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "makeup_credits_tenant_idx" ON "makeup_credits" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "makeup_credits_student_idx" ON "makeup_credits" USING btree ("student_id");
