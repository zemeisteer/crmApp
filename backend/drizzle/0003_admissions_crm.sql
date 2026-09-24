-- CRMAPP Sprint: Admissions & Sales CRM
-- Migration: 0003_admissions_crm.sql
--
-- Hand-written and idempotent (safe to re-run), following 0001's style.
-- Preserves every existing lead row: columns are renamed or added, never
-- dropped, and legacy data is backfilled into the new structures.

-- 1. lead_source: rename legacy values in place (existing rows follow the
--    rename automatically), then append PHONE.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'lead_source' AND e.enumlabel = 'RECOMMENDATION') THEN
    ALTER TYPE "public"."lead_source" RENAME VALUE 'RECOMMENDATION' TO 'REFERRAL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'lead_source' AND e.enumlabel = 'BANNER') THEN
    ALTER TYPE "public"."lead_source" RENAME VALUE 'BANNER' TO 'ADVERTISEMENT';
  END IF;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."lead_source" ADD VALUE IF NOT EXISTS 'PHONE';--> statement-breakpoint

-- 2. New enums.
DO $$ BEGIN
  CREATE TYPE "public"."lead_lost_reason" AS ENUM('TOO_EXPENSIVE', 'NO_RESPONSE', 'CHOSE_COMPETITOR', 'SCHEDULE_MISMATCH', 'LOCATION', 'NOT_INTERESTED', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."lead_activity_type" AS ENUM('NOTE', 'CALL', 'MESSAGE', 'MEETING', 'STATUS_CHANGE', 'FOLLOW_UP_SCHEDULED', 'TRIAL_BOOKED', 'TRIAL_ATTENDED', 'CONVERTED', 'LOST', 'REOPENED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."lead_trial_status" AS ENUM('BOOKED', 'ATTENDED', 'MISSED', 'CANCELLED', 'RESCHEDULED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 3. Column renames (data preserved).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'parent_phone')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'secondary_phone') THEN
    ALTER TABLE "leads" RENAME COLUMN "parent_phone" TO "secondary_phone";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'branch_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'preferred_branch_id') THEN
    ALTER TABLE "leads" RENAME COLUMN "branch_id" TO "preferred_branch_id";
  END IF;
  -- The free-text lost_reason becomes lost_note; lost_reason is re-added
  -- below as a structured enum.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'lost_reason' AND data_type = 'text')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'lost_note') THEN
    ALTER TABLE "leads" RENAME COLUMN "lost_reason" TO "lost_note";
  END IF;
END $$;
--> statement-breakpoint

-- 4. New lead columns.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "secondary_phone" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "preferred_branch_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lost_note" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "phone_normalized" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "email_normalized" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "desired_subject_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "desired_course_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "assigned_manager_user_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lost_reason" "lead_lost_reason";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lost_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "converted_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "duplicate_of_lead_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "created_by_user_id" text;--> statement-breakpoint

-- 5. Foreign keys. The renamed branch FK is recreated under its new name
--    with ON DELETE SET NULL so removing a branch never blocks on leads.
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_branch_id_branches_id_fk";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_preferred_branch_id_branches_id_fk" FOREIGN KEY ("preferred_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_desired_subject_id_subjects_id_fk" FOREIGN KEY ("desired_subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_desired_course_id_courses_id_fk" FOREIGN KEY ("desired_course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_manager_user_id_users_id_fk" FOREIGN KEY ("assigned_manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_duplicate_of_lead_id_leads_id_fk" FOREIGN KEY ("duplicate_of_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 6. Backfill derived/structured fields from existing data. The SQL phone
--    rule mirrors normalizePhone() in src/leads/phone.ts.
UPDATE "leads" SET "phone_normalized" = CASE
    WHEN length(regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '')) = 9 AND "phone" !~ '^\s*\+'
      THEN '+998' || regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '')
    WHEN length(regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '')) BETWEEN 8 AND 15
      THEN '+' || regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^00', '')
    ELSE NULL
  END
WHERE "phone_normalized" IS NULL;--> statement-breakpoint
UPDATE "leads" SET "email_normalized" = lower(trim("email"))
WHERE "email" IS NOT NULL AND trim("email") <> '' AND "email_normalized" IS NULL;--> statement-breakpoint
UPDATE "leads" SET "lost_reason" = 'OTHER', "lost_at" = COALESCE("lost_at", "updated_at")
WHERE "status" = 'LOST' AND "lost_reason" IS NULL;--> statement-breakpoint
UPDATE "leads" SET "converted_at" = "updated_at"
WHERE "status" = 'ENROLLED' AND "converted_student_id" IS NOT NULL AND "converted_at" IS NULL;--> statement-breakpoint
-- Link free-text subject interest to a real subject only when exactly one
-- subject in the same tenant matches; the text itself is kept as legacy.
UPDATE "leads" l SET "desired_subject_id" = m.subject_id
FROM (
  SELECT l2.id AS lead_id, min(s.id) AS subject_id
  FROM "leads" l2
  JOIN "subjects" s ON s.tenant_id = l2.tenant_id AND lower(trim(s.name)) = lower(trim(l2.subject))
  WHERE l2.subject IS NOT NULL AND l2.desired_subject_id IS NULL
  GROUP BY l2.id
  HAVING count(*) = 1
) m
WHERE l.id = m.lead_id;--> statement-breakpoint

-- 7. Pre-existing same-tenant duplicates: keep the oldest lead as the
--    primary and link the rest to it, so the uniqueness indexes can be
--    created without deleting or hiding any row.
UPDATE "leads" l SET "duplicate_of_lead_id" = d.primary_id
FROM (
  SELECT id, first_value(id) OVER (PARTITION BY tenant_id, phone_normalized ORDER BY created_at, id) AS primary_id
  FROM "leads"
  WHERE phone_normalized IS NOT NULL AND archived_at IS NULL AND duplicate_of_lead_id IS NULL
) d
WHERE l.id = d.id AND d.id <> d.primary_id;--> statement-breakpoint
UPDATE "leads" l SET "duplicate_of_lead_id" = d.primary_id
FROM (
  SELECT id, first_value(id) OVER (PARTITION BY tenant_id, email_normalized ORDER BY created_at, id) AS primary_id
  FROM "leads"
  WHERE email_normalized IS NOT NULL AND archived_at IS NULL AND duplicate_of_lead_id IS NULL
) d
WHERE l.id = d.id AND d.id <> d.primary_id;--> statement-breakpoint

-- 8. Timeline and trial tables.
CREATE TABLE IF NOT EXISTS "lead_activities" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "lead_id" text NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "type" "lead_activity_type" NOT NULL,
  "body" text,
  "from_status" "lead_status",
  "to_status" "lead_status",
  "metadata" jsonb,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_trials" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "lead_id" text NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "branch_id" text REFERENCES "branches"("id") ON DELETE SET NULL,
  "subject_id" text REFERENCES "subjects"("id") ON DELETE SET NULL,
  "course_id" text REFERENCES "courses"("id") ON DELETE SET NULL,
  "teacher_id" text REFERENCES "teachers"("id") ON DELETE SET NULL,
  "group_id" text REFERENCES "groups"("id") ON DELETE SET NULL,
  "room_id" text REFERENCES "rooms"("id") ON DELETE SET NULL,
  "scheduled_at" timestamp NOT NULL,
  "duration_minutes" integer DEFAULT 60 NOT NULL,
  "status" "lead_trial_status" DEFAULT 'BOOKED' NOT NULL,
  "outcome_note" text,
  "rescheduled_from_trial_id" text REFERENCES "lead_trials"("id") ON DELETE SET NULL,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- 9. Carry legacy trial_date/trial_group_id into lead_trials. Only a lead
--    currently in TRIAL_BOOKED keeps a BOOKED trial; later stages imply the
--    trial happened; anything else is recorded as cancelled.
INSERT INTO "lead_trials" ("id", "tenant_id", "lead_id", "branch_id", "teacher_id", "group_id", "scheduled_at", "status", "outcome_note", "created_at", "updated_at")
SELECT gen_random_uuid()::text, l.tenant_id, l.id, COALESCE(g.branch_id, l.preferred_branch_id), g.teacher_id, l.trial_group_id, l.trial_date,
  (CASE
    WHEN l.status = 'TRIAL_BOOKED' THEN 'BOOKED'
    WHEN l.status IN ('TRIAL_ATTENDED', 'QUALIFIED', 'ENROLLED') THEN 'ATTENDED'
    ELSE 'CANCELLED'
  END)::"lead_trial_status",
  'Migrated from legacy leads.trial_date (0003)', l.created_at, (now() AT TIME ZONE 'UTC')
FROM "leads" l
LEFT JOIN "groups" g ON g.id = l.trial_group_id AND g.tenant_id = l.tenant_id
WHERE l.trial_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "lead_trials" t WHERE t.lead_id = l.id);--> statement-breakpoint

-- 10. Indexes. Duplicate protection is enforced by the database (partial
--     unique indexes scoped per tenant), not only by check-then-insert.
CREATE INDEX IF NOT EXISTS "leads_tenant_status_idx" ON "leads" USING btree ("tenant_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_tenant_follow_up_idx" ON "leads" USING btree ("tenant_id", "follow_up_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_tenant_manager_idx" ON "leads" USING btree ("tenant_id", "assigned_manager_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_tenant_created_idx" ON "leads" USING btree ("tenant_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_tenant_phone_active_uniq" ON "leads" USING btree ("tenant_id", "phone_normalized")
  WHERE "archived_at" IS NULL AND "duplicate_of_lead_id" IS NULL AND "phone_normalized" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_tenant_email_active_uniq" ON "leads" USING btree ("tenant_id", "email_normalized")
  WHERE "archived_at" IS NULL AND "duplicate_of_lead_id" IS NULL AND "email_normalized" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_activities_tenant_lead_idx" ON "lead_activities" USING btree ("tenant_id", "lead_id", "occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_activities_tenant_type_idx" ON "lead_activities" USING btree ("tenant_id", "type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_trials_tenant_lead_idx" ON "lead_trials" USING btree ("tenant_id", "lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_trials_tenant_scheduled_idx" ON "lead_trials" USING btree ("tenant_id", "scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_trials_one_booked_per_lead" ON "lead_trials" USING btree ("lead_id") WHERE "status" = 'BOOKED';
