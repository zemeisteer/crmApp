-- A group's weekly lessons come from the timetable (schedules rows). Only a
-- group from before those rows existed still takes its lessons from its own
-- schedule_days. The two were told apart by "has no weekly row", which also
-- matched a group whose rows were cancelled or deleted on purpose, so a
-- lesson called off on the timetable came back in calendars and make-ups.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "timetable_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every group that has (or still has, cancelled) a weekly row is managed by
-- the timetable. Groups with none stay as they are: an old group keeps its
-- lessons.
UPDATE "groups" SET "timetable_managed" = true
  WHERE "timetable_managed" = false
    AND EXISTS (SELECT 1 FROM "schedules" s WHERE s."group_id" = "groups"."id" AND s."date" IS NULL AND s."day_of_week" IS NOT NULL);
