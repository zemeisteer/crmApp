-- CRMAPP: core schema catch-up
-- Migration: 0002_core_schema_catchup.sql
--
-- Earlier sprints added these tables/columns to schema.ts and applied them
-- with `db:push` only, so a database built from the versioned migrations
-- (0000 + 0001, as SETUP.md prescribes for production) lacked them — among
-- them organization_memberships, which login depends on. Generated from
-- schema.ts with drizzle-kit's API against a fresh 0000+0001 database and
-- made idempotent, so it is a no-op on databases that were created by push.
-- Billing foreign keys are left out on purpose: 0001 already creates them
-- inline under Postgres' default constraint names.

DO $$ BEGIN
  CREATE TYPE "public"."invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."membership_status" AS ENUM('ACTIVE', 'INVITED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"subject_id" text,
	"name" text NOT NULL,
	"description" text,
	"duration_months" integer DEFAULT 3,
	"price" text DEFAULT '0',
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text,
	"phone" text,
	"role" "role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" text,
	"status" "invitation_status" DEFAULT 'PENDING' NOT NULL,
	"target_entity_id" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" "role" DEFAULT 'ADMIN' NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"permissions" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_guardians" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"user_id" text NOT NULL,
	"relationship" text DEFAULT 'PARENT' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"code" text,
	"color" text DEFAULT '#3B82F6',
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "courses" ADD CONSTRAINT "courses_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courses_tenant_idx" ON "courses" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courses_subject_idx" ON "courses" USING btree ("subject_id");
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "tenant_id" text;
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'ACTIVE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "left_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollments_tenant_idx" ON "enrollments" USING btree ("tenant_id");
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "course_id" text;
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'ACTIVE' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "groups" ADD CONSTRAINT "groups_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_course_idx" ON "groups" USING btree ("course_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_idx" ON "invitations" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_memberships_user_tenant_idx" ON "organization_memberships" USING btree ("user_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_memberships_tenant_idx" ON "organization_memberships" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_guardians_tenant_idx" ON "student_guardians" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_guardians_student_idx" ON "student_guardians" USING btree ("student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_guardians_user_idx" ON "student_guardians" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "student_guardians_student_user_idx" ON "student_guardians" USING btree ("student_id", "user_id");
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "branch_id" text;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'ACTIVE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "avatar_url" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_branch_idx" ON "students" USING btree ("branch_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subjects_tenant_name_idx" ON "subjects" USING btree ("tenant_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subjects_tenant_idx" ON "subjects" USING btree ("tenant_id");
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "onboarding_step" text DEFAULT 'COMPLETED' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "teaching_categories" text[];
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "country" text DEFAULT 'UZ' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'Asia/Tashkent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
