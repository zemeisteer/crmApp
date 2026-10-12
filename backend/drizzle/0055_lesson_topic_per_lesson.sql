-- A lesson's topic belongs to the lesson (its timetable row), like its
-- attendance: two lessons of one group on one day each have their own.
ALTER TABLE "lesson_topics" ADD COLUMN IF NOT EXISTS "schedule_id" text;--> statement-breakpoint
DROP INDEX IF EXISTS "lesson_topics_group_date_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_topics_group_date_idx" ON "lesson_topics" USING btree ("group_id","date") WHERE schedule_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_topics_lesson_date_idx" ON "lesson_topics" USING btree ("schedule_id","date") WHERE schedule_id IS NOT NULL;--> statement-breakpoint
-- An old topic is bound only when exactly one live timetable row of its
-- group gives a lesson on that date; otherwise it stays the day's topic and
-- is shown with every lesson of that day (never copied, never guessed).
UPDATE "lesson_topics" t SET "schedule_id" = m.sid
FROM (
  SELECT t2.id, min(s.id) AS sid
  FROM "lesson_topics" t2
  JOIN "schedules" s ON s.group_id = t2.group_id AND s.tenant_id = t2.tenant_id AND s.status <> 'CANCELLED'
    AND ((s.date IS NULL AND s.day_of_week = extract(isodow FROM (CASE WHEN t2.date ~ '^\d{4}-\d{2}-\d{2}$' THEN t2.date END)::date)::int) OR s.date = t2.date)
  WHERE t2.schedule_id IS NULL
  GROUP BY t2.id
  HAVING count(*) = 1
) m
WHERE t.id = m.id;
