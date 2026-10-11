-- A lesson gets an identity of its own: the timetable row (weekly or one-off)
-- plus the date. Make-up bookings, cancellations and the credits for a
-- cancelled lesson point at that row instead of "the group that day", so two
-- lessons of one group on one day are told apart and a booking can never
-- slide from a removed lesson into another one.
ALTER TABLE "lesson_cancellations" ADD COLUMN IF NOT EXISTS "schedule_id" text;--> statement-breakpoint
ALTER TABLE "makeup_bookings" ADD COLUMN IF NOT EXISTS "target_schedule_id" text;--> statement-breakpoint
ALTER TABLE "makeup_credits" ADD COLUMN IF NOT EXISTS "origin_schedule_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lesson_cancellations" ADD CONSTRAINT "lesson_cancellations_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "makeup_bookings" ADD CONSTRAINT "makeup_bookings_target_schedule_id_schedules_id_fk" FOREIGN KEY ("target_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- Existing cancellations keep their meaning (schedule_id stays NULL: every
-- weekly lesson of the group that day), so the old unique index only gets
-- its condition; the same for credits.
DROP INDEX IF EXISTS "lesson_cancellations_group_date_uniq";--> statement-breakpoint
DROP INDEX IF EXISTS "makeup_credits_once_per_occurrence";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_cancellations_group_date_uniq" ON "lesson_cancellations" USING btree ("group_id","date") WHERE schedule_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_cancellations_lesson_date_uniq" ON "lesson_cancellations" USING btree ("schedule_id","date") WHERE schedule_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "makeup_credits_once_per_occurrence" ON "makeup_credits" USING btree ("student_id","origin_group_id","origin_date") WHERE status <> 'CANCELLED' AND origin_schedule_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "makeup_credits_once_per_lesson" ON "makeup_credits" USING btree ("student_id","origin_schedule_id","origin_date") WHERE status <> 'CANCELLED' AND origin_schedule_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "makeup_bookings_lesson_idx" ON "makeup_bookings" USING btree ("target_schedule_id","date");--> statement-breakpoint
-- Open bookings are bound to their lesson only when exactly one live
-- timetable row of the target group is on that date at the booked start.
-- None or several: left unbound, never guessed (they are listed by
-- "npm run db:report-makeup-links" and released, with the credit back, the
-- next time that group's timetable changes and still gives no single match).
-- Closed bookings are history and stay as they are.
UPDATE "makeup_bookings" b SET "target_schedule_id" = m.schedule_id
FROM (
  SELECT b2.id AS booking_id, min(s.id) AS schedule_id
  FROM "makeup_bookings" b2
  JOIN "schedules" s ON s.group_id = b2.target_group_id AND s.tenant_id = b2.tenant_id
    AND s.status <> 'CANCELLED' AND s.start_time = b2.start_time
    AND ((s.date IS NULL AND s.day_of_week = extract(isodow FROM b2.date::date)::int) OR s.date = b2.date)
  WHERE b2.mode = 'GROUP_LESSON' AND b2.status = 'BOOKED' AND b2.target_schedule_id IS NULL
  GROUP BY b2.id
  HAVING count(*) = 1
) m
WHERE b.id = m.booking_id;
