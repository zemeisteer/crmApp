-- Attendance is kept per lesson: the mark points at the lesson's timetable
-- row (schedule_id, a plain key - the mark outlives the row) and remembers
-- the lesson's start. A mark with no lesson stays what it was: one for the
-- student, the group and the day.
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "schedule_id" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "start_time" text;--> statement-breakpoint
DROP INDEX IF EXISTS "attendance_student_group_date_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_student_group_date_idx" ON "attendance" USING btree ("student_id","group_id","date") WHERE schedule_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_student_lesson_date_idx" ON "attendance" USING btree ("student_id","schedule_id","date") WHERE schedule_id IS NOT NULL;--> statement-breakpoint
-- An old mark is bound to a lesson only when exactly one live timetable row
-- of its group gives a lesson on that date (the weekly row of that weekday,
-- or a one-off of that date). None or several: left as a day-level mark -
-- never copied to every lesson, never put on "the first one". Those are
-- listed by "npm run db:report-attendance-links" and to admins on the
-- attendance page. Ids and statuses are untouched.
UPDATE "attendance" a SET "schedule_id" = m.sid, "start_time" = m.start_time
FROM (
  SELECT a2.id, min(s.id) AS sid, min(s.start_time) AS start_time
  FROM "attendance" a2
  JOIN "schedules" s ON s.group_id = a2.group_id AND s.tenant_id = a2.tenant_id AND s.status <> 'CANCELLED'
    AND ((s.date IS NULL AND s.day_of_week = extract(isodow FROM (CASE WHEN a2.date ~ '^\d{4}-\d{2}-\d{2}$' THEN a2.date END)::date)::int) OR s.date = a2.date)
  WHERE a2.schedule_id IS NULL
  GROUP BY a2.id
  HAVING count(*) = 1
) m
WHERE a.id = m.id;--> statement-breakpoint
-- A credit issued for an absence follows its mark to the lesson - unless a
-- live credit for that lesson already exists (then it stays a day-level one).
UPDATE "makeup_credits" c SET "origin_schedule_id" = a.schedule_id
FROM "attendance" a
WHERE c.reason = 'ABSENT' AND c.origin_schedule_id IS NULL
  AND a.student_id = c.student_id AND a.group_id = c.origin_group_id AND a.date = c.origin_date AND a.schedule_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "makeup_credits" x
    WHERE x.student_id = c.student_id AND x.origin_schedule_id = a.schedule_id AND x.origin_date = c.origin_date AND x.status <> 'CANCELLED' AND x.id <> c.id
  );
