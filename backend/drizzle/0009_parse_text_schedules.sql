-- CRMAPP: read old free-text group schedules ("Du/Chor/Juma, 16:00")
-- Migration: 0009_parse_text_schedules.sql (idempotent, data only)
-- Groups created before lesson days existed only have schedule text. Pick
-- the weekday names/abbreviations and the first HH:MM out of it, then build
-- their weekly timetable rows like 0006 does.
WITH parsed AS (
  SELECT g.id,
    (SELECT string_agg(name, ',' ORDER BY dow) FROM (
      SELECT DISTINCT
        CASE
          WHEN tok IN ('du','dush','dushanba','mon','monday') THEN 1
          WHEN tok IN ('se','sesh','seshanba','tue','tuesday') THEN 2
          WHEN tok IN ('ch','cho','chor','chorshanba','wed','wednesday') THEN 3
          WHEN tok IN ('pa','pay','paysh','payshanba','thu','thursday') THEN 4
          WHEN tok IN ('ju','jum','juma','fri','friday') THEN 5
          WHEN tok IN ('sh','sha','shan','shanba','sat','saturday') THEN 6
          WHEN tok IN ('ya','yak','yaksh','yakshanba','sun','sunday') THEN 7
        END AS dow,
        CASE
          WHEN tok IN ('du','dush','dushanba','mon','monday') THEN 'Dushanba'
          WHEN tok IN ('se','sesh','seshanba','tue','tuesday') THEN 'Seshanba'
          WHEN tok IN ('ch','cho','chor','chorshanba','wed','wednesday') THEN 'Chorshanba'
          WHEN tok IN ('pa','pay','paysh','payshanba','thu','thursday') THEN 'Payshanba'
          WHEN tok IN ('ju','jum','juma','fri','friday') THEN 'Juma'
          WHEN tok IN ('sh','sha','shan','shanba','sat','saturday') THEN 'Shanba'
          WHEN tok IN ('ya','yak','yaksh','yakshanba','sun','sunday') THEN 'Yakshanba'
        END AS name
      FROM regexp_split_to_table(lower(g.schedule), '[^a-z]+') AS tok
    ) d WHERE dow IS NOT NULL) AS days,
    lpad((regexp_match(g.schedule, '([0-2]?[0-9]):([0-5][0-9])'))[1], 2, '0') || ':' || (regexp_match(g.schedule, '([0-2]?[0-9]):([0-5][0-9])'))[2] AS start
  FROM "groups" g
  WHERE g.deleted_at IS NULL
    AND coalesce(g.schedule_days, '') = ''
    AND g.schedule ~ '[0-2]?[0-9]:[0-5][0-9]'
)
UPDATE "groups" g
SET schedule_days = p.days,
    start_time = coalesce(nullif(g.start_time, ''), p.start)
FROM parsed p
WHERE g.id = p.id AND p.days IS NOT NULL;
--> statement-breakpoint
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
