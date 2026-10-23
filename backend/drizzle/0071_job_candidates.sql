-- Teacher hiring (hiring/): candidates and their stages; a placement test
-- can be for teacher candidates, and an attempt is filed under one.
CREATE TABLE IF NOT EXISTS "job_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"phone_normalized" text,
	"email" text,
	"subject" text,
	"source" text,
	"notes" text,
	"stage" text DEFAULT 'NEW' NOT NULL,
	"test_percent" integer,
	"test_attempt_id" text,
	"interview_at" timestamp,
	"interview_score" integer,
	"interview_notes" text,
	"demo_at" timestamp,
	"demo_score" integer,
	"demo_notes" text,
	"decision_note" text,
	"teacher_id" text,
	"history" text DEFAULT '[]' NOT NULL,
	"created_by_user_id" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placement_attempts" ADD COLUMN IF NOT EXISTS "candidate_id" text;--> statement-breakpoint
ALTER TABLE "placement_tests" ADD COLUMN IF NOT EXISTS "audience" text DEFAULT 'STUDENT' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "job_candidates" ADD CONSTRAINT "job_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "job_candidates" ADD CONSTRAINT "job_candidates_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "job_candidates" ADD CONSTRAINT "job_candidates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_candidates_tenant_stage_idx" ON "job_candidates" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_candidates_tenant_phone_idx" ON "job_candidates" USING btree ("tenant_id","phone_normalized");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_attempts" ADD CONSTRAINT "placement_attempts_candidate_id_job_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."job_candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;