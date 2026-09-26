-- CRMAPP: lesson end time on groups + weekly timetable from group days
-- Migration: 0006_group_end_time.sql (idempotent)
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "end_time" text;--> statement-breakpoint
-- Groups that have lesson days and a start time but no weekly timetable
-- rows get one row per lesson day (90 minutes when no end time is set).
-- Day names are Uzbek (as the UI writes them) or English codes.
INSERT INTO "schedules" ("id", "tenant_id", "group_id", "teacher_id", "branch_id", "day_of_week", "start_time", "end_time", "is_recurring")
SELECT md5(random()::text || g.id || d.dow), g.tenant_id, g.id, g.teacher_id, g.branch_id, d.dow, g.start_time,
       coalesce(g.end_time, to_char(least(g.start_time::time + interval '90 minutes', time '23:59'), 'HH24:MI')),
       true
FROM "groups" g
CROSS JOIN LATERAL (
  SELECT DISTINCT CASE lower(trim(x))
    WHEN 'dushanba' THEN 1 WHEN 'mon' THEN 1
    WHEN 'seshanba' THEN 2 WHEN 'tue' THEN 2
    WHEN 'chorshanba' THEN 3 WHEN 'wed' THEN 3
    WHEN 'payshanba' THEN 4 WHEN 'thu' THEN 4
    WHEN 'juma' THEN 5 WHEN 'fri' THEN 5
    WHEN 'shanba' THEN 6 WHEN 'sat' THEN 6
    WHEN 'yakshanba' THEN 7 WHEN 'sun' THEN 7
  END AS dow
  FROM unnest(string_to_array(g.schedule_days, ',')) AS x
) d
WHERE g.deleted_at IS NULL
  AND d.dow IS NOT NULL
  AND g.start_time ~ '^[0-2][0-9]:[0-5][0-9]$'
  AND NOT EXISTS (
    SELECT 1 FROM "schedules" s WHERE s.group_id = g.id AND s.is_recurring = true AND s.date IS NULL
  );
