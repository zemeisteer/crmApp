-- A teacher's mark (present, late, absent, the substitute) is kept per
-- lesson, like a student's (0053): it points at the lesson's timetable row
-- (schedule_id, a plain key - the mark outlives the row) and remembers the
-- lesson's start. A mark with no lesson stays what it was: one for the
-- group and the day.
ALTER TABLE "teacher_attendance" ADD COLUMN IF NOT EXISTS "schedule_id" text;--> statement-breakpoint
ALTER TABLE "teacher_attendance" ADD COLUMN IF NOT EXISTS "start_time" text;--> statement-breakpoint
DROP INDEX IF EXISTS "teacher_attendance_group_date_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teacher_attendance_group_date_idx" ON "teacher_attendance" USING btree ("group_id","date") WHERE schedule_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teacher_attendance_lesson_date_idx" ON "teacher_attendance" USING btree ("schedule_id","date") WHERE schedule_id IS NOT NULL;--> statement-breakpoint
-- An old mark is bound to a lesson only when exactly one live timetable row
-- of its group gives a lesson on that date (the weekly row of that weekday,
-- or a one-off of that date). None or several: left as a day-level mark -
-- never copied to every lesson, never put on "the first one", and counted
-- once on the payroll as before. Those are listed by
-- "npm run db:report-teacher-attendance-links". Ids, statuses, substitutes
-- and salary payments are untouched.
UPDATE "teacher_attendance" a SET "schedule_id" = m.sid, "start_time" = m.start_time
FROM (
  SELECT a2.id, min(s.id) AS sid, min(s.start_time) AS start_time
  FROM "teacher_attendance" a2
  JOIN "schedules" s ON s.group_id = a2.group_id AND s.tenant_id = a2.tenant_id AND s.status <> 'CANCELLED'
    AND ((s.date IS NULL AND s.day_of_week = extract(isodow FROM (CASE WHEN a2.date ~ '^\d{4}-\d{2}-\d{2}$' THEN a2.date END)::date)::int) OR s.date = a2.date)
  WHERE a2.schedule_id IS NULL
  GROUP BY a2.id
  HAVING count(*) = 1
) m
WHERE a.id = m.id;
