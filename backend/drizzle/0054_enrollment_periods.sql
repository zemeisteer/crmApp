-- Membership history: one row per stay of a student in a group. The
-- enrollment row keeps only the current state and was rewritten when a
-- student came back, so earlier stays were lost; from now on every stay is
-- kept (see schema.ts, enrollments/membership.ts).
CREATE TABLE IF NOT EXISTS "enrollment_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"group_id" text NOT NULL,
	"enrollment_id" text,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"end_reason" text,
	"source" text DEFAULT 'RECORDED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrollment_periods" ADD CONSTRAINT "enrollment_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrollment_periods" ADD CONSTRAINT "enrollment_periods_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrollment_periods" ADD CONSTRAINT "enrollment_periods_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrollment_periods" ADD CONSTRAINT "enrollment_periods_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollment_periods_tenant_idx" ON "enrollment_periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollment_periods_student_group_idx" ON "enrollment_periods" USING btree ("student_id","group_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollment_periods_group_idx" ON "enrollment_periods" USING btree ("group_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enrollment_periods_one_open" ON "enrollment_periods" USING btree ("student_id","group_id") WHERE ended_at IS NULL;--> statement-breakpoint
-- What the existing rows know, and nothing more - marked LEGACY:
--  - an active enrollment: a stay from its (last) joining, open - or closed
--    at the moment the student was removed, left, graduated or was paused,
--    when that moment is recorded and lies after the joining;
--  - an ended enrollment with a leaving time after its joining: that stay;
--  - an ended enrollment with no leaving time: NO row. When it ended is not
--    known, and no interval is made up for it
--    ("npm run db:report-membership" counts these).
-- Earlier stays of a student who came back were overwritten and are not
-- reconstructed. Only enrollments that have no period yet are touched, so
-- running this again changes nothing.
INSERT INTO "enrollment_periods" ("id", "tenant_id", "student_id", "group_id", "enrollment_id", "started_at", "ended_at", "end_reason", "source")
SELECT 'leg' || e.id, st.tenant_id, e.student_id, e.group_id, e.id, e.joined_at,
  CASE
    WHEN e.status <> 'ACTIVE' THEN e.left_at
    WHEN st.deleted_at IS NOT NULL AND st.deleted_at > e.joined_at THEN st.deleted_at
    WHEN st.status IN ('LEFT', 'GRADUATED') AND st.left_at > e.joined_at THEN st.left_at
    WHEN st.status = 'PAUSED' AND st.paused_at > e.joined_at THEN st.paused_at
    ELSE NULL
  END,
  CASE
    WHEN e.status <> 'ACTIVE' THEN 'LEFT_GROUP'
    WHEN st.deleted_at IS NOT NULL AND st.deleted_at > e.joined_at THEN 'REMOVED'
    WHEN st.status IN ('LEFT', 'GRADUATED') AND st.left_at > e.joined_at THEN st.status::text
    WHEN st.status = 'PAUSED' AND st.paused_at > e.joined_at THEN 'PAUSED'
    ELSE NULL
  END,
  'LEGACY'
FROM "enrollments" e
JOIN "students" st ON st.id = e.student_id
WHERE (e.status = 'ACTIVE' OR (e.left_at IS NOT NULL AND e.left_at > e.joined_at))
  AND NOT EXISTS (SELECT 1 FROM "enrollment_periods" p WHERE p.student_id = e.student_id AND p.group_id = e.group_id)
ON CONFLICT DO NOTHING;
